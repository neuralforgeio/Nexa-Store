/**
 * nexa-standalone.js — pipeline jawaban Nexa Bot tanpa framework (v1.17.0).
 *
 * Satu otak untuk semua "tanpa-Next": api/chat.js (Serverless Vercel),
 * bot Telegram (mini-services/…/handlers.ts — webhook maupun layanan
 * panel), dan pemakaian skrip. Pipeline: penjaga keamanan → status pesanan
 * (opsional) → kalkulator → resolver katalog → LAPISAN KUSTOM (overlay
 * TF-IDF atas dataset impor) → NLP → gerbang konteks — identik dengan
 * src/lib/nexa-bot/engine.ts versi situs.
 *
 * v1.17.0 — SADAR PENGGUNA: answer(text, lexiconOverride, ctx) — ctx berisi
 * userName (identitas chat / nama Telegram) untuk sapaan personal & jawaban
 * "kamu mengenal saya".
 *
 * v1.17.0 — OTAK KUSTOM: data/store/bot-brain.json (dataset + model hasil
 * latih ulang panel AI) dibaca dari: (a) filesystem saat berjalan di
 * sandbox/mini-service, (b) raw.githubusercontent.com saat berjalan sebagai
 * Serverless Vercel (env GITHUB_OWNER/REPOSITORY/BRANCH/TOKEN). Cache 30 dtk.
 *
 * Harga operand kalkulator & rekomendasi bisa disegarkan dari katalog LIVE
 * lewat mergeLexicon(base, games, products).
 *
 * Murni lokal — tanpa dependensi eksternal @nlpjs/basic saja.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Nlp } = require("@nlpjs/basic");
const { resolveCatalogQuery, resolveProductForOrder, resolveProductMention, withinDomain } = require("./nexa-resolve.js");
const { containsLeakAttempt, sanitizeAnswer, GUARD_ANSWER } = require("./nexa-guard.js");
const { detectMath, solveMath } = require("./nexa-math.js");
const { buildOverlay, matchOverlay, personalize } = require("./nexa-overlay.js");
const { renderIntentLive, renderOrderStatus, ORDER_ID_RE } = require("./nexa-userctx.js");
const { agentAddToCart, detectPurchaseIntent, markdownToHtml, stripMarkdown } = require("./nexa-agent.js");

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

// ---------------------------------------------------------------------------
// Otak kustom (data/store/bot-brain.json) — FS sandbox / raw GitHub serverless
// ---------------------------------------------------------------------------

const BRAIN_TTL_MS = 30_000;
let customBrainState = null; // { key, modelJson, customIntents, overlay, at }

function readCustomBrainFromFs() {
  const candidates = [
    path.join(__dirname, "data", "store", "bot-brain.json"),
    path.join(__dirname, "..", "data", "store", "bot-brain.json"),
    path.join(process.cwd(), "data", "store", "bot-brain.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.customIntents)) return parsed;
      return null;
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return null;
}

async function readCustomBrainFromGithub() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo) return null;
  // Pakai Contents API + media-type raw — pola yang terbukti jalan di produksi
  // (identik src/lib/site-features/store.ts; JSON default menolak file >1MB).
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/data/store/bot-brain.json?ref=${encodeURIComponent(branch)}`;
  try {
    const res = await fetch(api, {
      headers: {
        Accept: "application/vnd.github.raw",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "nexa-bot",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const parsed = JSON.parse(await res.text());
    if (parsed && Array.isArray(parsed.customIntents)) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function loadCustomBrain() {
  if (customBrainState && Date.now() - customBrainState.at < BRAIN_TTL_MS) return customBrainState;
  // Prioritas GITHUB dulu bila env tersedia (produksi Vercel: FS hanya salinan
  // build-time yang bisa basi — commit "bot-brain:" sengaja tidak memicu
  // rebuild). Sandbox (tanpa env GITHUB_*) otomatis memakai FS yang selalu
  // segar karena berbagi direktori repo dengan layanan panel.
  let file = await readCustomBrainFromGithub();
  const source = file ? "github" : null;
  if (!file) file = readCustomBrainFromFs();
  if (!file) {
    customBrainState = { key: "none", source: "bundled", modelJson: null, customIntents: [], overlay: buildOverlay([]), at: Date.now() };
    return customBrainState;
  }
  const modelJson = typeof file.modelJson === "string" && file.modelJson.length > 10 ? file.modelJson : null;
  // v1.18.0: model kustom hanya dipakai bila versinya sama dengan bundel —
  // model korpus lama otomatis mundur agar jawaban markdown baru aktif.
  const bundledVersion = require("./nexa-brain.js").version;
  const modelCurrent = Boolean(modelJson) && file.version === bundledVersion;
  customBrainState = {
    key: modelCurrent && file.trainedAt ? `custom-${file.trainedAt}` : "bundled",
    source: source ?? "fs",
    modelJson: modelCurrent ? modelJson : null,
    customIntents: file.customIntents,
    overlay: buildOverlay(file.customIntents),
    at: Date.now(),
  };
  return customBrainState;
}

/** Diagnostik ringan untuk GET /api/chat — tanpa rahasia. */
async function brainInfo() {
  const s = await loadCustomBrain();
  return {
    source: s.source,
    key: s.key,
    customIntents: s.customIntents.length,
    hasModel: Boolean(s.modelJson),
  };
}

const nlpCache = new Map();

async function getNlpFor(key, modelJson) {
  if (!modelJson) return getNlp();
  let p = nlpCache.get(key);
  if (!p) {
    p = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(modelJson);
      return nlp;
    });
    p.catch(() => nlpCache.delete(key));
    nlpCache.set(key, p);
  }
  return p;
}

let nlpPromise = null;

function getNlp() {
  if (!nlpPromise) {
    nlpPromise = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(JSON.stringify(require("./nexa-brain.js").model));
      return nlp;
    });
    nlpPromise.catch(() => {
      nlpPromise = null;
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
      // v1.18.0: skema field order ikut — dipakai agent transaksi. Katalog
      // publik mengeja "orderFields", repo internal "orderFieldSchema".
      orderFieldSchema: g.orderFieldSchema ?? g.orderFields ?? (trained ? trained.orderFieldSchema : null),
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
 * @param {{userName?: string|null}=} ctx konteks percakapan (v1.17.0)
 * @returns {Promise<{intent:string, score:number, answer:string}>}
 */
async function answer(text, lexiconOverride, ctx = {}) {
  const brain = await loadBrain();
  const clean = String(text ?? "").trim().slice(0, 800);
  const FALLBACK = brain.persona.fallback;
  const OFF_CONTEXT = brain.persona.offContext;
  if (!clean) return { intent: "None", score: 0, answer: FALLBACK };

  // 0. Penjaga keamanan — upaya menggali rahasia ditolak paling dulu.
  if (containsLeakAttempt(clean)) {
    return { intent: "security.refuse", score: 1, answer: GUARD_ANSWER };
  }

  const custom = await loadCustomBrain();
  const lexicon = lexiconOverride || brain.lexicon;
  const userName = (ctx && ctx.userName) || null;

  // 1. Kalkulator.
  if (detectMath(clean)) {
    const mathAnswer = solveMath(clean, resolveProductMention, lexicon);
    if (mathAnswer) return { intent: "math", score: 1, answer: sanitizeAnswer(mathAnswer) };
  }

  // 1.5 AGENT TRANSAKSI (v1.18.0) — jalur tanpa keranjang (Telegram/api):
  // jawaban menautkan langsung ke halaman game + langkah transaksinya.
  if (detectPurchaseIntent(clean)) {
    const orderHit = resolveProductForOrder(clean, lexicon);
    if (orderHit) {
      const game = (lexicon.games || []).find((g) => g.id === orderHit.gameId);
      const product = (lexicon.products || []).find((p) => p.id === orderHit.productId);
      if (game && product) {
        const label = String(product.label || (product.tokens || []).join(" ") || product.id)
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const built = agentAddToCart({
          product,
          game,
          label,
          price: typeof product.priceIdr === "number" ? product.priceIdr : 0,
          userName,
          withCartAction: false,
          siteUrl: process.env.NEXA_SITE_URL || "https://nexastoregame.vercel.app",
        });
        return { intent: "agent.order_link", score: 1, answer: sanitizeAnswer(built.answer) };
      }
    }
  }

  // 2. Resolver katalog.
  const hit = resolveCatalogQuery(clean, lexicon);
  if (hit) {
    const nlp = await getNlpFor(custom.key, custom.modelJson);
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

  // 2.5 Lapisan kustom — dataset hasil impor (overlay TF-IDF, langsung hidup).
  if (custom.customIntents.length > 0) {
    const overlayHit = matchOverlay(custom.overlay, clean);
    if (overlayHit) {
      return {
        intent: overlayHit.intent,
        score: overlayHit.score,
        answer: sanitizeAnswer(personalize(overlayHit.answer, userName)),
      };
    }
  }

  // 2.6 OTAK CERDAS LLM (v1.19.0) — bila SDK tersedia (sandbox/produksi),
  // pertanyaan terbuka dijawab dengan pemahaman + penalaran atas data
  // leksikon live. Jalur tanpa keranjang (Telegram/api): jawaban menautkan
  // ke halaman game. Gagal/timeout/SDK absen → lanjut ke NLP lokal.
  try {
    const { llmAnswer } = require("./nexa-llm.js");
    const llmGames = (lexicon.games || []).map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug || g.id,
      orderFieldSchema: Array.isArray(g.orderFieldSchema) ? g.orderFieldSchema : [],
    }));
    const llmProducts = (lexicon.products || []).map((p) => ({
      id: p.id,
      gameId: p.gameId,
      name: p.gameName || "",
      denomination: p.denomFull || p.denom || "",
      priceIdr: typeof p.priceIdr === "number" ? p.priceIdr : 0,
      enabled: true,
      label: p.label,
    }));
    const today = new Intl.DateTimeFormat("id-ID", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta",
    }).format(new Date());
    const out = await llmAnswer({
      text: clean,
      userName,
      history: (ctx && ctx.history) || [],
      games: llmGames,
      products: llmProducts,
      promos: [],
      pendingProduct: null,
      cartActions: false,
      siteUrl: process.env.NEXA_SITE_URL || "https://nexastoregame.vercel.app",
      today,
    });
    if (out && out.answer) {
      return { intent: "llm.answer", score: 1, answer: sanitizeAnswer(out.answer.slice(0, 780)) };
    }
  } catch {
    /* LLM tak tersedia di lingkungan ini — lanjut ke NLP lokal */
  }

  // 3. NLP — jawaban positif hanya bila pesan dalam ranah (anti-hijack).
  const nlp = await getNlpFor(custom.key, custom.modelJson);
  const r = await nlp.process("en", clean);
  if (r && r.intent !== "None" && r.score >= 0.5 && r.answer) {
    const isRefusal = r.intent.startsWith("off.") || r.intent.startsWith("security.");
    if (isRefusal || withinDomain(clean, lexicon)) {
      // v1.17.0: renderer sadar-pengguna & sadar-fakta menimpa jawaban statis.
      const personal = renderIntentLive(r.intent, { lexicon, userName });
      if (personal) return { intent: r.intent, score: r.score, answer: sanitizeAnswer(personal) };
      return { intent: r.intent, score: r.score, answer: sanitizeAnswer(r.answer) };
    }
  }

  // 4. Gerbang konteks → fallback / tolakan.
  if (!withinDomain(clean, lexicon)) {
    return { intent: "off.Context", score: 1, answer: OFF_CONTEXT };
  }
  return { intent: "None", score: (r && r.score) || 0, answer: FALLBACK };
}

module.exports = { answer, mergeLexicon, loadBrain, loadCustomBrain, brainInfo, renderOrderStatus, ORDER_ID_RE, markdownToHtml, stripMarkdown };
