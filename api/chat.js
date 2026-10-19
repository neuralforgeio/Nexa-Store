/* eslint-disable */
/**
 * api/chat.js — Nexa Bot Serverless Function (v1.15.0).
 *
 * Chatbot AI murni berbasis @nlpjs/basic. Fungsi ini me-load "otak" AI lokal
 * (file model.nlp hasil training train.js), menerima input teks via POST,
 * lalu memprosesnya SECARA LOKAL untuk mengembalikan jawaban & saran terbaik.
 * Tanpa API eksternal (OpenAI/Gemini), tanpa Vercel AI SDK.
 *
 * Pipeline v1.15.0 (nexa-standalone.js, dibagikan dengan bot Telegram):
 * penjaga keamanan (anti-bocor api key/env/kode) → kalkulator (nexa-math) →
 * resolver katalog → NLP → gerbang konteks.
 *
 * POST { "text": "harga free fire" }
 *   → { "ok": true, "data": { "bot": "Nexa Bot", "intent": "...", "score": 1,
 *        "answer": "..." } }
 * GET → info singkat.
 */

"use strict";

const standalone = require("../nexa-standalone.js");

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
    const out = await standalone.answer(text);
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
