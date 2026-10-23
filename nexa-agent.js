/**
 * nexa-agent.js — lapisan AGENT transaksi Nexa Bot (v1.18.0).
 *
 * Dipakai bersama oleh src/lib/nexa-bot/engine.ts (chat web — dengan aksi
 * keranjang) dan nexa-standalone.js (Telegram/api — tanpa aksi, jawaban
 * menautkan ke halaman game). Murni lokal — tanpa network, tanpa dependensi.
 *
 * Kemampuan:
 * 1. detectPurchaseIntent — pesan "pesan 2000 diamonds rp246.000 ff"
 *    dikenali sebagai PERINTAH MEMESAN (bukan pertanyaan harga).
 * 2. extractAccountData — "id saya 123456789 server 2345 nama Dearly"
 *    diekstrak ke field skema order game (orderFieldSchema).
 * 3. builder jawaban MARKDOWN rapi (#/## heading, **tebal**, daftar bernomor,
 *    `kode`, > blockquote) + payload aksi keranjang untuk klien web.
 * 4. stripMarkdown — untuk jalur Telegram (teks polos).
 *
 * Aksi bersifat EPHEMERAL: dikirim hanya lewat respons POST chat — tidak
 * pernah dipersist di data store (mencegah replay duplikat saat reload).
 */

"use strict";

const idr = (n) => `Rp${Number(n ?? 0).toLocaleString("id-ID")}`;

/** Umur simpan "produk tertunda" per percakapan — data akun masih diharapkan. */
const AGENT_TTL_MS = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1. Deteksi niat memesan
// ---------------------------------------------------------------------------

/** Kata kerja pemesanan — salah satu cukup sebagai pemicu. */
const ORDER_TRIGGERS = [
  "pesan", "pesanin", "pesan dong", "beli", "beliin", "belikan", "belinya",
  "order", "ordernya", "ordering", "checkout", "gas", "gasin", "gaskeun",
  "eksekusi", "ekskusi", "proses", "prosesin", "ambil", "ambilin", "minta",
  "mintain", "mau", "pengen", "pengin", "add to cart", "masukin keranjang",
  "masukkan keranjang", "keranjangin", "top up sekalian", "topup sekalian",
  "top up", "topup", "inject", "tolong belikan", "dw", "japri",
];

/** Penanda pertanyaan/informasi — membatalkan pemicu pemesanan. */
const QUESTION_BLOCKS = [
  "berapa", "brp", "harga", "gimana", "gmna", "gmn", "bagaimana", "cara",
  "kenapa", "knapa", "kapan", "kok", "apakah", "apa itu", "apa aja", "apa saja",
  "rekomendasi", "termurah", "termahal", "paling murah", "murah", "promo",
  "diskon", "daftar", "list", "lihat", "liat", "kontak", "admin", "jam",
  "aman", "scam", "trust", "legit", "info", "tanya", "nanya", "beda",
  "masalah", "error", "bug", "lacak", "status", "resi", "refund", "garansi",
  "bisa ga", "gak bisa", "ga bisa", "nggak bisa", "udah", "sudah", "belum",
  "kenal", "kamu", "siapa", "nama kamu", "pembuat", "creator", "human",
  "orang", "manusia", "ganti", "ubah", "hapus", "batal", "cancel", "mana",
  "dimana", "kemana", "sampai", "kirimin", "kirim foto", "foto",
];

/**
 * v1.21.0 — pola KERANJANG: kata kerja aksi dan kata "keranjang" boleh
 * TERPISAH ("masukin yang point blank itu ke keranjang dong") — dulu kata
 * pemicu harus contiguous ("masukin keranjang") sehingga pesan seperti ini
 * lolos ke resolver katalog dan user disuruh mengetik ulang perintah panjang.
 */
const CART_NOUN_RE = /\b(?:keranjang\w*|kerenjang\w*|krnj|cart|chart)\b/;
const CART_VERB_RE =
  /\b(?:masuk\w*|taruh|taro|taroin|simpan\w*|pindah\w*|bikin\w*|jadiin|add|input|insert)\b/;

/**
 * v1.21.0 — pola RUJUKAN pilihan: "yang point blank itu", "yang 1200 aja",
 * "point blank aja deh" — user memilih dari daftar yang barusan bot tampilkan.
 * Hanya untuk pesan pendek tanpa kata tanya.
 */
const REFERENCE_RE =
  /\byang\b[\s\S]{0,48}\b(?:aja|saja|itu|tadi|tersebut|dong|deh|yuk|banget)\b|\b(?:aja|saja)\s*(?:deh|dong|ya|lah)?\s*[.!]?\s*$/;

function normalizeLite(text) {
  return ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;
}

/** Apakah pesan bermaksud MEMESAN (bukan bertanya)? */
function detectPurchaseIntent(text) {
  const norm = normalizeLite(text);
  if (norm.trim().length < 4) return false;
  for (const w of QUESTION_BLOCKS) {
    if (norm.includes(` ${w} `)) return false;
  }
  if (ORDER_TRIGGERS.some((w) => norm.includes(` ${w} `))) return true;
  // Pola keranjang terpisah: "masukin yang X itu ke keranjang".
  if (CART_NOUN_RE.test(norm) && CART_VERB_RE.test(norm)) return true;
  // Rujukan pilihan pendek: "yang point blank itu", "yang 1200 aja".
  const short = norm.trim();
  if (short.length <= 80 && REFERENCE_RE.test(short)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 2. Ekstraksi data akun dari pesan bebas
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Peta label field → frasa kunci pencarian (urut panjang menang). */
const FIELD_ALIASES = [
  {
    match: /user\s*_?\s*i\s*_?\s*d|^uid$|player|^id$|akun/i,
    keys: ["user id saya", "user id aku", "user id gue", "user id gw", "user id kamu",
      "user id", "userid", "uid", "player id", "id player", "id akun", "idnya",
      "id saya", "id aku", "id gue", "id gw", "id kamu", "id lu", "id lo",
      "no id", "nomor id", "id"],
  },
  {
    match: /server|zone|zona/i,
    keys: ["server id", "id server", "zone id", "id zone", "zona", "server", "zone"],
  },
  {
    match: /nick|nama|username|^ign/i,
    keys: ["nickname", "nick name", "nick aku", "nick saya", "nick kamu", "nick",
      "nama akun", "nama saya", "nama aku", "nama kamu", "username", "user name",
      "ign", "nama"],
  },
  {
    match: /email|gmail|mail/i,
    keys: ["email", "gmail", "e mail", "mail"],
  },
  {
    match: /login|riot/i,
    keys: ["riot id", "id riot", "login id", "id login", "riot", "login"],
  },
  {
    match: /whatsapp|nomor|phone|hp|^wa$/i,
    keys: ["nomor whatsapp", "nomor wa", "no whatsapp", "no wa", "whatsapp",
      "nomor hp", "no hp", "nomor", "phone", "hp", "wa"],
  },
];

function fieldKeysFor(field) {
  const label = String(field.label ?? field.key ?? "").toLowerCase();
  const alias = FIELD_ALIASES.find((a) => a.match.test(label) || a.match.test(String(field.key ?? "")));
  const keys = new Set(alias ? alias.keys : []);
  keys.add(label);
  keys.add(label.replace(/\s+/g, ""));
  return [...keys].filter(Boolean).sort((a, b) => b.length - a.length);
}

/** Validasi nilai terhadap skema field (minLength/maxLength/pattern). */
function valueOk(field, value) {
  const v = String(value ?? "");
  if (field.type === "number" && !/^\d{2,16}$/.test(v)) return false;
  if (typeof field.minLength === "number" && v.length < field.minLength) return false;
  if (typeof field.maxLength === "number" && v.length > field.maxLength) return false;
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(v)) return false;
    } catch {
      /* pola rusak — anggap lolos */
    }
  }
  return true;
}

const PRONOUNS = "(?:nya|saya|aku|gue|gw|kamu|lu|lo)";

/** Kata yang menandai AWAL instruksi lain — pemotong nilai teks. */
const STOP_RE = /\b(id|uid|server|zone|zona|nick|nickname|nama|ign|username|email|gmail|login|riot|wa|hp|nomor|pesan|beli|order|checkout|dong|deh|ya|kak|bang|min)\b/i;

/**
 * Ekstrak nilai field skema order dari pesan bebas.
 * @param {string} text pesan pengguna
 * @param {Array<{key:string,label:string,type?:string,required?:boolean,minLength?:number,maxLength?:number,pattern?:string}>} orderFields skema order game
 * @returns {{fields:Object<string,string>,hits:Array<{key:string,label:string,value:string}>,customerName?:string}|null}
 *   null bila tidak ada satu pun data yang berhasil diekstrak.
 */
function extractAccountData(text, orderFields) {
  let work = normalizeLite(text);
  const fields = {};
  const hits = [];
  const fieldsSafe = Array.isArray(orderFields) ? orderFields : [];

  const setHit = (f, value) => {
    fields[f.key] = value;
    hits.push({ key: f.key, label: f.label ?? f.key, value });
  };

  // Pola baku Mobile Legends: "12345678(2345)" / "12345678 (2345)".
  const idZone = /(\d{5,12})\s*\(\s*(\d{3,6})\s*\)/.exec(work);
  if (idZone) {
    const uidField = fieldsSafe.find((f) => /user\s*_?\s*i\s*_?\s*d|^uid$|player/i.test(String(f.label ?? f.key)));
    const zoneField = fieldsSafe.find((f) => /server|zone|zona/i.test(String(f.label ?? f.key)));
    if (uidField && zoneField && valueOk(uidField, idZone[1]) && valueOk(zoneField, idZone[2])) {
      setHit(uidField, idZone[1]);
      setHit(zoneField, idZone[2]);
      work = work.replace(idZone[0], " ".repeat(idZone[0].length));
    }
  }

  for (const f of fieldsSafe) {
    const keys = fieldKeysFor(f);
    let matched = null;
    for (const key of keys) {
      if (matched) break;
      // Nilai teks dibatasi 3 token — mencegah menelan sisa kalimat.
      const valueSrc =
        f.type === "number"
          ? "(\\d{2,16})"
          : "([a-z0-9][a-z0-9._@\\-]*(?:\\s[a-z0-9][a-z0-9._@\\-]*){0,2})";
      const re = new RegExp(
        `(^|[^a-z0-9])${escapeRe(key)}\\s*${PRONOUNS}?\\s*[:=\\-]?\\s*${valueSrc}`,
        "i"
      );
      const m = re.exec(work);
      if (!m) continue;
      let value = m[2].trim().replace(/[.,;!]+$/, "");
      // Potong nilai teks di kata kunci berikutnya ("Dearly id 123" → "Dearly").
      const stopCut = value.search(STOP_RE);
      if (stopCut > 0) value = value.slice(0, stopCut).trim();
      if (!value || !valueOk(f, value)) continue;
      matched = { key: f.key, label: f.label ?? f.key, value };
    }
    if (matched) {
      fields[matched.key] = matched.value;
      hits.push(matched);
      // Konsumsi span agar kunci generik ("id") tidak mencuri teks yang sama.
      const spanRe = new RegExp(escapeRe(matched.value));
      work = work.replace(spanRe, (s) => " ".repeat(s.length));
    }
  }

  // Angka telanjang: field numerik wajib yang tersisa vs sisa angka di pesan.
  // PENTING (v1.19.0): bila pesan berbau PERTANYAAN ("berapa", "harga", "?"),
  // angka telanjang HARAM dipakai sebagai data — "kalo yang 5000 diamonds
  // berapa?" adalah pertanyaan harga, bukan pengiriman data akun.
  const asksPrice = /(berapa|harga|gmn|gimana|bagaimana|kenapa|kapan|\?)/.test(work);
  const leftovers = [];
  for (const m of work.matchAll(/(?:^|\s)(\d{4,16})(?=\s|$)/g)) leftovers.push(m[1]);
  const needNumbers = fieldsSafe.filter(
    (f) => f.required !== false && f.type === "number" && !fields[f.key]
  );
  if (!asksPrice && needNumbers.length > 0 && leftovers.length > 0) {
    if (needNumbers.length === 1 && leftovers.length >= 1) {
      const f = needNumbers[0];
      const value = leftovers[0];
      if (valueOk(f, value)) {
        fields[f.key] = value;
        hits.push({ key: f.key, label: f.label ?? f.key, value });
      }
    } else if (needNumbers.length === leftovers.length) {
      needNumbers.forEach((f, i) => {
        const value = leftovers[i];
        if (valueOk(f, value)) {
          fields[f.key] = value;
          hits.push({ key: f.key, label: f.label ?? f.key, value });
        }
      });
    }
  }

  // Nama pembeli: "nama saya Dearly", "nickname: xXProXx", "panggil aku Rian".
  let customerName;
  const nameM = /(?:nama|nick(?:name)?|panggil(?:an)?|username|ign)\s*(?:saya|aku|gue|gw|kamu)?\s*[:=\-]?\s*([a-z0-9][a-z0-9 ._\-]{1,30})/i.exec(
    normalizeLite(text)
  );
  if (nameM) {
    let captured = nameM[1].trim().replace(/\s+/g, " ");
    // Potong di kata kunci field pertama ("nama saya Dearly id 123" → "Dearly").
    const cut = captured.search(STOP_RE);
    if (cut > 0) captured = captured.slice(0, cut).trim();
    captured = captured.split(/\s+/).slice(0, 4).join(" ").slice(0, 40);
    if (captured.length >= 2 && !STOP_RE.test(captured) && !/^\d+$/.test(captured)) {
      customerName = captured;
    }
  }

  if (hits.length === 0 && !customerName) return null;
  return { fields, hits, ...(customerName ? { customerName } : {}) };
}

// ---------------------------------------------------------------------------
// 3. Builder jawaban (MARKDOWN) + aksi keranjang
// ---------------------------------------------------------------------------

function requiredList(orderFields) {
  const req = (orderFields ?? []).filter((f) => f.required !== false);
  return req.map((f) => `**${f.label ?? f.key}**`);
}

/**
 * Jawaban + aksi ketika produk berhasil dimasukkan ke keranjang.
 * @param {{product:{id:string},game:{id:string,slug?:string,name:string,orderFieldSchema?:Array<object>},label:string,price:number,userName?:string|null,withCartAction?:boolean,siteUrl?:string,contextNote?:string}} p
 * contextNote (v1.21.0): alasan singkat pilihan — "Sesuai budget kamu tadi",
 * "Pilihan no. 2", "Yang termurah" — membuat ack agent terasa paham konteks.
 */
function agentAddToCart(p) {
  const { product, game, label, price, userName, withCartAction, siteUrl, contextNote } = p;
  const orderFields = game.orderFieldSchema ?? [];
  const req = requiredList(orderFields);
  const reqText = req.length > 0 ? req.join(", ") : "cukup **nama kamu**";
  const callName = String(userName ?? "").trim().split(" ")[0];

  if (!withCartAction) {
    // Jalur Telegram/api: tidak ada keranjang — arahkan ke halaman game.
    const base = String(siteUrl ?? "https://nexastoregame.vercel.app").replace(/\/$/, "");
    const slug = game.slug ?? game.id;
    return {
      answer:
        `### ✅ Siap, ini pesanannya!\n\n**${label}** — ${game.name}\n💵 **${idr(price)}**\n\n` +
        `Checkout & keranjang hanya ada di situs ya — ini langsung ke nominalnya:\n` +
        `🔗 ${base}/games/${slug}\n\nDi sana: pilih nominal → isi data akun → **Checkout via WhatsApp** 📱`,
      action: null,
    };
  }

  const reqHint =
    req.length > 0
      ? `Kamu perlu isi: ${req.join(", ")}. Boleh langsung kirim di chat ini — contoh \`id saya 123456789\` — otomatis kuisikan ke keranjangmu 🤖`
      : `Cukup isi **nama kamu** saat checkout — atau kirim di sini lewat \`nama saya …\` 🤖`;

  const note = contextNote ? `*${String(contextNote).slice(0, 60)}*\n\n` : "";

  const answer =
    `### ✅ Masuk keranjang${callName ? `, ${callName}` : ""}!\n\n` +
    note +
    `**${label}** — ${game.name}\n💵 **${idr(price)}** · bayar via WhatsApp\n\n` +
    `### Langkah transaksi\n` +
    `1. Buka **Keranjang** (pojok kanan atas)\n` +
    `2. Isi data akun — perlu: ${reqText}\n` +
    `3. Tekan **Checkout via WhatsApp**\n` +
    `4. Bayar sesuai instruksi admin → pesanan langsung diproses\n` +
    `5. Catat **ID Order** untuk melacak status pesanan\n\n` +
    `> Maksimal **5 item** per checkout. ${reqHint}`;

  const action = {
    type: "add_to_cart",
    productId: product.id,
    gameId: game.id,
    label,
    gameName: game.name,
    price,
    requiredFields: (orderFields ?? []).map((f) => ({
      key: f.key,
      label: f.label ?? f.key,
      required: f.required !== false,
    })),
  };
  return { answer, action };
}

/**
 * v1.21.0 — Pertanyaan PILIHAN bernomor saat produk belum bisa dipastikan.
 * User tinggal balas "1" / "2" / "yang kedua" — lapisan pick (nexa-pick.js)
 * langsung mengeksekusi add_to_cart. Mengembalikan {answer, options} —
 * options dipersist oleh engine agar balasan berikutnya terresolusi.
 * @param {{gameName?:string|null, reason?:"budget"|"ambiguous"|"list", options:Array<{label:string,price:number}>, userName?:string|null}} p
 */
function agentAskChoice(p) {
  const { gameName, reason, options, userName } = p;
  const list = (options || []).slice(0, 6);
  const callName = String(userName ?? "").trim().split(" ")[0];
  const lines = list.map((o, i) => `${i + 1}. **${o.label}** — ${idr(o.price)}`);
  const head = gameName
    ? `### 🛒 ${gameName} — pilih nominalnya${callName ? `, ${callName}` : ""}!`
    : `### 🛒 Pilih salah satunya${callName ? `, ${callName}` : ""}!`;
  const why =
    reason === "budget"
      ? "Yang muat di budget kamu ada beberapa nih:"
      : reason === "ambiguous"
        ? "Maksudmu yang mana?"
        : "Ini pilihannya:";
  return {
    answer:
      `${head}\n\n${why}\n\n${lines.join("\n")}\n\n` +
      `Balas **angkanya** saja (contoh: \`1\`) — langsung kumasukkan ke keranjang! 🤖`,
    options: list,
  };
}

/**
 * Jawaban + aksi ketika data akun berhasil diekstrak & diisikan.
 * @param {{product:{id:string},game:{id:string,name:string,orderFieldSchema?:Array<object>},label:string,price:number,extracted:Object,hits:Array<object>,customerName?:string}} p
 */
function agentFillData(p) {
  const { game, label, price, extracted, customerName } = p;
  const orderFields = game.orderFieldSchema ?? [];
  const filledEntries = Object.entries(extracted.fields ?? {});
  const missing = orderFields.filter((f) => f.required !== false && !(extracted.fields ?? {})[f.key]);

  const lines = filledEntries
    .map(([key, value]) => {
      const f = orderFields.find((x) => x.key === key);
      return `✅ ${f?.label ?? key}: \`${value}\``;
    });
  if (customerName) lines.push(`🙋 Nama: **${customerName}**`);
  for (const f of missing) {
    lines.push(`⏳ ${f.label ?? f.key}: belum ada`);
  }

  const head =
    missing.length > 0
      ? `### 📥 Data tersimpan ke keranjang!`
      : `### 📥 Data lengkap — tersimpan!`;
  const foot =
    missing.length > 0
      ? `Masih perlu: ${missing.map((f) => `**${f.label ?? f.key}**`).join(", ")} — kirim saja di sini, contoh \`${missing[0].key} 1234\`.`
      : `Semua siap! Buka **Keranjang** → **Checkout via WhatsApp** 🚀`;

  const answer =
    `${head}\n\n**${label}** — ${game.name}\n💵 **${idr(price)}**\n\n` +
    `### Data akun\n${lines.join("\n")}\n\n${foot}`;

  const action = {
    type: "fill_data",
    productId: p.product.id,
    gameId: game.id,
    fields: extracted.fields ?? {},
    ...(customerName ? { customerName } : {}),
  };
  return { answer, action };
}

// ---------------------------------------------------------------------------
// 4. Markdown → teks polos (jalur Telegram)
// ---------------------------------------------------------------------------

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "• ")
    .trim();
}

/**
 * Markdown ringan bot → HTML aman untuk Telegram (parse_mode HTML).
 * Karakter HTML di-escape lebih dulu, lalu **tebal**, `kode`, ### heading,
 * > kutipan, dan daftar - dikonversi ke padanan HTML-nya.
 */
function markdownToHtml(text) {
  const escaped = String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^&gt;\s?(.*)$/gm, "<i>$1</i>")
    .replace(/^-\s+(.*)$/gm, "• $1")
    .trim();
}

module.exports = {
  AGENT_TTL_MS,
  detectPurchaseIntent,
  extractAccountData,
  agentAddToCart,
  agentAskChoice,
  agentFillData,
  stripMarkdown,
  markdownToHtml,
};
