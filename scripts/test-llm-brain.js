/* Uji cepat otak LLM — pertanyaan yang kemarin gagal di NLP fallback. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { llmAnswer, llmStatus } = require(path.join(__dirname, "..", "nexa-llm.js"));

(async () => {
  const status = await llmStatus();
  console.log("LLM status:", JSON.stringify(status));

  const ROOT = path.join(__dirname, "..");
  const games = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog/games.json"), "utf8")).games;
  const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog/products.json"), "utf8")).products;

  const t0 = Date.now();
  const out = await llmAnswer({
    text: "game yang punya product paling murah apa, sebutin 1 saja",
    userName: "Dearly",
    history: [],
    games: games.filter((g) => g.enabled !== false),
    products,
    promos: [],
    cartActions: true,
    siteUrl: "https://nexastoregame.vercel.app",
    today: "Rabu, 21 Oktober 2026",
  });
  console.log(`--- ${(Date.now() - t0) / 1000}s ---`);
  if (!out) {
    console.log("GAGAL: LLM mengembalikan null");
    process.exit(1);
  }
  console.log("ANSWER:\n" + out.answer);
  console.log("\nACTION:", out.action ? JSON.stringify(out.action) : "(tidak ada)");
})().catch((e) => {
  console.error("ERROR:", e && e.message);
  process.exit(1);
});
