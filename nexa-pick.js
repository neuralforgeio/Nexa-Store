/**
 * nexa-pick.js — lapisan PEMILIHAN CERDAS Nexa Bot (v1.21.0).
 *
 * Masalah yang diselesaikan: bot sudah menampilkan daftar (budget, harga
 * game, rekomendasi) tapi user tetap disuruh mengetik perintah panjang
 * ("pesan 1200 pb cash point blank") sebelum produk dimasukkan ke keranjang.
 * Padahal user cukup memilih: "1", "yang kedua", "1200", "masukin yang point
 * blank itu", "yang termurah aja".
 *
 * Modul ini menafsirkan PILIHAN user terhadap OPsi yang sedang aktif
 * (daftar produk yang barusan bot tampilkan / tawarkan) dan mengembalikan
 * produk tunggal atau kandidat yang harus dikonfirmasi.
 *
 * Murni lokal — tanpa network, tanpa dependensi.
 */

"use strict";

// ---------------------------------------------------------------------------
// Normalisasi & ordinal
// ---------------------------------------------------------------------------

function norm(text) {
  return ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;
}

const ORDINAL_WORDS = [
  ["pertama", 1], ["kesatu", 1], ["satu", 1],
  ["kedua", 2], ["dua", 2],
  ["ketiga", 3], ["tiga", 3],
  ["keempat", 4], ["empat", 4],
  ["kelima", 5], ["lima", 5],
  ["keenam", 6], ["enam", 6],
  ["ketujuh", 7], ["tujuh", 7],
  ["kedelapan", 8], ["delapan", 8],
];

/**
 * Indeks pilihan dari pesan: "1", "2.", "no 2", "nomor 2", "yang ketiga",
 * "ke-2", "pilih 2", "yang terakhir". Hanya sah bila 1..maxIndex.
 * @returns {number|null} indeks berbasis-1, atau null.
 */
function parseOrdinalIndex(text, maxIndex) {
  if (!maxIndex || maxIndex < 1) return null;
  const t = String(text ?? "").toLowerCase().trim();
  if (!t || t.length > 40) return null;

  // Angka telanjang kecil: "1", "2.", "3)"
  if (/^\d{1,2}\s*[.)!]?$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 && n <= maxIndex ? n : null;
  }
  // "no 2", "nomor 2", "pilih 2", "ambil 2", "yang ke 2", "ke-2", "yg ke2"
  const m =
    /\b(?:no|nomor|nomor\s+urut|pilih|ambil|yang|yg|ke|number|urutan)\s*[-#]?\s*(\d{1,2})\b/.exec(
      t
    ) || /(?:^|\s)ke-?(\d{1,2})\b/.exec(t);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= maxIndex ? n : null;
  }
  // Kata urutan: "yang kedua", "yang pertama", "kedua aja"
  const words = ` ${t.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const [word, idx] of ORDINAL_WORDS) {
    if (new RegExp(`(?:^|\\s)(?:yang\\s+|yg\\s+)?${word}(?:\\s|$)`).test(words)) {
      return idx >= 1 && idx <= maxIndex ? idx : null;
    }
  }
  if (/(?:^|\s)(?:yang\s+)?terakhir(?:\s|$)/.test(words)) return maxIndex;
  return null;
}

/** Apakah pesan pada dasarnya cuma sebuah PILIHAN (bukan kalimat penuh)? */
function isBarePick(text) {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t || t.length > 60) return false;
  if (/^\d{1,2}\s*[.)!ajsongdehylku]*$/.test(t)) return true; // "1", "2 aja", "3 dong"
  if (/^\d{2,6}\s*(?:aja|saja|dong|deh|ya|itu)?\s*[.!]?$/.test(t)) return true; // "1200", "1200 aja"
  if (/^(?:yang|yg|pilih|ambil|nomor|no|number|ke)\b/.test(t) && /\d/.test(t)) return true;
  if (/\b(?:pertama|kedua|ketiga|keempat|kelima|keenam|ketujuh|kedelapan|terakhir)\b/.test(t)) return true;
  if (/\b(?:termurah|termahal|paling murah|paling mahal|paling worth|paling enak)\b/.test(t) && t.split(" ").length <= 6) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Selektor harga
// ---------------------------------------------------------------------------

/** Penyebutan harga ("10rb", "rp10000", "246k") untuk mencocokkan opsi. */
function priceMentionOf(text) {
  const t = String(text ?? "").toLowerCase();
  let m = /rp\s*\.?\s*(\d{3,9})/.exec(t) || /(\d{2,9}(?:[.,]\d{3})+)/.exec(t) || /(\d{1,9})\s*(?:rb|k|ribu)\b/.exec(t);
  if (!m) return null;
  let v = Number(String(m[1]).replace(/[.,]/g, ""));
  if (!Number.isFinite(v) || v <= 0) return null;
  if (/rb|k|ribu/.test(m[0])) v *= 1000;
  return v >= 1000 ? v : null;
}

// ---------------------------------------------------------------------------
// Resolusi pilihan terhadap opsi aktif
// ---------------------------------------------------------------------------

/**
 * Tafsirkan pesan user terhadap daftar opsi yang sedang aktif.
 * @param {string} text pesan user
 * @param {Array<{productId:string, gameId:string, label:string, price:number}>} options opsi aktif (urut tampil)
 * @param {{games:Array<{id:string,name:string,aliases?:string[]}>, products?:Array<object>}} lexicon leksikon (deteksi game)
 * @returns {{kind:"unique", pick:object, why:string}
 *          |{kind:"ambiguous", candidates:object[], why:string}
 *          |{kind:"none"}}
 */
function resolvePick(text, options, lexicon) {
  if (!Array.isArray(options) || options.length === 0) return { kind: "none" };
  const t = norm(text);
  if (!t.trim()) return { kind: "none" };

  const pick = (o, why) => ({ kind: "unique", pick: o, why });
  const ambiguous = (cands, why) => ({
    kind: "ambiguous",
    candidates: cands.slice(0, 4),
    why,
  });

  // 1) Indeks urutan: "1", "yang kedua", "nomor 3"
  const idx = parseOrdinalIndex(text, options.length);
  if (idx) return pick(options[idx - 1], `nomor ${idx}`);

  // 2) Penyebutan game → saring opsi game itu.
  const gameHit = findGameLite(t, lexicon);
  if (gameHit) {
    const forGame = options.filter((o) => o.gameId === gameHit.id);
    if (forGame.length === 1) return pick(forGame[0], "sesuai rekomendasi tadi");
    if (forGame.length > 1) {
      // Dalam satu game, coba pecahkan dengan nominal/harga di pesan yang sama.
      const narrowed = narrowByNumber(text, forGame);
      if (narrowed) return narrowed.length === 1 ? pick(narrowed[0], "nominalnya") : ambiguous(narrowed, "beberapa nominal");
      return ambiguous(forGame, "beberapa nominal");
    }
    // Game disebut tapi tak ada di opsi — biarkan lapisan lain (resolver katalog).
  }

  // 3) Nominal / harga di pesan (tanpa penyebutan game).
  const byNumber = narrowByNumber(text, options);
  if (byNumber) return byNumber.length === 1 ? pick(byNumber[0], "nominalnya") : ambiguous(byNumber, "beberapa produk");

  // 4) "Yang termurah" / "yang termahal".
  const t2 = t.trim();
  if (/\b(?:termurah|paling murah|paling hemat|termahal|paling mahal)\b/.test(t2)) {
    const wantCheap = !/mahal/.test(t2);
    const sorted = options.slice().sort((a, b) => (wantCheap ? a.price - b.price : b.price - a.price));
    const best = sorted[0];
    const ties = sorted.filter((o) => o.price === best.price);
    if (ties.length === 1) return pick(best, wantCheap ? "yang termurah" : "yang termahal");
    return ambiguous(ties, "harga sama");
  }

  // 5) Hanya satu opsi aktif + pesan mengarah ke pemesanan → ambil langsung.
  if (options.length === 1) return pick(options[0], "sesuai rekomendasi tadi");

  return { kind: "none" };
}

/** Nominal angka atau harga di pesan dicocokkan ke label/harga opsi. */
function narrowByNumber(text, options) {
  const t = ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ")} `;
  // Angka berdiri sendiri (bukan bagian "rp…"/"…rb" yang berarti harga).
  const nums = [];
  for (const m of t.matchAll(/(?:^|\s)(\d{2,6})(?=\s|$|\+)/g)) nums.push(m[1]);
  const price = priceMentionOf(text);

  if (nums.length > 0) {
    const hits = options.filter((o) =>
      nums.some((n) =>
        String(o.label ?? "")
          .toLowerCase()
          .split(/[^a-z0-9+]+/)
          .includes(n)
      )
    );
    if (hits.length >= 1) return hits;
  }
  if (price) {
    const hits = options.filter((o) => Math.abs((o.price ?? 0) - price) <= 500);
    if (hits.length >= 1) return hits;
  }
  return null;
}

/** Deteksi game ringan (tanpa lebar alias penuh) — cukup id+nama+alias. */
function findGameLite(normText, lexicon) {
  const games = (lexicon && lexicon.games) || [];
  let best = null;
  for (const g of games) {
    const names = [
      String(g.name ?? "").toLowerCase(),
      ...(Array.isArray(g.aliases) ? g.aliases : []),
    ];
    for (const n of names) {
      if (!n || n.length < 2) continue;
      if (normText.includes(` ${n} `) && (!best || n.length > best.len)) {
        best = { id: g.id, name: g.name, len: n.length };
      }
    }
  }
  return best;
}

module.exports = {
  parseOrdinalIndex,
  isBarePick,
  priceMentionOf,
  resolvePick,
  findGameLite,
};
