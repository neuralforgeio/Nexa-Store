/**
 * nexa-overlay.js — lapisan ambil-kembali (retrieval) untuk intent kustom (v1.17.0).
 *
 * Dataset hasil impor (panel AI developer) langsung HIDUP lewat lapisan ini —
 * TANPA menunggu pelatihan ulang: pesan pengguna dicocokkan secara statistik
 * (TF-IDF + cosine similarity) ke contoh kalimat tiap intent kustom. Ini tetap
 * "AI" dalam arti sesungguhnya (pembobotan kata, kemiripan vektor, normalisasi
 * bahasa Indonesia) — bukan pencocokan teks persis.
 *
 * Dipakai bersama oleh src/lib/nexa-bot/engine.ts (situs), nexa-standalone.js
 * (api/chat.js + bot Telegram). Lapisan ini berjalan SETELAH penjaga keamanan,
 * kalkulator, dan resolver katalog — sebelum klasifikasi NLP — sehingga jawaban
 * kustom menang atas jawaban bawaan bila kemiripannya meyakinkan.
 *
 * Murni lokal — tanpa network, tanpa dependensi.
 */

"use strict";

const MATCH_THRESHOLD = 0.42; // cosine similarity minimum agar kustom diterima
/**
 * Cari intent kustom yang paling mirip dengan pesan.
 * Skor intent = cosine TERBAIK di antara utterance-nya (retrieval standar —
 * intent dengan banyak utterance tidak "dihukum" oleh contoh yang tak mirip).
 * @returns {{intent:string, answer:string, score:number}|null}
 */
function matchOverlay(overlay, text) {
  if (!overlay || overlay.docs.length === 0) return null;
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const msgVec = messageVector(overlay, tokens);

  let best = null;
  for (const d of overlay.docs) {
    const score = cosine(msgVec, d.vec);
    if (!best || score > best.score) {
      best = { intent: d.intent, answer: d.answer, score };
    }
  }
  if (!best || best.score < MATCH_THRESHOLD) return null;
  return { intent: best.intent, answer: best.answer, score: Number(best.score.toFixed(3)) };
}

// Akhiran umum bahasa Indonesia yang dilepas saat tokenisasi (light stemming).
const SUFFIXES = ["nya", "ku", "mu", "kah", "lah", "pun", "dong", "sih", "deh"];

function dedupeLetters(word) {
  return word.replace(/([a-z])\1{1,}/g, "$1");
}

/** Tokenisasi + normalisasi: huruf kecil, pelurusan huruf ganda, stemming ringan. */
function tokenize(text) {
  const raw = String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (let w of raw) {
    w = dedupeLetters(w);
    let stripped = true;
    while (stripped) {
      stripped = false;
      for (const suf of SUFFIXES) {
        if (w.length > suf.length + 3 && w.endsWith(suf)) {
          w = w.slice(0, -suf.length);
          stripped = true;
          break;
        }
      }
    }
    if (w.length > 1) out.push(w);
  }
  return out;
}

/**
 * Bangun indeks ambil-kembali dari dataset kustom.
 * @param {Array<{intent:string, utterances:string[], answer:string}>} customIntents
 */
function buildOverlay(customIntents) {
  const docs = [];
  const df = new Map(); // term → jumlah utterance yang memuatnya
  for (const item of customIntents ?? []) {
    if (!item || typeof item.intent !== "string" || !Array.isArray(item.utterances)) continue;
    const intent = item.intent.startsWith("custom.") ? item.intent : `custom.${item.intent}`;
    const seenTerms = new Set();
    const utterances = [];
    for (const u of item.utterances) {
      const tokens = tokenize(u);
      if (tokens.length === 0) continue;
      utterances.push(tokens);
      const uniq = new Set(tokens);
      uniq.forEach((t) => seenTerms.add(t));
      docs.push({ intent, answer: String(item.answer ?? ""), tokens });
    }
    void seenTerms;
  }
  const N = Math.max(docs.length, 1);
  const dfMap = new Map();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) {
      dfMap.set(t, (dfMap.get(t) ?? 0) + 1);
    }
  }
  const idf = (term) => Math.log((N + 1) / ((dfMap.get(term) ?? 0) + 1)) + 1;
  // Precompute vektor tiap dokumen (L2 ternormalisasi).
  for (const d of docs) {
    const vec = new Map();
    const counts = new Map();
    for (const t of d.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    let norm = 0;
    for (const [t, c] of counts) {
      const w = (1 + Math.log(c)) * idf(t);
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    d.vec = vec;
  }
  return { docs, N, dfMap };
}

/** Vektor TF-IDF pesan pengguna (L2 ternormalisasi) atas idf overlay. */
function messageVector(overlay, tokens) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const N = overlay.N;
  const vec = new Map();
  let norm = 0;
  for (const [t, c] of counts) {
    const df = overlay.dfMap.get(t) ?? 0;
    const w = (1 + Math.log(c)) * (Math.log((N + 1) / (df + 1)) + 1);
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [t, w] of small) {
    const o = big.get(t);
    if (o) dot += w * o;
  }
  return dot; // keduanya sudah L2-normalisasi
}

/**
 * Ganti placeholder {name} pada jawaban kustom dengan nama pengguna.
 */
function personalize(text, userName) {
  const name = (userName ?? "").trim();
  return String(text ?? "").replace(/\{name\}/gi, name || "Kak");
}

module.exports = { buildOverlay, matchOverlay, personalize, tokenize, MATCH_THRESHOLD };
