/**
 * nexa-resolve.js — lapisan resolusi entitas katalog untuk Nexa Bot (v1.15.0).
 *
 * Dipakai bersama oleh api/chat.js (Serverless Vercel, CommonJS),
 * src/lib/nexa-bot/engine.ts (Next.js), dan nexa-math.js (kalkulator)
 * lewat import relatif.
 *
 * Tugas: deteksi penyebutan game (alias) + nominal (angka / bonus n+m / kata
 * seperti "member mingguan") secara deterministik — seperti NER — supaya
 * pertanyaan presisi ("ff 350", "genshin 300+30") terjawab tepat, sementara
 * klasifikasi niat fuzzy tetap di tangan model NLP.
 *
 * v1.15.0: + resolveProductMention — pencarian produk LINTAS game untuk
 * kalkulator ("member mingguan dikali 2"); + sapaan fuzzy (halooo/haiii
 * dikenali lewat pelurusan huruf berulang).
 *
 * Murni lokal — tanpa network, tanpa dependensi.
 */

"use strict";

/** Kata kunci niat umum — bila muncul, resolusi katalog dilewati (biarkan NLP). */
const META_WORDS = [
  "cara", "gimana", "gmna", "bagaimana", "lacak", "cek", "status", "promo", "diskon",
  "kontak", "hubungi", "nomor", "admin", "jam", "siapa", "kapan", "kamu", "kabar",
  "populer", "terlaris", "hadiah", "kado", "bonus", "worth", "bantuan", "help", "menu",
  "error", "bug", "lapor", "laporan", "saran", "pembayaran", "bayar", "metode", "qris",
  "dana", "ovo", "gopay", "shopeepay", "whatsapp", "presiden", "cuaca", "berita",
  "coding", "kode", "program", "website", "bikin", "buat", "pembuat", "developer",
  "daftar", "semua", "malam", "pagi", "siang", "sore", "makasih", "terima",
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalisasi: huruf kecil, titik pemisah ribuan pada angka dilebur. */
function normalize(text) {
  return ` ${String(text).toLowerCase().replace(/\s+/g, " ").replace(/(\d)\.(\d{3})/g, "$1$2").trim()} `;
}

/** Pelurusan huruf berulang: "haloooo"/"haiii" → "halo"/"hai". */
function dedupeLetters(word) {
  return word.replace(/([a-z])\1{1,}/g, "$1");
}

/** Cari game berdasar alias — alias terpanjang menang (ff max > ff). */
function findGame(norm, lexicon) {
  let best = null;
  for (const game of lexicon.games || []) {
    for (const alias of game.aliases || []) {
      if (!alias || alias.length < 2) continue;
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(alias)}(?:$|[^a-z0-9])`);
      if (re.test(norm) && (!best || alias.length > best.alias.length)) {
        best = { game, alias };
      }
    }
  }
  return best;
}

/** Cari produk dari nominal: bonus n+m → angka → cakupan kata label. */
function findProduct(norm, products) {
  if (!products || products.length === 0) return null;

  const bonus = norm.match(/(\d{2,6})\s*\+\s*(\d{1,6})/);
  if (bonus) {
    const denomFull = `${bonus[1]}+${bonus[2]}`;
    const exact = products.find((p) => p.denomFull === denomFull);
    if (exact) return exact;
    const base = products.find((p) => p.denom === bonus[1] && p.bonus);
    if (base) return base;
  }

  const nums = [];
  for (const m of norm.matchAll(/(?:^|\s)(\d{2,6})(?=\s|$|\+)/g)) nums.push(m[1]);
  for (const n of nums) {
    const exact = products.find((p) => p.denom === n);
    if (exact) return exact;
  }

  const words = new Set(norm.trim().split(" "));
  let best = null;
  for (const p of products) {
    const toks = (p.tokens || []).filter((t) => t && t.length > 1);
    if (toks.length === 0) continue;
    let matched = 0;
    for (const t of toks) if (words.has(t)) matched++;
    if (matched === 0) continue;
    const ratio = matched / toks.length;
    if (ratio < 1 / 3) continue;
    if (
      !best ||
      matched > best.matched ||
      (matched === best.matched && ratio > best.ratio)
    ) {
      best = { product: p, matched, ratio };
    }
  }
  return best ? best.product : null;
}

/**
 * Resolusi kueri katalog.
 * @returns {{type:"product", productId:string, gameId:string, gameName:string}
 *          |{type:"game", gameId:string, gameName:string}|null}
 */
function resolveCatalogQuery(text, lexicon) {
  const norm = normalize(text);
  const hasMeta = META_WORDS.some((w) => norm.includes(` ${w} `) || norm.startsWith(` ${w} `));
  if (hasMeta) return null;

  const hit = findGame(norm, lexicon);
  if (!hit) return null;

  const products = (lexicon.products || []).filter((p) => p.gameId === hit.game.id);
  const product = findProduct(norm, products);
  if (product) {
    return { type: "product", productId: product.id, gameId: hit.game.id, gameName: hit.game.name };
  }
  return { type: "game", gameId: hit.game.id, gameName: hit.game.name };
}

/**
 * Resolusi penyebutan PRODUK lintas game — dipakai kalkulator nexa-math.
 * Menerima frasa bebas ("member mingguan", "ff 70", "ml 568") dan
 * mengembalikan kandidat produk berurutan skor, lengkap dengan harga
 * (priceIdr dibaca dari leksikon; engine mengisi harga LIVE).
 *
 * @returns {Array<{id:string, gameId:string, game:string, label:string, price:number}>}
 */
function resolveProductMention(text, lexicon) {
  const norm = normalize(text);
  if (!norm.trim()) return [];
  const words = norm.trim().split(" ").filter(Boolean);

  const out = [];
  const push = (p, game) => {
    if (!p || out.some((c) => c.id === p.id)) return;
    out.push({
      id: p.id,
      gameId: p.gameId,
      game: game.name,
      label: p.label || p.tokens?.join(" ") || p.id,
      price: typeof p.priceIdr === "number" ? p.priceIdr : 0,
    });
  };

  // Jalur 1: ada penyebutan game → fokus ke produk game itu.
  const hit = findGame(norm, lexicon);
  if (hit) {
    const products = (lexicon.products || []).filter((p) => p.gameId === hit.game.id);
    const exact = findProduct(norm, products);
    if (exact) {
      push(exact, hit.game);
      return out;
    }
    // Game disebut tanpa nominal → bukan produk; kalkulator mundur sopan.
    return [];
  }

  // Jalur 2: tanpa game → cari produk berdasar cakupan kata label di SEMUA
  // game ("member mingguan" → Free Fire / FF MAX / ML …). Satu kata harus
  // spesifik (mis. "weekly"); dua+ kata butuh cakupan ≥ 1/2 kata label.
  const all = lexicon.products || [];
  const scored = [];
  for (const p of all) {
    const toks = (p.tokens || []).filter((t) => t && t.length > 1);
    if (toks.length === 0) continue;
    let matched = 0;
    for (const w of words) if (toks.includes(w)) matched++;
    if (matched === 0) continue;
    const phraseSpecific = words.length >= 2 ? matched >= Math.min(2, words.length) : matched >= 1 && toks.length <= 3;
    if (!phraseSpecific) continue;
    const game = (lexicon.games || []).find((g) => g.id === p.gameId);
    if (!game) continue;
    scored.push({ p, game, score: matched / toks.length + matched });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored.slice(0, 4)) push(s.p, s.game);
  return out;
}

/** Gerbang konteks: apakah pesan berada dalam ranah NEXA STORE? */
function withinDomain(text, lexicon) {
  const norm = normalize(text).trim();
  if (!norm) return false;
  const words = norm.split(" ");
  const wordSet = new Set(words);
  const tokens = new Set(lexicon.domainTokens || []);
  for (const w of words) {
    if (tokens.has(w)) return true;
    // kembangan kata Indonesia: harga→harga-harganya, diamond→diamondku
    for (const suf of ["ku", "mu", "nya", "si", "dong", "deh", "yah", "aja", "saja"]) {
      if (w.length > suf.length + 2 && w.endsWith(suf) && tokens.has(w.slice(0, -suf.length))) return true;
    }
  }
  // Sapaan fuzzy: "haloo", "haiii", "hallooo" dikenali lewat pelurusan huruf
  // berulang — v1.14 gagal di sini ("haloo" ditolak sebagai di luar ranah).
  const greetings = new Set(lexicon.greetings || []);
  for (const w of words) {
    if (greetings.has(w)) return true;
    const folded = dedupeLetters(w);
    if (folded !== w && greetings.has(folded)) return true;
  }
  return false;
}

module.exports = {
  resolveCatalogQuery,
  resolveProductMention,
  withinDomain,
  normalize,
  findGame,
};
