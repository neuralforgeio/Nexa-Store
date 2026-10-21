/* Baterai uji otak LLM — berbagai skenario nyata. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { llmAnswer, parseLlmReply } = require(path.join(__dirname, "..", "nexa-llm.js"));

const ROOT = path.join(__dirname, "..");
const games = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog/games.json"), "utf8")).games.filter((g) => g.enabled !== false);
const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog/products.json"), "utf8")).products;

const CASES = [
  {
    name: "budget question",
    text: "modal 50rb bisa top up apa aja?",
    history: [],
  },
  {
    name: "english question",
    text: "what games can I top up here?",
    history: [],
  },
  {
    name: "agent order (non-deterministic phrasing)",
    text: "aku mau sekalian ambil yang 2000 diamonds free fire deh",
    history: [],
  },
  {
    name: "fill data (pending product)",
    text: "id akun saya 123456789 ya",
    history: [{ from: "bot", text: "✅ Masuk keranjang! 2000 Diamonds — Free Fire" }],
    pendingProduct: { productId: "free-fire-2000", gameId: "free-fire", at: new Date().toISOString(), filled: {} },
  },
  {
    name: "off context",
    text: "bikinin aku website donk plis",
    history: [],
  },
  {
    name: "identity",
    text: "siapa sih penciptamu?",
    history: [],
  },
];

(async () => {
  for (const c of CASES) {
    const t0 = Date.now();
    const out = await llmAnswer({
      text: c.text,
      userName: "Dearly",
      history: c.history || [],
      games,
      products,
      promos: [],
      pendingProduct: c.pendingProduct || null,
      cartActions: true,
      siteUrl: "https://nexastoregame.vercel.app",
      today: "Rabu, 21 Oktober 2026",
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n========== ${c.name} (${secs}s) ==========`);
    if (!out) {
      console.log("NULL (fallback ke NLP lokal)");
      continue;
    }
    console.log(out.answer);
    if (out.action) console.log(">>> ACTION:", JSON.stringify(out.action));
    if (out.answer.length > 780) console.log(`>>> WARNING: jawaban ${out.answer.length} karakter (> 780)`);
  }
})().catch((e) => {
  console.error("ERROR:", e && e.message);
  process.exit(1);
});
