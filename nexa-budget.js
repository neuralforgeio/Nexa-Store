/**
 * nexa-budget.js — kalkulator budget Nexa Bot (v1.20.0).
 *
 * Pola sama dengan nexa-math: deteksi pola (jumlah rupiah) → hitung PRESISI
 * dari data live → render Markdown. Menjawab "modal 50rb bisa top up apa?",
 * "duit 47 ribu cukup beli apa?", "dibawah 100rb ada apa aja?" dengan daftar
 * produk yang benar-benar muat di budget — tanpa menunggu LLM, berjalan
 * identik di sandbox maupun produksi.
 *
 * Murni lokal — tanpa network, tanpa dependensi.
 */

"use strict";

const idr = (n) => `Rp${Number(n ?? 0).toLocaleString("id-ID")}`;
const titleCase = (s) => String(s ?? "").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Padankan jumlah budget dari pesan ("50rb", "50 ribu", "200k", "dibawah
 * 100000", "modal 35 rb"). Konservatif — hanya pola yang jelas menyebut uang.
 * @returns {number|null} jumlah rupiah, atau null bila tak ada
 */
function parseBudget(text) {
  const t = ` ${String(text ?? "").toLowerCase().replace(/[.,](?=\d{3}\b)/g, "")} `;
  // "50rb", "50 ribu", "50k", "50rebu" — satuan ribu.
  const m1 = /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d+)?)\s*(?:rb\b|ribu\b|rebu\b|k\b|kilo\b)/.exec(t);
  if (m1) {
    const n = Number(String(m1[1]).replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }
  // "dibawah 100000", "kurang dari 50.000", "maksimal 75rb", "budget 100000".
  const m2 = /(?:dibawah|di bawah|bawah|kurang dari|maksimal|max\b|budget|modal|duit|uang|cukup)\s*(?:rp\.?\s*)?(\d{4,7})\b/.exec(t);
  if (m2) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n >= 1000) return n;
  }
  return null;
}

/** Kata konteks pembelian/rekomendasi — pola "NNrb" telanjang butuh salah satu. */
const CONTEXT_WORDS = [
  "top up", "topup", "top-up", "beli", "pesan", "bisa", "worth", "rekomen",
  "murah", "cukup", "dapat", "dapet", "nominal", "hemat", "gems", "diamond",
  "dm ", " uc", "vp", "robux", "coin", "point", "token", "gold", "cash",
];

/** Kata sinyal budget eksplisit — pola angka polos ikut sah bila ada salah satunya. */
const BUDGET_SIGNAL = /(?:dibawah|di bawah|kurang dari|maksimal|budget|modal|duit|uang|cukup|punya)/;

/**
 * Deteksi pertanyaan budget + hitung produk yang muat.
 * @param {string} text pesan pengguna
 * @param {Array<{id:string,gameId:string,label?:string,priceIdr?:number,gameName?:string}>} products leksikon produk live
 * @param {Array<{id:string,name:string,aliases?:string[]}>} games leksikon game live
 * @returns {null|{budget:number, gameName:string|null, cheapest:number|null,
 *   rows:Array<{gameId:string,gameName:string,label:string,price:number,productId:string}>}}
 */
function budgetMatch(text, products, games) {
  const t = ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  const budget = parseBudget(t);
  if (!budget || budget < 3000 || budget > 100_000_000) return null;

  const explicit = BUDGET_SIGNAL.test(t);
  const contextual = CONTEXT_WORDS.some((w) => t.includes(w));
  if (!explicit && !contextual) return null;

  const items = (products || []).filter(
    (p) => typeof p.priceIdr === "number" && p.priceIdr > 0 && p.priceIdr <= budget
  );
  if (items.length === 0) return null;

  // Game spesifik disebut? → fokus ke game itu. (Tanda baca dibersihkan
  // dulu — "di ml?" / "buat free fire?" tetap tertangkap.)
  const stripped = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  let game = null;
  for (const g of games || []) {
    const names = [
      String(g.name).toLowerCase(),
      String(g.name).toLowerCase().replace(/[^a-z0-9]+/g, ""),
      ...(Array.isArray(g.aliases) ? g.aliases : []),
    ];
    if (names.some((n) => n.length >= 2 && stripped.includes(` ${n} `))) {
      game = g;
      break;
    }
  }

  const row = (p) => ({
    gameId: String(p.gameId ?? ""),
    gameName: String(p.gameName ?? ""),
    label: titleCase(String(p.label ?? p.id ?? "")),
    price: p.priceIdr,
    productId: String(p.id ?? ""),
  });

  if (game) {
    const scoped = items.filter((p) => p.gameId === game.id);
    if (scoped.length === 0) {
      // Game disebut tapi tak ada yang muat — balas info termurah game itu.
      const all = (products || []).filter((p) => p.gameId === game.id && typeof p.priceIdr === "number");
      const cheapest = all.length > 0 ? Math.min(...all.map((p) => p.priceIdr)) : null;
      return { budget, gameName: String(game.name), cheapest, rows: [] };
    }
    const rows = scoped
      .slice()
      .sort((a, b) => b.priceIdr - a.priceIdr) // nominal terbesar yang muat dulu
      .slice(0, 6)
      .map(row);
    return { budget, gameName: String(game.name), cheapest: null, rows };
  }

  // Semua game: nominal TERBESAR per game yang masih muat (iterasi turun —
  // yang pertama terlihat per game = terbesar), tampil urut harga turun
  // (nilai terbaik dulu).
  const best = new Map();
  for (const p of items.slice().sort((a, b) => b.priceIdr - a.priceIdr)) {
    if (!best.has(p.gameId)) best.set(p.gameId, p);
  }
  const rows = [...best.values()]
    .sort((a, b) => b.priceIdr - a.priceIdr)
    .slice(0, 8)
    .map(row);
  return { budget, gameName: null, cheapest: null, rows };
}

/**
 * Render jawaban budget (Markdown, ≤ ~780 karakter).
 * v1.21.0: baris DINOMORI (1. 2. 3. …) supaya user tinggal balas angka /
 * "yang termurah" / "masukin yang point blank" — lapisan pick (nexa-pick.js)
 * langsung mengeksekusi add_to_cart tanpa mengetik perintah panjang.
 * @param {{budget:number, gameName:string|null, cheapest:number|null,
 *   rows:Array<{gameId:string,gameName:string,label:string,price:number}>}} hit hasil budgetMatch
 * @param {number|null} overallCheapest termurah se-toko (untuk kasus kosong)
 */
function renderBudgetAnswer(hit, overallCheapest) {
  const head = `### 💸 Modal ${idr(hit.budget)}${hit.gameName ? ` di ${hit.gameName}` : ""} cukup buat:`;

  if (hit.rows.length === 0) {
    const cheapest = hit.cheapest ?? (typeof overallCheapest === "number" ? overallCheapest : null);
    const tail = cheapest != null ? ` Yang paling murah ${hit.gameName ? `di ${hit.gameName}` : "di NEXA STORE"} mulai **${idr(cheapest)}**.` : "";
    return `${head}\n\nBelum ada nominal yang muat di budget itu 😅${tail}\n\n> Naikkan dikit budgetnya, atau tanya \`rekomendasi termurah\` buat lihat daftar termurah per game!`;
  }

  const lines = hit.rows.map(
    (r, i) => `${i + 1}. **${hit.gameName ? r.label : `${r.gameName} — ${r.label}`}** · ${idr(r.price)}`
  );
  const hint = hit.gameName
    ? `\n\n💡 Balas **angkanya** (\`1\`, \`2\`) — langsung kumasukkan ke keranjang!`
    : `\n\n💡 Bilang aja \`masukin yang point blank\` / \`yang termurah\` — otomatis kumasukkan ke keranjang sesuai budgetmu!`;
  const budget = 740 - head.length - hint.length;
  const out = [];
  let used = 0;
  for (const l of lines) {
    const add = (out.length ? "\n" : "") + l;
    if (used + add.length > budget) {
      out.push("…");
      break;
    }
    out.push(l);
    used += add.length;
  }
  return head + "\n\n" + out.join("\n") + hint;
}

module.exports = { parseBudget, budgetMatch, renderBudgetAnswer };
