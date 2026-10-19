/**
 * nexa-guard.js — filter keamanan Nexa Bot (v1.15.0).
 *
 * Dua lapis pertahanan agar bot TIDAK PERNAH membocorkan rahasia:
 *  1) containsLeakAttempt(text) — deteksi UPAYA pengguna menggali rahasia
 *     (api key, token, env, source code, instruksi sistem, prompt injection).
 *  2) sanitizeAnswer(text)     — sapu JAWABAN: pola token/kredensial yang
 *     tak sengaja lolos (ghp_…, vcp_…, sk-…, AKIA…, process.env.X, path
 *     server, private key) diganti jadi [RAHASIA]. Bila jawaban terlalu
 *     "bocor", seluruh jawaban diganti jawaban aman.
 *
 * Murni lokal — tanpa network, tanpa dependensi. Dipakai bersama oleh
 * api/chat.js (Serverless Vercel, CommonJS) dan src/lib/nexa-bot/engine.ts.
 */

"use strict";

// ---------------------------------------------------------------------------
// 1) Deteksi upaya kebocoran dari sisi pengguna
// ---------------------------------------------------------------------------

/** Frasa berbahaya — cukup satu muncul untuk ditolak penjaga. */
const LEAK_PHRASES = [
  // kredensial & rahasia
  "api key", "apikey", "api-key", "api token", "access token", "secret key",
  "secretkey", "client secret", "app secret", "password kamu", "password lo",
  "sandi kamu", "kata sandi kamu", "kredensial", "credential",
  "token kamu", "token lo", "token bot", "bot token", "telegram token",
  "github token", "vercel token", "session secret", "private key",
  "kunci api", "kunci rahasia",
  // env & file sistem
  "env kamu", "env lo", "file env", ".env", "dot env", "dotenv",
  "process.env", "environment variable", "variabel lingkungan",
  "isi env", "baca env", "bocorkan env", "tunjukkan env", "kasih lihat env",
  // kode & internal
  "source code", "kode sumber", "kode kamu", "kodenya", "kode bot",
  "script kamu", "file kamu", "file bot", "struktur file",
  "bocorkan kode", "bocorkan data", "bocorkan rahasia", "bocorkan token",
  "tunjukkan kode", "tunjukkan kode", "lihat kode", "kasih kode",
  "print source", "dump source", "dump env", "printenv", "print env",
  "system prompt", "instruksi sistem", "prompt kamu", "prompt kamu",
  "prompt awal", "base prompt", "aturan kamu", "rules kamu",
  "konfigurasi kamu", "config kamu", "setting rahasia",
  // injeksi instruksi
  "ignore previous", "abaikan instruksi", "lupakan instruksi",
  "abaikan aturan", "lupakan aturan", "ignore all instructions",
  "disregard instructions", "developer mode", "mode pengembang",
  "pretend you are", "berpura pura jadi", "anggap kamu",
  "kamu diberi izin", "you are now", "jailbreak", "dan mode",
  // infrastruktur
  "database url", "connection string", "dsn kamu", "sandbox kredensial",
];

/** Pola token mentah yang tertanam di pesan (user menempelkan/menggali). */
const LEAK_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/i,
  /\bvcp_[A-Za-z0-9_\-]{16,}\b/i,
  /\bsk-[A-Za-z0-9_\-]{16,}\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[0-9]+:[A-Za-z0-9_-]{30,}\b/, // format token bot telegram <id>:<hash>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, // JWT
];

/**
 * Apakah pesan pengguna adalah upaya menggali rahasia?
 * Dipanggil SEBELUM pipeline jawaban — bila true, bot menolak.
 */
function containsLeakAttempt(text) {
  const norm = ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ")} `;
  for (const phrase of LEAK_PHRASES) {
    if (norm.includes(phrase)) return true;
  }
  for (const re of LEAK_PATTERNS) {
    if (re.test(text ?? "")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 2) Sapu jawaban — pola rahasia tak sengaja lolos diganti [RAHASIA]
// ---------------------------------------------------------------------------

/** Jawaban pengganti saat upaya kebocoran terdeteksi. */
const GUARD_ANSWER =
  "Aku tidak bisa membagikan informasi internal itu 🔒 Aku Nexa Bot — asisten " +
  "NEXA STORE untuk soal harga game, cara top up, dan lacak pesanan. Ada yang " +
  "bisa kubantu soal top up?";

const SECRET_IN_ANSWER = [
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/gi,
  /\bvcp_[A-Za-z0-9_\-]{16,}\b/gi,
  /\bsk-[A-Za-z0-9_\-]{16,}\b/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bprocess\.env\.[A-Z_][A-Z0-9_]*\b/gi,
  /\bnexa_session=[A-Za-z0-9._-]{10,}\b/gi,
  /(?:^|\s)\/(?:home|root|vercel|app|srv)\/[^\s"']{4,}/g,
];

/**
 * Bersihkan jawaban: setiap kemunculan pola rahasia diganti [RAHASIA].
 * Mengembalikan teks yang aman untuk dikirim ke pengunjung.
 */
function sanitizeAnswer(text) {
  let out = String(text ?? "");
  for (const re of SECRET_IN_ANSWER) {
    out = out.replace(re, "[RAHASIA]");
  }
  return out;
}

module.exports = { containsLeakAttempt, sanitizeAnswer, GUARD_ANSWER };
