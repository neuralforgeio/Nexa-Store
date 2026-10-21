/**
 * nexa-userctx.js — render jawaban yang sadar-pengguna & sadar-fakta (v1.17.0).
 *
 * Dipakai bersama oleh src/lib/nexa-bot/engine.ts (situs),
 * nexa-standalone.js (api/chat.js + bot Telegram). Prinsip: NLP memahami
 * BAHASA (intent), lapisan ini menyuntik FAKTA segar — nama pengguna dari
 * identitas chat, statistik toko dari leksikon live, dan status pesanan
 * dari data order.
 *
 * Murni lokal — tanpa network, tanpa dependensi.
 */

"use strict";

const idr = (n) => `Rp${Number(n ?? 0).toLocaleString("id-ID")}`;

/** Pola ID Order NEXA (identik skema zod orderRecordSchema). */
const ORDER_ID_RE = /\bNEXA-(\d{6})-([A-HJKMNP-TV-Z23-9]{4})\b/;

const STATUS_LABEL = {
  pending: { emoji: "⏳", label: "Menunggu Pembayaran" },
  processing: { emoji: "🔄", label: "Diproses" },
  success: { emoji: "✅", label: "Selesai" },
  cancel: { emoji: "❌", label: "Dibatalkan" },
};

/** Nama panggilan aman: "Dearly Febriano" → "Dearly", dibersihkan + dibatasi. */
function callName(userName) {
  const clean = String(userName ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.split(" ")[0].slice(0, 20);
}

/**
 * Sapaan pembuka personal — dipakai renderer greet.
 */
function greetOpening(userName) {
  const name = callName(userName);
  if (!name) return "Halo! 👋";
  return `Halo, ${name}! 👋`;
}

/**
 * Render jawaban intent dengan fakta live. Mengembalikan null bila intent
 * TIDAK punya renderer live (jawaban terlatih dipakai apa adanya).
 *
 * @param {string} intent intent hasil klasifikasi
 * @param {{lexicon?: object, userName?: string|null}} ctx
 *   lexicon — leksikon live (games[] dengan productCount, products[] dengan priceIdr)
 *   userName — nama pengunjung dari identitas chat / Telegram
 * @returns {string|null}
 */
function renderIntentLive(intent, ctx = {}) {
  const name = callName(ctx.userName);
  const lex = ctx.lexicon;

  switch (intent) {
    case "greet":
      return `${greetOpening(ctx.userName)} Aku Nexa Bot, asisten NEXA STORE ⚡ ${name ? "Ada yang bisa kubantu, " + name + "?" : "Ada yang bisa kubantu?"} Ketik nama game buat lihat harga, atau tanya "berapa total game", "cara top up", "rekomendasi termurah".`;

    case "user.know":
      if (name) {
        return `Tentu aku mengenalmu — kamu ${name}, kan? 😄 Namamu kubaca dari identitas chat-mu di sini. ${name}, ada yang bisa kubantu soal top up hari ini?`;
      }
      return "Tentu aku mau mengenalmu! 😄 Tekan tombol \"Ubah\" di bawah kolom chat buat memasang namamu — setelah itu aku hafal kamu dan bisa menyapamu dengan nama. Ada yang bisa kubantu soal top up?";

    case "user.name":
      if (name) {
        return `Kamu ${name}! 😄 Nama itu terpasang di identitas chat-mu — tekan "Ubah" di bawah kalau mau berganti nama. Aku selalu memanggilmu ${name}!`;
      }
      return "Aku belum tahu namamu 😅 Tekan tombol \"Ubah\" di bawah kolom chat buat memperkenalkan diri — gratis, tanpa akun, tanpa data pribadi.";

    case "bot.bye":
      return name
        ? `Sampai jumpa, ${name}! 🎮 Semoga rankmu naik terus. Balik kapan pun kamu butuh top up ya ⚡`
        : "Sampai jumpa! 🎮 Semoga rankmu naik terus. Balik kapan pun kamu butuh top up ya ⚡";

    case "bot.thanks":
      return name ? `Sama-sama, ${name}! 🙌 Kalau butuh apa-apa seputar top up, aku di sini ya ⚡` : null;

    default:
      break;
  }

  // --- renderer statistik: butuh leksikon live ---
  if (!lex || !Array.isArray(lex.games)) return null;
  const gameCount = lex.games.length;
  const productCount = Array.isArray(lex.products) ? lex.products.length : 0;

  switch (intent) {
    case "store.count.games": {
      if (!gameCount) return null;
      const topNames = lex.games.slice(0, 6).map((g) => g.name).join(", ");
      return `Ada ${gameCount} game di NEXA STORE 🔥 dengan total ${productCount} pilihan nominal. Populer: ${topNames}. Ketik "daftar game" buat lihat semuanya, atau langsung ketik nama game buat harga!`;
    }
    case "store.count.nominals": {
      if (!productCount) return null;
      return `Total ada ${productCount} pilihan nominal dari ${gameCount} game 💪 Rentangnya dari yang hemat sampai nominal jumbo. Ketik nama game buat lihat semua pilihannya, atau "rekomendasi termurah" buat yang paling hemat!`;
    }
    case "store.cheapest.overall": {
      const priced = (lex.products ?? []).filter((p) => typeof p.priceIdr === "number");
      if (priced.length === 0) return null;
      const cheapest = priced.reduce((m, p) => (p.priceIdr < m.priceIdr ? p : m), priced[0]);
      return `Nominal termurah di seluruh toko: ${cheapest.gameName} — ${cheapest.label} ${idr(cheapest.priceIdr)} 💸 Ketik "rekomendasi termurah" buat daftar per game!`;
    }
    case "store.priciest": {
      const priced = (lex.products ?? []).filter((p) => typeof p.priceIdr === "number");
      if (priced.length === 0) return null;
      const priciest = priced.reduce((m, p) => (p.priceIdr > m.priceIdr ? p : m), priced[0]);
      return `Nominal terbesar: ${priciest.gameName} — ${priciest.label} ${idr(priciest.priceIdr)} 💎 Nominal besar biasanya paling hemat per unit. Ketik nama game buat lihat semua rentang harganya!`;
    }
    default:
      return null;
  }
}

/**
 * Render resi status pesanan (dipakai engine situs & bot Telegram).
 * @param {object} order data order (id, status, items, total, statusReason…)
 * @returns {string}
 */
function renderOrderStatus(order) {
  if (!order) return "ID Order itu tidak aku temukan 😔 Cek lagi penulisannya (format NEXA-TANGGAL-KODE, contoh NEXA-260914-A7KP), atau buka halaman Lacak Pesanan.";
  const s = STATUS_LABEL[order.status] ?? { emoji: "📦", label: String(order.status ?? "?") };
  const lines = [`📦 ${order.id} — ${s.emoji} ${s.label}`];
  const items = Array.isArray(order.items) ? order.items.slice(0, 5) : [];
  for (const it of items) {
    lines.push(`• ${it.gameName} — ${it.productName} ${idr(it.price)}`);
  }
  if (Array.isArray(order.items) && order.items.length > 5) lines.push(`• …+${order.items.length - 5} item lagi`);
  if (typeof order.total === "number") lines.push(`Total: ${idr(order.total)}`);
  if (order.statusReason) lines.push(`Catatan admin: ${order.statusReason}`);
  lines.push("Resi lengkap ada di halaman Lacak Pesanan 📋");
  return lines.join("\n");
}

module.exports = {
  renderIntentLive,
  renderOrderStatus,
  ORDER_ID_RE,
  callName,
  idr,
};
