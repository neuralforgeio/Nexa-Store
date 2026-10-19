/* eslint-disable */
/**
 * api/chat.js — Nexa Bot Serverless Function (v1.14.0).
 *
 * Chatbot AI murni berbasis @nlpjs/basic. Fungsi ini me-load "otak" AI lokal
 * (file model.nlp hasil training train.js), menerima input teks via POST,
 * lalu memprosesnya SECARA LOKAL untuk mengembalikan jawaban & saran terbaik.
 * Tanpa API eksternal (OpenAI/Gemini), tanpa Vercel AI SDK.
 *
 * POST { "text": "harga free fire" }
 *   → { "ok": true, "data": { "bot": "Nexa Bot", "intent": "...", "score": 1,
 *        "answer": "..." } }
 * GET → info singkat.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Nlp } = require("@nlpjs/basic");

// ---------------------------------------------------------------------------
// Otak: model.nlp (canonical) dengan fallback bundel nexa-brain.js yang ikut
// ter-bundle lewat require tracing — memastikan fungsi mandiri di Vercel.
// ---------------------------------------------------------------------------

let brainPromise = null;

function loadBrain() {
  if (!brainPromise) {
    brainPromise = Promise.resolve().then(() => {
      // Leksikon + persona selalu dari bundel runtime (ter-trace require).
      const bundled = require("../nexa-brain.js");
      let model = bundled.model;
      let source = "nexa-brain.js";
      // Model canonical hasil training dipakai bila file-nya terbaca.
      const candidates = [
        path.join(__dirname, "model.nlp"),
        path.join(__dirname, "..", "model.nlp"),
        path.join(process.cwd(), "model.nlp"),
      ];
      for (const p of candidates) {
        try {
          model = JSON.parse(fs.readFileSync(p, "utf8"));
          source = p;
          break;
        } catch {
          /* coba kandidat berikutnya */
        }
      }
      return { model, lexiconSource: bundled.lexicon, persona: bundled.persona, source };
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
// Resolver entitas katalog + gerbang konteks (logika lokal, tanpa network).
// ---------------------------------------------------------------------------

const { resolveCatalogQuery, withinDomain } = require("../nexa-resolve.js");

const FALLBACK =
  "Hmm, aku belum paham yang kamu tanya 😅 Aku Nexa Bot — asisten khusus NEXA STORE. Coba tanya: nama game (mis. \"free fire\"), \"cara top up\", \"lacak pesanan\", atau \"rekomendasi termurah\".";
const OFF_CONTEXT =
  "Maaf, di luar wewenangku 😅 Aku Nexa Bot — asisten khusus NEXA STORE (top up game). Aku nggak bisa bantu soal itu. Tanya aku soal harga game, cara top up, atau lacak pesanan ya!";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function answer(text, brain) {
  const clean = String(text ?? "").trim().slice(0, 800);
  if (!clean) return { intent: "None", score: 0, answer: FALLBACK };

  const lexicon = brain.lexiconSource;
  if (lexicon && !withinDomain(clean, lexicon)) {
    return { intent: "off.Context", score: 1, answer: OFF_CONTEXT };
  }

  if (lexicon) {
    const hit = resolveCatalogQuery(clean, lexicon);
    if (hit) {
      const nlp = await getNlp(brain.model);
      const intent = hit.type === "product" ? `price.${hit.productId}` : `game.${hit.gameId}`;
      try {
        const answers = await nlp.findAllAnswers("en", intent);
        if (answers && answers[0] && answers[0].answer) {
          return { intent, score: 1, answer: answers[0].answer };
        }
      } catch {
        /* jatuh ke fallback */
      }
      return { intent, score: 1, answer: FALLBACK };
    }
  }

  const nlp = await getNlp(brain.model);
  const r = await nlp.process("en", clean);
  if (!r || r.intent === "None" || !r.score || r.score < 0.5 || !r.answer) {
    return { intent: "None", score: (r && r.score) || 0, answer: FALLBACK };
  }
  return { intent: r.intent, score: r.score, answer: r.answer };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      data: {
        bot: "Nexa Bot",
        by: "Dearly Febriano Irwansyah (github.com/neuralforgeio)",
        engine: "@nlpjs/basic — model lokal NEXA STORE",
        usage: 'POST {"text":"harga free fire"}',
      },
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: { code: "method", message: "Gunakan POST." } });
    return;
  }

  let text = "";
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body);
      text = parsed && typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      text = "";
    }
  } else if (req.body && typeof req.body === "object") {
    text = typeof req.body.text === "string" ? req.body.text : "";
  }

  if (!text.trim()) {
    res.status(400).json({ ok: false, error: { code: "validation", message: 'Body harus {"text":"…"}.' } });
    return;
  }

  try {
    const brain = await loadBrain();
    const out = await answer(text, brain);
    res.status(200).json({
      ok: true,
      data: { bot: "Nexa Bot", intent: out.intent, score: out.score, answer: out.answer },
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: { code: "engine", message: "Otak Nexa Bot gagal dimuat: " + (e && e.message) },
    });
  }
};
