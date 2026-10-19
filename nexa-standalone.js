/**
 * nexa-standalone.js — pipeline jawaban Nexa Bot tanpa framework (v1.15.0).
 *
 * Satu otak untuk semua "tanpa-Next": api/chat.js (Serverless Vercel),
 * bot Telegram (mini-services/…/handlers.ts — webhook maupun layanan
 * panel), dan pemakaian skrip. Pipeline: penjaga keamanan → kalkulator →
 * resolver katalog → NLP → gerbang konteks — identik dengan
 * src/lib/nexa-bot/engine.ts versi situs.
 *
 * Harga operand kalkulator & rekomendasi bisa disegarkan dari katalog LIVE
 * lewat mergeLexicon(base, games, products) — dipakai bot Telegram agar
 * jawabannya tidak pernah basi (engine situs melakukannya sendiri).
 *
 * Murni lokal — tanpa network, tanpa dependensi eksternal @nlpjs/basic saja.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Nlp } = require("@nlpjs/basic");
const { resolveCatalogQuery, resolveProductMention, withinDomain } = require("./nexa-resolve.js");
const { containsLeakAttempt, sanitizeAnswer, GUARD_ANSWER } = require("./nexa-guard.js");
const { detectMath, solveMath } = require("./nexa-math.js");

// ---------------------------------------------------------------------------
// Otak: model.nlp (canonical) + fallback bundel nexa-brain.js
// ---------------------------------------------------------------------------

let brainPromise = null;

function loadBrain() {
  if (!brainPromise) {
    brainPromise = Promise.resolve().then(() => {
      const bundled = require("./nexa-brain.js");
      let model = bundled.model;
      const candidates = [
        path.join(__dirname, "model.nlp"),
        path.join(__dirname, "..", "model.nlp"),
        path.join(process.cwd(), "model.nlp"),
      ];
      for (const p of candidates) {
        try {
          model = JSON.parse(fs.readFileSync(p, "utf8"));
          break;
        } catch {
          /* coba kandidat berikutnya */
        }
      }
      return {
        model,
        lexicon: bundled.lexicon,
        persona: bundled.persona,
        version: bundled.version,
      };
    });
  }
  return brainPromise;
}

let nlpPromise = null;

function getNlp(modelJson) {
  if (!nlpPromise) {
    nlpPromise = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(JSON.stringify(modelJson));
      return nlp;
    });
  }
  return nlpPromise;
}

// ---------------------------------------------------------------------------
// Gabungan leksikon LIVE — game baru dikenali, harga berubah ikut berubah
// ---------------------------------------------------------------------------

function plainLabel(product, gameName, gameId) {
  const tail = String(product.id ?? "").slice(String(gameId).length + 1);
  const words = [];
  const push = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[_/]+/g, " ")
      .split(/[^a-z0-9+]+/)
      .filter(Boolean)
      .forEach((w) => {
        if (!words.includes(w)) words.push(w);
      });
  push(tail);
  push(product.name);
  push(product.denomination);
  if (product.bonus) push(product.bonus);
  return { label: words.join(" "), tokens: words.filter((w) => w.length > 1) };
}

/**
 * Segarkan leksikon terlatih dengan katalog LIVE (bentuk polos — sama dengan
 * keluaran API katalog: games[{id,name,slug,enabled}], products[…]).
 * Game baru → alias otomatis dari nama; harga baru → menimpa; produk/game
 * nonaktif → keluar dari leksikon.
 */
function mergeLexicon(base, games, products) {
  if (!Array.isArray(games) || games.length === 0 || !Array.isArray(products)) return base;
  const active = (x) => x && x.enabled !== false;
  const liveGames = games.filter(active).filter((g) => products.some((p) => active(p) && p.gameId === g.id));
  const liveProducts = products.filter(active).filter((p) => liveGames.some((g) => g.id === p.gameId));

  const outGames = liveGames.map((g) => {
    const trained = (base.games || []).find((x) => x.id === g.id);
    return {
      id: g.id,
      slug: g.slug,
      name: g.name,
      aliases: [
        ...new Set([
          ...(trained ? trained.aliases : []),
          String(g.name).toLowerCase(),
          String(g.name).toLowerCase().replace(/[^a-z0-9]+/g, ""),
        ]),
      ],
      units: trained ? trained.units : [],
      productCount: liveProducts.filter((p) => p.gameId === g.id).length,
    };
  });

  const outProducts = liveProducts.map((p) => {
    const game = liveGames.find((g) => g.id === p.gameId);
    const trained = (base.products || []).find((x) => x.id === p.id);
    if (!game) return trained;
    const bonusNum = p.bonus ? String(p.bonus).replace(/\D/g, "") : "";
    const denom = String(p.denomination ?? "").toLowerCase();
    const { label, tokens } = plainLabel(p, game.name, game.id);
    return {
      id: p.id,
      gameId: p.gameId,
      denom,
      denomFull: bonusNum ? `${denom}+${bonusNum}` : denom,
      bonus: Boolean(bonusNum),
      tokens,
      priceIdr: p.priceIdr,
      label,
      gameName: game.name,
    };
  });

  return { ...base, games: outGames, products: outProducts };
}

// ---------------------------------------------------------------------------
// Pipeline jawaban
// ---------------------------------------------------------------------------

/**
 * Jawab sebuah pesan.
 * @param {string} text pesan pengguna
 * @param {object=} lexiconOverride leksikon (mis. hasil mergeLexicon LIVE)
 * @returns {Promise<{intent:string, score:number, answer:string}>}
 */
async function answer(text, lexiconOverride) {
  const brain = await loadBrain();
  const clean = String(text ?? "").trim().slice(0, 800);
  const FALLBACK = brain.persona.fallback;
  const OFF_CONTEXT = brain.persona.offContext;
  if (!clean) return { intent: "None", score: 0, answer: FALLBACK };

  // 0. Penjaga keamanan — upaya menggali rahasia ditolak paling dulu.
  if (containsLeakAttempt(clean)) {
    return { intent: "security.refuse", score: 1, answer: GUARD_ANSWER };
  }

  const lexicon = lexiconOverride || brain.lexicon;

  // 1. Kalkulator.
  if (detectMath(clean)) {
    const mathAnswer = solveMath(clean, resolveProductMention, lexicon);
    if (mathAnswer) return { intent: "math", score: 1, answer: sanitizeAnswer(mathAnswer) };
  }

  // 2. Resolver katalog.
  const hit = resolveCatalogQuery(clean, lexicon);
  if (hit) {
    const nlp = await getNlp(brain.model);
    const intent = hit.type === "product" ? `price.${hit.productId}` : `game.${hit.gameId}`;
    try {
      const answers = await nlp.findAllAnswers("en", intent);
      if (answers && answers[0] && answers[0].answer) {
        return { intent, score: 1, answer: sanitizeAnswer(answers[0].answer) };
      }
    } catch {
      /* jatuh ke fallback */
    }
    return { intent, score: 1, answer: FALLBACK };
  }

  // 3. NLP — jawaban positif hanya bila pesan dalam ranah (anti-hijack).
  const nlp = await getNlp(brain.model);
  const r = await nlp.process("en", clean);
  if (r && r.intent !== "None" && r.score >= 0.5 && r.answer) {
    const isRefusal = r.intent.startsWith("off.") || r.intent.startsWith("security.");
    if (isRefusal || withinDomain(clean, lexicon)) {
      return { intent: r.intent, score: r.score, answer: sanitizeAnswer(r.answer) };
    }
  }

  // 4. Gerbang konteks → fallback / tolakan.
  if (!withinDomain(clean, lexicon)) {
    return { intent: "off.Context", score: 1, answer: OFF_CONTEXT };
  }
  return { intent: "None", score: (r && r.score) || 0, answer: FALLBACK };
}

module.exports = { answer, mergeLexicon, loadBrain };
