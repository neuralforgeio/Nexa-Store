#!/usr/bin/env node
/* eslint-disable */
/**
 * train.js — Nexa Bot trainer (v1.14.0).
 *
 * Proyek chatbot AI murni berbasis @nlpjs/basic: seluruh training berjalan
 * lokal, hasilnya diekspor sebagai "otak" AI lokal.
 *
 * Cara pakai (lokal, sebelum push ke Vercel):
 *   1. node train.js          (atau: bun run train:bot)
 *   2. Commit hasil training  (model.nlp + nexa-brain.js)
 *   3. git push               → Vercel ikut deploy fungsi api/chat.js
 *
 * Membaca  : data/catalog/games.json + data/catalog/products.json (data kita)
 *            + persona/intents bawaan di file ini (identitas, FAQ, rekomendasi).
 * Menulis  : model.nlp      — otak AI terlatih (canonical, bisa di-load ulang)
 *            nexa-brain.js  — bundel runtime (model + leksikon) untuk
 *                             api/chat.js (Serverless Vercel) dan engine Next.
 *
 * Tanpa API eksternal (bukan OpenAI/Gemini) — murni NLP lokal.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Nlp } = require("@nlpjs/basic");

const ROOT = __dirname;
const SITE_URL = process.env.NEXA_SITE_URL || "https://nexastoregame.vercel.app";

// ---------------------------------------------------------------------------
// Persona — "system prompt" Nexa Bot (dipakai melatih jawaban + fallback)
// ---------------------------------------------------------------------------

const PERSONA = {
  name: "Nexa Bot",
  store: "NEXA STORE",
  creator: "Dearly Febriano Irwansyah",
  creatorRole: "Software Engineer asal Surabaya, Indonesia",
  github: "github.com/neuralforgeio",
  engine: "NLP.js — model bahasa yang dilatih lokal dari data katalog NEXA STORE",
  fallback:
    "Hmm, aku belum paham yang kamu tanya 😅 Aku Nexa Bot — asisten khusus NEXA STORE. Coba tanya: nama game (mis. \"free fire\"), \"cara top up\", \"lacak pesanan\", atau \"rekomendasi termurah\".",
  offContext:
    "Maaf, di luar wewenangku 😅 Aku Nexa Bot — asisten khusus NEXA STORE (top up game). Aku nggak bisa bantu soal itu. Tanya aku soal harga game, cara top up, atau lacak pesanan ya!",
};

// ---------------------------------------------------------------------------
// Metadata game: alias + satuan untuk generator utterance (bahasa Indonesia)
// ---------------------------------------------------------------------------

const GAME_META = {
  "free-fire": { aliases: ["free fire", "freefire", "ff", "free fire gratisan"], units: ["diamond", "dm", "diamonds"] },
  "ff-max": { aliases: ["ff max", "ffmax", "free fire max", "freefire max"], units: ["diamond", "dm", "diamonds"] },
  "valorant": { aliases: ["valorant", "valo", "valorant point"], units: ["point", "points", "vp"] },
  "genshin-impact": { aliases: ["genshin impact", "genshin", "gensin impact"], units: ["genesis crystal", "crystal", "crystals"] },
  "honor-of-kings": { aliases: ["honor of kings", "honor kings", "hok"], units: ["token", "tokens"] },
  "honkai-star-rail": { aliases: ["honkai star rail", "honkai", "hsr", "star rail"], units: ["oneiric shard", "shard", "shards"] },
  "pubg": { aliases: ["pubg", "pubg mobile", "pubgm"], units: ["uc"] },
  "mobile-legends": { aliases: ["mobile legends", "mobile legend", "ml", "mlbb"], units: ["diamond", "dm", "diamonds"] },
  "roblox": { aliases: ["roblox", "robux"], units: ["robux", "rbx"] },
  "call-of-duty": { aliases: ["call of duty", "cod", "codm", "call of duty mobile"], units: ["cp"] },
  "zenless-zone-zero": { aliases: ["zenless zone zero", "zenless", "zzz", "zenless zone"], units: ["monochrome film", "film", "mf"] },
  "point-blank": { aliases: ["point blank", "pointblank", "pb"], units: ["pb cash", "cash", "pbcash"] },
  "delta-force": { aliases: ["delta force", "deltaforce", "delta force garena", "df"], units: ["delta coin", "coin", "coins"] },
  "brawl-stars": { aliases: ["brawl stars", "brawl", "brawlstar"], units: ["gem", "gems"] },
  "arena-breakout": { aliases: ["arena breakout", "arena breakout indonesia", "arena"], units: ["bond", "bonds"] },
  "stumble-guys": { aliases: ["stumble guys", "stumble", "stumbleguys"], units: ["gem", "gems"] },
  "modern-warships": { aliases: ["modern warships", "modern warship", "warships", "mw"], units: ["gold", "dollar", "dollars", "artcoin", "artcoins"] },
  "blood-strike": { aliases: ["blood strike", "bloodstrike"], units: ["gold"] },
  "sausage-man": { aliases: ["sausage man", "sasage man", "sausage", "sasage"], units: ["candy", "candies"] },
  "fc-mobile": { aliases: ["fc mobile", "fcmobile", "fc", "ea fc"], units: ["fc point", "point", "points"] },
  "azur-lane": { aliases: ["azur lane", "azurlane", "azur"], units: ["gem", "gems"] },
  "blockman-go": { aliases: ["blockman go", "blockmango", "blockman", "block man go"], units: ["gcube", "gcubes", "cube"] },
};

// Game yang paling sering dicari (untuk jawaban rekomendasi populer).
const POPULAR = ["free-fire", "mobile-legends", "pubg", "roblox", "valorant", "genshin-impact"];

// ---------------------------------------------------------------------------
// Intents bawaan (identitas, sopan santun, toko, penjaga konteks)
// ---------------------------------------------------------------------------

function builtinIntents() {
  return [
    {
      intent: "greet",
      utterances: ["halo", "hai", "hi", "hallo", "hello", "woy", "hei", "oy", "pagi", "siang", "sore", "malam", "selamat pagi", "selamat siang", "selamat sore", "selamat malam", "assalamualaikum", "permisi", "p", "halo bot", "hai bot", "halo nexa", "hai nexa", "halo admin", "hai admin", "hai kak", "halo kak", "selamat pagi admin", "tes", "tes tes", "test", "p chat", "bro"],
      answer: `Halo! 👋 Aku ${PERSONA.name}, asisten ${PERSONA.store} ⚡ Ketik nama game buat lihat daftar harga (mis. "free fire"), atau tanya "cara top up", "lacak pesanan", dan "rekomendasi termurah".`,
    },
    {
      intent: "bot.identity",
      utterances: ["siapa kamu", "kamu siapa", "siapa namamu", "nama kamu siapa", "siapa nama kamu", "kamu bot apa", "kamu apa", "kenalan dulu dong", "perkenalkan dirimu", "kenalan yuk", "who are you", "kamu manusia atau bot", "kamu robot ya", "ini bot ya", "kamu ai ya"],
      answer: `Aku ${PERSONA.name} ⚡ — asisten AI ${PERSONA.store}, toko top up game favoritmu. Otakku dilatih dari data katalog store ini dan diproses sepenuhnya secara lokal. Mau lihat harga? Ketik saja nama game-nya!`,
    },
    {
      intent: "bot.creator",
      utterances: ["siapa yang membuat kamu", "siapa pembuatmu", "siapa developer kamu", "kamu dibangun oleh siapa", "siapa pembuat nexa bot", "pencipta kamu siapa", "kamu buatan siapa", "siapa pemilik nexa store", "siapa pemilik toko ini", "siapa ceo nexa store", "karya siapa ini", "siapa yang bikin kamu"],
      answer: `Aku dibangun oleh ${PERSONA.creator} 👨‍💻 — seorang ${PERSONA.creatorRole}. Kamu bisa lihat karya-karyanya di GitHub: ${PERSONA.github}. Untuk urusan top up game, aku yang siap bantu!`,
    },
    {
      intent: "bot.stack",
      utterances: ["kamu dibuat pakai apa", "kamu pakai teknologi apa", "kamu pakai ai apa", "model apa yang kamu pakai", "kamu chatbot apa", "kamu pakai openai", "kamu pakai gpt", "kamu pakai chatgpt", "kamu pakai gemini", "otak kamu pakai apa", "kamu belajar dari mana", "dilatih pakai apa"],
      answer: `Otakku ${PERSONA.engine} — tanpa API eksternal (bukan ChatGPT/Gemini), semua diproses lokal. Cepat, privat, dan fokus 100% ke ${PERSONA.store} ⚡`,
    },
    {
      intent: "bot.capabilities",
      utterances: ["apa yang bisa kamu lakukan", "kamu bisa apa", "bisa bantu apa", "fitur kamu apa aja", "apa fungsi kamu", "bantuan", "menu", "help", "apa saja yang bisa ditanyakan", "list pertanyaan", "kamu ngerti apa aja", "bantuin aku dong", "menu apa aja"],
      answer: `Aku bisa bantu: 🎮 daftar harga 22 game (ketik nama game, mis. "ml" atau "ff") • 💸 rekomendasi top up termurah • 📋 cara top up & pembayaran • 📦 lacak pesanan • 🐞 lapor bug. Cukup ketik pertanyaanmu seputar ${PERSONA.store}!`,
    },
    {
      intent: "bot.thanks",
      utterances: ["makasih", "terima kasih", "thanks", "thank you", "mksh", "makasih banyak", "suwun", "tengkyu", "makasih ya", "thanksss", "terimakasih", "oke makasih", "siap makasih"],
      answer: "Sama-sama! 🙌 Senang bisa bantu. Kalau butuh apa-apa seputar top up, aku di sini ya ⚡",
    },
    {
      intent: "bot.bye",
      utterances: ["dadah", "bye", "sampai jumpa", "udahan dulu", "goodbye", "selamat tinggal", "dah", "udah dulu ya", "bye bye", "assalamualaikum warahmatullahi wabarakatuh"],
      answer: "Sampai jumpa! 🎮 Semoga rankmu naik terus. Balik kapan pun kamu butuh top up ya ⚡",
    },
    {
      intent: "smalltalk.howareyou",
      utterances: ["apa kabar", "kamu baik", "kamu baik baik aja", "lagi apa", "kamu lagi ngapain", "gimana kabarmu", "kabarmu gimana"],
      answer: "Kabarku selalu ready 24 jam ⚡ Ibarat server, uptime-ku 99,9% 😄 Ada yang bisa kubantu seputar top up game?",
    },
    {
      intent: "off.coding",
      utterances: ["bantu bikin website", "buatkan kode", "bantu coding", "cara bikin aplikasi", "tolong debug", "error di kode", "javascript apa itu", "python gimana", "tutorial react", "html css", "bikin bot discord", "cara jadi programmer", "c++ apa", "golang susah gak", "sql query", "cara bikin ai", "buatkan program", "koding dong", "bantu bikin tugas coding", "cara bikin website sendiri"],
      answer: PERSONA.offContext,
    },
    {
      intent: "off.math",
      utterances: ["berapa 1 tambah 1", "hitung 2 kali 2", "soal matematika", "bantu hitung", "kalkulasi dong", "berapa hasil 10 bagi 2", "hitungin dong", "berapa 5 x 5"],
      answer: PERSONA.offContext,
    },
    {
      intent: "off.other",
      utterances: ["siapa presiden indonesia", "cuaca hari ini gimana", "kabar berita terbaru", "resep masakan enak", "lagu apa yang bagus", "film rekomendasi dong", "skor bola semalam", "gosip artis terbaru", "nama aku siapa", "kamu pacar aku ya", "cerita lucu dong", "ceritain lelucon", "pantun dong", "kamu bisa nyanyi", "umur kamu berapa", "kamu tinggal dimana", "cuaca besok", "ramalan zodiak", "nomor togel hari ini", "kode otp saya", "download film dimana", "cek resi jne", "harga bitcoin"],
      answer: PERSONA.offContext,
    },
    {
      intent: "store.about",
      utterances: ["nexa store apa", "toko ini apa", "tentang nexa store", "nexa store itu apa", "profil toko", "ini toko apa", "nexa store apaan sih", "kenalan sama nexa store"],
      answer: `${PERSONA.store} adalah toko top up game — isi diamond, UC, VP, dan item game favoritmu dengan harga bersahabat. Order langsung lewat situs ini, checkout via WhatsApp, pesanan bisa dilacak real-time lewat ID Order. Aku ${PERSONA.name}, siap bantu 24 jam ⚡`,
    },
    {
      intent: "store.list",
      utterances: ["daftar game", "list game", "game apa aja", "ada game apa aja", "semua game", "katalog game", "game yang ada", "bisa top up game apa", "ada apa aja di sini", "list game apa aja", "mau lihat game", "liat game dulu"],
      answer: `Ada 22 game di ${PERSONA.store}! 🔥 Populer: Free Fire, FF MAX, Mobile Legends, PUBG Mobile, Roblox, Valorant, Genshin Impact. Ada juga: Honkai Star Rail, Honor of Kings, COD Mobile, Zenless Zone Zero, Point Blank, Delta Force, Brawl Stars, Arena Breakout, Stumble Guys, Modern Warships, Blood Strike, Sausage Man, FC Mobile, Azur Lane, Blockman Go. Ketik nama game buat lihat harga!`,
    },
    {
      intent: "howto.order",
      utterances: ["cara top up", "gimana cara top up", "cara beli", "cara pesan", "cara order", "mau beli gimana caranya", "cara pembelian", "langkah langkah top up", "cara isi diamond", "gimana belinya", "cara beli diamond", "cara beli uc", "mau order dong", "cara transaksi", "gimana cara pesannya", "cara order gimana"],
      answer: `Cara top up di ${PERSONA.store} gampang banget: 1️⃣ Buka menu Game → pilih game-mu 2️⃣ Pilih nominal & isi data akun (User ID/Player ID) 3️⃣ Checkout — pesanan otomatis terkirim ke WhatsApp admin 4️⃣ Selesaikan pembayaran, lalu diamond masuk! 🎮 ID Order kamu muncul di chat WhatsApp untuk lacak status.`,
    },
    {
      intent: "howto.pay",
      utterances: ["pembayaran gimana", "metode pembayaran", "bayar pakai apa", "bisa bayar dana", "bisa qris", "bayar lewat apa", "bisa ovo", "bisa gopay", "bisa shopeepay", "transfer bank bisa", "bayarnya gimana", "cara bayar", "metode bayar apa aja", "qris bisa gak", "dana bisa gak"],
      answer: "Pembayaran diatur langsung lewat chat WhatsApp saat kamu order 💬 Nominal + rekening/QR akan dikirim admin setelah pesanan masuk (QRIS dan e-wallet umum tersedia).checkout cepat, proses langsung!",
    },
    {
      intent: "howto.track",
      utterances: ["lacak pesanan", "cara lacak", "cek pesanan", "cek status order", "pesanan aku dimana", "lacak order", "cek order", "status pesanan", "orderku sudah masuk belum", "cek status pesanan", "pesanku udah diproses belum", "cara cek pesanan", "order aku mana", "diamond ku udah masuk belum", "pesanan belum masuk"],
      answer: "Buka menu Lacak Pesanan 📦 tempel ID Order kamu (formatnya NEXA-TANGGAL-KODE, contoh NEXA-260914-A7KP — otomatis dikirim ke chat WhatsApp saat order). Status, catatan admin, dan riwayat lengkap langsung tercetak dalam satu resi.",
    },
    {
      intent: "howto.hours",
      utterances: ["jam operasional", "buka jam berapa", "admin online kapan", "proses berapa lama", "tutup jam berapa", "open jam berapa", "24 jam gak", "buka terus gak", "biasanya diproses berapa lama", "lama gak prosesnya"],
      answer: `${PERSONA.store} buka 24 jam ⏰ Order kapan pun — otomatis masuk ke admin lewat WhatsApp. Mayoritas pesanan diproses cepat setelah pembayaran dikonfirmasi; kalau ada antrean, statusnya kelihatan di halaman Lacak Pesanan.`,
    },
    {
      intent: "howto.contact",
      utterances: ["hubungi admin", "kontak admin", "nomor whatsapp", "wa admin", "chat admin", "cara kontak admin", "butuh bantuan manusia", "ngobrol sama admin", "admin bisa dihubungi dimana", "live chat admin", "nomor wa nya berapa", "mau chat admin", "bicara sama orang saja", "adminnya ada gak"],
      answer: "Kamu bisa chat admin lewat WhatsApp — link-nya ada di situs (menu Bantuan) dan otomatis terbuka saat checkout 💬 Kalau butuh jawab cepat soal harga/caranya, tanya aku dulu — aku online 24 jam ⚡",
    },
    {
      intent: "howto.report",
      utterances: ["lapor bug", "cara lapor bug", "kirim laporan", "ada fitur yang error", "saran fitur", "laporkan masalah", "website error", "ada yang rusak", "bug di situs", "mau saran fitur"],
      answer: "Ada menu Laporan di situs 🐞 — kirim laporan bug, saran fitur, bahkan lampiran screenshot/video. Laporanmu langsung sampai ke pengembang dan ditindaklanjuti.",
    },
    {
      intent: "howto.promo",
      utterances: ["ada promo", "promo apa aja", "diskon gak", "lagi diskon gak", "promo hari ini", "code promo", "ada potongan harga", "promo top up", "diskon diamond"],
      answer: `Info promo terbaru selalu tampil di halaman depan ${PERSONA.store} 🏷️ Kalau sedang ada event diskon, potongan otomatis terpasang di harga nominal. Pantau terus — promo datang tanpa pengumuman!`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Util format
// ---------------------------------------------------------------------------

const idr = (n) => `Rp${n.toLocaleString("id-ID")}`;

function productLabel(product, game) {
  // Label alami: gabungan kata dari ekor id + nama + denominasi, tanpa duplikat.
  const tail = product.id.slice(game.id.length + 1);
  const words = [];
  const push = (s) =>
    s
      .toLowerCase()
      .replace(/[_/]+/g, " ")
      .split(/[^a-z0-9+]+/)
      .filter(Boolean)
      .forEach((w) => {
        if (!words.includes(w)) words.push(w);
      });
  push(tail);
  push(product.name || "");
  push(product.denomination || "");
  return words.join(" ");
}

function listAnswer(game, products, trainedAt) {
  const items = products
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => ({ label: productLabel(p, game), price: p.priceIdr }));
  const head = `⚡ ${game.name} — harga per ${trainedAt}:\n`;
  const tail = `\nSemua nominal + order ada di halaman game-nya 🎮`;
  const budget = 760 - head.length - tail.length;
  const lines = [];
  let used = 0;
  for (const it of items) {
    const piece = `${it.label} ${idr(it.price)}`;
    const add = (lines.length ? " • " : "") + piece;
    if (used + add.length > budget) {
      lines.push("…");
      break;
    }
    lines.push(piece);
    used += add.length;
  }
  return head + lines.join(" • ") + tail;
}

function productAnswer(product, game) {
  const label = productLabel(product, game);
  return `${label.replace(/\b\w/g, (c) => c.toUpperCase())} ${game.name}: ${idr(product.priceIdr)} ⚡ Pesan di halaman ${game.name} — isi data akun, checkout via WhatsApp, langsung diproses.`;
}

// ---------------------------------------------------------------------------
// Korpus + leksikon dari data katalog
// ---------------------------------------------------------------------------

function buildCorpus(games, products, trainedAt) {
  const intents = builtinIntents();
  const byGame = new Map();
  for (const p of products) {
    if (!byGame.has(p.gameId)) byGame.set(p.gameId, []);
    byGame.get(p.gameId).push(p);
  }

  const lexGames = [];
  const lexProducts = [];
  for (const game of games) {
    const meta = GAME_META[game.id] ?? { aliases: [game.name.toLowerCase()], units: [] };
    const gProducts = (byGame.get(game.id) ?? []).filter((p) => p.enabled !== false);
    const alias = [game.name.toLowerCase(), ...meta.aliases];

    // --- intent per game + amunisi niat "cara" per game ---
    const utterances = [];
    for (const a of alias) {
      utterances.push(a, `harga ${a}`, `top up ${a}`, `list ${a}`, `${a} berapa`, `nominal ${a}`, `mau beli ${a}`, `${a} ada apa aja`, `daftar harga ${a}`);
    }
    intents.push({
      intent: `game.${game.id}`,
      utterances: [...new Set(utterances)],
      answer: listAnswer(game, gProducts, trainedAt),
    });
    const howto = intents.find((i) => i.intent === "howto.order");
    if (howto) howto.utterances.push(`cara top up ${alias[0]}`, `cara beli ${alias[0]}`, `gimana top up ${alias[0]}`, `cara isi diamond ${alias[0]}`, `cara beli diamond ${alias[0]}`);

    // --- intent per produk (harga presisi) ---
    for (const p of gProducts) {
      const label = productLabel(p, game);
      const denom = String(p.denomination ?? "").toLowerCase();
      const bonusNum = p.bonus ? String(p.bonus).replace(/\D/g, "") : "";
      const denomFull = bonusNum ? `${denom}+${bonusNum}` : denom;
      const denomSpace = denomFull.replace(/\+/g, " ");
      const us = new Set();
      for (const a of alias.slice(0, 3)) {
        us.add(`${a} ${label}`);
        us.add(`harga ${label} ${a}`);
        us.add(`${a} ${label} berapa`);
        if (denom) us.add(`${a} ${denom}`);
        if (denomFull !== denom) {
          us.add(`${a} ${denomFull}`);
          us.add(`${denomFull} ${a}`);
          us.add(`${a} ${denomSpace}`);
          us.add(`${denomSpace} ${a}`);
        }
        // Pola sebaliknya + satuan (tunggal & jamak) agar FF vs FF MAX &
        // denominasi bonus (+) terklasifikasi presisi.
        for (const unit of meta.units) {
          us.add(`${a} ${denom} ${unit}`);
          us.add(`${denom} ${unit} ${a}`);
        }
        us.add(`${denom} ${a}`);
      }
      intents.push({
        intent: `price.${p.id}`,
        utterances: [...us],
        answer: productAnswer(p, game),
      });
    }

    lexGames.push({
      id: game.id,
      slug: game.slug,
      name: game.name,
      aliases: [...new Set([game.name.toLowerCase(), ...meta.aliases])],
      units: meta.units,
      productCount: gProducts.length,
    });

    for (const p of gProducts) {
      const bonusNum = p.bonus ? String(p.bonus).replace(/\D/g, "") : "";
      const denom = String(p.denomination ?? "").toLowerCase();
      lexProducts.push({
        id: p.id,
        gameId: game.id,
        denom,
        denomFull: bonusNum ? `${denom}+${bonusNum}` : denom,
        bonus: Boolean(bonusNum),
        tokens: productLabel(p, game).split(" ").filter((w) => w.length > 1),
      });
    }
  }

  // --- rekomendasi (fokus utama): dihitung dari data ---
  const cheapest = games
    .map((g) => {
      const items = (byGame.get(g.id) ?? []).filter((p) => p.enabled !== false);
      const min = items.reduce((m, p) => (p.priceIdr < m.priceIdr ? p : m), items[0]);
      return min ? { game: g, product: min } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.product.priceIdr - b.product.priceIdr);

  intents.push({
    intent: "rekomendasi.cheap",
    utterances: ["rekomendasi termurah", "top up paling murah", "yang paling murah", "harga termurah", "top up murah", "budget tipis", "duit tipis", "murah banget apa", "paling hemat", "rekomendasi murah", "yang murah apa", "top up dibawah 20 ribu", "budget 10 ribu", "budget 20 ribu", "hemat duit", "yang paling murah apa", "top up kecil", "top up dibawah 15 ribu", "dibawah 20rb", "murah"],
    answer:
      "💸 Top up termurah di NEXA STORE:\n" +
      cheapest.slice(0, 8).map((c) => `• ${c.game.name} — ${productLabel(c.product, c.game)} ${idr(c.product.priceIdr)}`).join("\n") +
      "\nKetik nama game-nya buat lihat semua nominal!",
  });

  intents.push({
    intent: "rekomendasi.popular",
    utterances: ["game populer", "game terlaris", "rekomendasi game", "game yang lagi rame", "yang sering dibeli", "game recommended", "top game", "game terbaik", "game favorit", "rekomendasi top up", "mau top up apa ya", "bingung mau top up apa", "saran game dong", "game apa yang bagus"],
    answer:
      "🔥 Paling laris di NEXA STORE:\n" +
      POPULAR.map((id) => {
        const g = games.find((x) => x.id === id);
        return g ? `• ${g.name} — ketik "${(GAME_META[id]?.aliases ?? [g.name.toLowerCase()])[0]}" buat lihat harga` : null;
      })
        .filter(Boolean)
        .join("\n") +
      "\nSemua ada 22 game — ketik \"daftar game\" buat lihat semuanya!",
  });

  const bonusProducts = products.filter((p) => (p.denomination ?? "").includes("+") && p.enabled !== false).slice(0, 10);
  intents.push({
    intent: "rekomendasi.value",
    utterances: ["bonus paling besar", "paling worth it", "best value", "yang paling worth", "hemat bonus", "bonus terbanyak", "yang ada bonusnya", "paling untung", "worth it yang mana"],
    answer:
      "💎 Paling worth it (ada bonus ekstra):\n" +
      bonusProducts
        .map((p) => {
          const g = games.find((x) => x.id === p.gameId);
          return g ? `• ${g.name} ${p.denomination} — ${idr(p.priceIdr)}` : null;
        })
        .filter(Boolean)
        .join("\n") +
      "\nBonus nominal besar biasanya lebih hemat per unit — worth it buat push rank! 🎮",
  });

  intents.push({
    intent: "rekomendasi.gift",
    utterances: ["hadiah buat teman", "kado buat pacar", "hadiah buat gamer", "gift card", "kado gaming", "hadiah ultah gamer", "buat hadiah apa ya"],
    answer:
      "🎁 Buat hadiah gamer, aman pilih: Roblox Robux (gift card, cocok semua umur), Free Fire diamond (paling universal), atau Mobile Legends diamond buat yang main bareng. Ketik game-nya buat lihat pilihan nominalnya!",
  });

  // --- domain tokens (gerbang konteks engine) ---
  const domainTokens = new Set();
  const addTokens = (s) => s.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 1).forEach((w) => domainTokens.add(w));
  for (const g of lexGames) {
    g.aliases.forEach(addTokens);
    g.units.forEach(addTokens);
    addTokens(g.name);
  }
  ["harga", "topup", "top", "up", "beli", "belii", "pesan", "order", "lacak", "cek", "check", "bayar", "pembayaran", "payment", "rekomendasi", "rekomen", "murah", "termurah", "promo", "diskon", "bonus", "kontak", "admin", "whatsapp", "wa", "jam", "buka", "tutup", "toko", "store", "nexa", "bot", "siapa", "kamu", "pembuat", "dibuat", "buat", "developer", "pemilik", "daftar", "list", "nominal", "membership", "member", "pass", "help", "bantuan", "menu", "bisa", "apa", "kabar", "kabarbaik", "kabar baik", "populer", "terlaris", "worth", "hadiah", "kado", "gift", "gems", "kristal", "koin", "coin"].forEach((w) => domainTokens.add(w));
  const greetings = ["halo", "hallo", "hai", "hi", "hei", "woy", "oy", "pagi", "siang", "sore", "malam", "assalamualaikum", "permisi", "makasih", "terima", "kasih", "thanks", "thank", "mksh", "suwun", "tengkyu", "bye", "dadah", "dah", "jumpa", "udahan", "goodbye", "tinggal", "tes", "test", "p", "bro", "kak"];

  return { intents, lexicon: { domainTokens: [...domainTokens], greetings, games: lexGames, products: lexProducts } };
}

// ---------------------------------------------------------------------------
// Training + ekspor
// ---------------------------------------------------------------------------

async function main() {
  const games = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog/games.json"), "utf8")).games;
  const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog/products.json"), "utf8")).products;
  const enabledGames = games.filter((g) => g.enabled !== false);
  const enabledIds = new Set(enabledGames.map((g) => g.id));
  const enabledProducts = products.filter((p) => enabledIds.has(p.gameId) && p.enabled !== false);

  const now = new Date();
  const trainedAt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(now);

  console.log(`• Katalog : ${enabledGames.length} game, ${enabledProducts.length} produk`);
  const { intents, lexicon } = buildCorpus(enabledGames, enabledProducts, trainedAt);

  const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false, modelFileName: "model.nlp" });
  let docs = 0;
  for (const it of intents) {
    for (const u of it.utterances) {
      nlp.addDocument("en", u, it.intent);
      docs++;
    }
    nlp.addAnswer("en", it.intent, it.answer);
  }
  console.log(`• Intents : ${intents.length} (${docs} utterance)`);

  const t0 = Date.now();
  await nlp.train();
  console.log(`• Train   : ${Date.now() - t0} ms`);

  const modelJson = nlp.export(true);
  fs.writeFileSync(path.join(ROOT, "model.nlp"), modelJson, "utf8");
  console.log(`• model.nlp ditulis (${(modelJson.length / 1024 / 1024).toFixed(2)} MB)`);

  const brain = {
    version: "1.14.0",
    trainedAt: now.toISOString(),
    trainedAtLabel: trainedAt,
    persona: PERSONA,
    lexicon,
    model: JSON.parse(modelJson),
  };
  const brainJs = `// DIHASILKAN OLEH train.js — JANGAN edit manual. Jalankan: node train.js
// Otak Nexa Bot: model NLP terlatih (@nlpjs/basic) + leksikon + persona.
module.exports = ${JSON.stringify(brain)};\n`;
  fs.writeFileSync(path.join(ROOT, "nexa-brain.js"), brainJs, "utf8");
  console.log(`• nexa-brain.js ditulis (${(brainJs.length / 1024 / 1024).toFixed(2)} MB)`);

  // Sanity battery — pipeline lengkap (resolver + NLP) seperti engine produksi.
  const { resolveCatalogQuery, withinDomain } = require("./nexa-resolve.js");
  const answerOf = async (text) => {
    if (!withinDomain(text, brain.lexicon)) return "off.Context";
    const resolved = resolveCatalogQuery(text, brain.lexicon);
    if (resolved?.type === "product") return `price.${resolved.productId}`;
    if (resolved?.type === "game") return `game.${resolved.gameId}`;
    const r = await nlp.process("en", text);
    return r.intent;
  };
  const checks = [
    ["harga free fire", "game.free-fire"],
    ["ff 350 diamond", "price.free-fire-350"],
    ["ff max 200", "price.ff-max-200"],
    ["100 dm ff", "price.free-fire-100"],
    ["200 dm ff max", "price.ff-max-200"],
    ["ml 568", "price.mobile-legends-568"],
    ["mobile legends weekly", "price.mobile-legends-weekly"],
    ["harga valorant 475", "price.valorant-475"],
    ["genshin 300+30", "price.genshin-impact-300"],
    ["harga 350 ff", "price.free-fire-350"],
    ["roblox 800 robux", "price.roblox-800"],
    ["arena breakout battle pass", "prefix:price.arena-breakout"],
    ["ff member", "price.free-fire-member"],
    ["brawl pass plus", "prefix:price.brawl-stars"],
    ["cara top up free fire", "howto.order"],
    ["top up murah banget", "rekomendasi.cheap"],
    ["game populer apa", "rekomendasi.popular"],
    ["cara top up gimana", "howto.order"],
    ["lacak pesananku", "howto.track"],
    ["siapa pembuatmu", "bot.creator"],
    ["siapa kamu", "bot.identity"],
    ["cuaca hari ini gimana", "off.Context"],
    ["bantu bikin website", "off.Context"],
    ["halo", "greet"],
    ["harga modern warships", "game.modern-warships"],
    ["pusyg gimana", "off.Context"],
  ];
  let ok = 0;
  for (const [text, expect] of checks) {
    const got = await answerOf(text);
    let pass;
    if (expect === null) pass = got === "None" || got.startsWith("off.");
    else if (typeof expect === "string" && expect.startsWith("prefix:")) pass = got.startsWith(expect.slice(7));
    else pass = got === expect;
    if (pass) ok++;
    else console.log(`  ✗ "${text}" → ${got} — diharapkan ${expect}`);
  }
  console.log(`• Sanity  : ${ok}/${checks.length} lolos (resolver + NLP)`);
  if (ok < checks.length - 1) {
    console.error("Sanity terlalu rendah — periksa corpus sebelum push.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
