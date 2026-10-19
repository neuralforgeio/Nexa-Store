import { Nlp } from "@nlpjs/basic";
import brain from "../../../nexa-brain.js";
import { resolveCatalogQuery, resolveProductMention, withinDomain } from "../../../nexa-resolve.js";
import { containsLeakAttempt, sanitizeAnswer, GUARD_ANSWER } from "../../../nexa-guard.js";
import { detectMath, solveMath } from "../../../nexa-math.js";
import { getRepository } from "@/lib/catalog/repo";
import type { Game, Product } from "@/lib/catalog/types";

/**
 * Nexa Bot engine (v1.15.0) — otak AI lokal untuk obrolan storefront.
 *
 * Pipeline: penjaga keamanan (anti-bocor) → kalkulator (nexa-math, harga
 * LIVE) → resolver entitas katalog (NER ala Indonesia: alias game + nominal)
 * → klasifikasi niat NLP (@nlpjs/basic, model dilatih train.js) → gerbang
 * konteks. Jawaban harga selalu dirender dari katalog LIVE.
 *
 * AUTO-TRAINING v1.15.0 — pengetahuan bot tidak perlu dilatih ulang saat
 * data berubah: leksikon runtime menggabungkan otak terlatih dengan katalog
 * LIVE (game baru otomatis dikenali dari namanya, harga berubah → jawaban
 * berubah, produk dihapus → tak disebut lagi). Model statis hanya memahami
 * BAHASA (niat); FAKTA selalu dibaca segar dari data.
 *
 * 100% lokal — tanpa API eksternal.
 */

export type BotReply = {
  intent: string;
  score: number;
  answer: string;
};

const MAX_ANSWER = 780; // chatFileSchema: text max 800 — beri ruang.

let nlpPromise: Promise<Nlp> | null = null;

function getNlp(): Promise<Nlp> {
  if (!nlpPromise) {
    nlpPromise = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(JSON.stringify(brain.model));
      return nlp;
    });
  }
  return nlpPromise;
}

// ---------------------------------------------------------------------------
// Katalog live + leksikon runtime (auto-training)
// ---------------------------------------------------------------------------

const idr = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

function labelOf(p: Product, game: Game): string {
  const tail = p.id.slice(game.id.length + 1);
  const words: string[] = [];
  const push = (s: string) =>
    s
      .toLowerCase()
      .replace(/[_/]+/g, " ")
      .split(/[^a-z0-9+]+/)
      .filter(Boolean)
      .forEach((w) => {
        if (!words.includes(w)) words.push(w);
      });
  push(tail);
  push(p.name ?? "");
  push(p.denomination ?? "");
  if (p.bonus) push(p.bonus);
  return words.join(" ");
}

function renderProduct(p: Product, game: Game): string {
  const label = labelOf(p, game).replace(/\b\w/g, (c) => c.toUpperCase());
  return `${label} ${game.name}: ${idr(p.priceIdr)} ⚡ Pesan di halaman ${game.name} — isi data akun, checkout via WhatsApp, langsung diproses.`;
}

function renderGameList(game: Game, products: Product[]): string {
  const items = products
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((p) => `${labelOf(p, game)} ${idr(p.priceIdr)}`);
  const head = `⚡ ${game.name} — harga per ${brain.trainedAtLabel}:\n`;
  const tail = `\nSemua nominal + order ada di halaman game-nya 🎮`;
  const budget = 740 - head.length - tail.length;
  let used = 0;
  const out: string[] = [];
  for (const it of items) {
    const add = (out.length ? " • " : "") + it;
    if (used + add.length > budget) {
      out.push("…");
      break;
    }
    out.push(it);
    used += add.length;
  }
  return head + out.join(" • ") + tail;
}

type LiveSnapshot = { games: Game[]; products: Product[] } | null;

async function readLiveCatalog(): Promise<LiveSnapshot> {
  try {
    const { repo } = getRepository(false);
    const { snapshot } = await repo.readSnapshot();
    return { games: snapshot.games, products: snapshot.products };
  } catch {
    return null;
  }
}

type LexGame = {
  id: string;
  slug?: string;
  name: string;
  aliases: string[];
  units?: string[];
  productCount?: number;
};

type LexProduct = {
  id: string;
  gameId: string;
  denom: string;
  denomFull: string;
  bonus: boolean;
  tokens: string[];
  priceIdr?: number;
  label?: string;
  gameName?: string;
};

type Lexicon = {
  domainTokens: string[];
  greetings: string[];
  games: LexGame[];
  products: LexProduct[];
};

/**
 * Gabungkan otak terlatih dengan katalog LIVE — inti auto-training:
 * - game baru → alias otomatis dari nama (dikenali TANPA retraining)
 * - harga berubah → leksikon memakai harga baru (kalkulator & rekomendasi)
 * - produk/game dihapus → keluar dari leksikon
 */
function mergeLiveLexicon(base: Lexicon, live: LiveSnapshot): Lexicon {
  if (!live || live.games.length === 0) return base;

  const liveProducts = live.products.filter((p) => p.enabled !== false);
  const liveGames = live.games.filter((g) => {
    const has = liveProducts.some((p) => p.gameId === g.id);
    return g.enabled !== false && has;
  });

  const games: LexGame[] = liveGames.map((g) => {
    const trained = base.games.find((x) => x.id === g.id);
    const autoAliases = [
      g.name.toLowerCase(),
      g.name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
      g.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    ];
    return {
      id: g.id,
      slug: g.slug,
      name: g.name,
      aliases: [...new Set([...(trained?.aliases ?? []), ...autoAliases])],
      units: trained?.units ?? [],
      productCount: liveProducts.filter((p) => p.gameId === g.id).length,
    };
  });

  const products: LexProduct[] = liveProducts.map((p) => {
    const game = liveGames.find((g) => g.id === p.gameId);
    const trained = base.products.find((x) => x.id === p.id);
    if (!game) return trained as LexProduct;
    const bonusNum = p.bonus ? String(p.bonus).replace(/\D/g, "") : "";
    const denom = String(p.denomination ?? "").toLowerCase();
    const label = labelOf(p, game);
    return {
      id: p.id,
      gameId: p.gameId,
      denom,
      denomFull: bonusNum ? `${denom}+${bonusNum}` : denom,
      bonus: Boolean(bonusNum),
      tokens: label.split(" ").filter((w) => w.length > 1),
      priceIdr: p.priceIdr,
      label,
      gameName: game.name,
    };
  });

  return { ...base, games, products };
}

async function trainedAnswer(intent: string): Promise<string | null> {
  try {
    const nlp = await getNlp();
    const answers = await nlp.findAllAnswers("en", intent);
    return answers?.[0]?.answer ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Renderer jawaban yang selalu segar (fakta ≠ bahasa)
// ---------------------------------------------------------------------------

const POPULAR_IDS = ["free-fire", "mobile-legends", "pubg", "roblox", "valorant", "genshin-impact"];

function renderLiveGameList(live: { games: Game[]; products: Product[] }): string {
  const names = live.games
    .filter((g) => live.products.some((p) => p.gameId === g.id && p.enabled))
    .map((g) => g.name);
  const head = `Ada ${names.length} game di NEXA STORE! 🔥\n`;
  const tail = `\nKetik nama game buat lihat harga!`;
  const budget = 740 - head.length - tail.length;
  const shown = names.slice(0, Math.max(2, Math.floor(budget / 18)));
  const list = shown.join(", ") + (names.length > shown.length ? ", …" : "");
  return head + list + tail;
}

function renderLiveCheap(live: { games: Game[]; products: Product[] }): string {
  const rows: Array<{ game: Game; product: Product; price: number }> = [];
  for (const game of live.games) {
    const items = live.products.filter((p) => p.gameId === game.id && p.enabled);
    if (items.length === 0) continue;
    const min = items.reduce((m, p) => (p.priceIdr < m.priceIdr ? p : m), items[0]);
    if (!min) continue;
    rows.push({ game, product: min, price: min.priceIdr });
  }
  rows.sort((a, b) => a.price - b.price);
  const lines = rows
    .slice(0, 8)
    .map((r) => `• ${r.game.name} — ${labelOf(r.product, r.game)} ${idr(r.price)}`);
  return (
    "💸 Top up termurah di NEXA STORE:\n" +
    lines.join("\n") +
    "\nKetik nama game-nya buat lihat semua nominal!"
  );
}

function renderLivePopular(live: { games: Game[]; products: Product[] }): string {
  const popular = POPULAR_IDS.map((id) => live.games.find((g) => g.id === id)).filter(
    (g): g is Game => Boolean(g)
  );
  const rest = live.games.filter((g) => !POPULAR_IDS.includes(g.id));
  const lines = popular
    .slice(0, 6)
    .map((g) => `• ${g.name} — ketik "${g.name.toLowerCase()}" buat lihat harga`);
  const total = popular.length + rest.length;
  return (
    "🔥 Paling laris di NEXA STORE:\n" +
    lines.join("\n") +
    `\nSemua ada ${total} game — ketik "daftar game" buat lihat semuanya!`
  );
}

function renderLiveValue(live: { games: Game[]; products: Product[] }): string {
  const withBonus = live.products
    .filter((p) => p.enabled && (p.denomination ?? "").includes("+"))
    .slice(0, 10);
  const lines = withBonus.map((p) => {
    const game = live.games.find((g) => g.id === p.gameId);
    return game ? `• ${game.name} ${p.denomination} — ${idr(p.priceIdr)}` : null;
  });
  if (lines.length === 0) return "";
  return (
    "💎 Paling worth it (ada bonus ekstra):\n" +
    lines.filter(Boolean).join("\n") +
    "\nBonus nominal besar biasanya lebih hemat per unit — worth it buat push rank! 🎮"
  );
}

const LIVE_RENDERERS: Record<string, (live: { games: Game[]; products: Product[] }) => string> = {
  "store.list": renderLiveGameList,
  "rekomendasi.cheap": renderLiveCheap,
  "rekomendasi.popular": renderLivePopular,
  "rekomendasi.value": renderLiveValue,
};

// ---------------------------------------------------------------------------
// Jawaban utama
// ---------------------------------------------------------------------------

export async function nexaBotAnswer(text: string): Promise<BotReply> {
  const clean = (text ?? "").trim().slice(0, 800);
  if (!clean) {
    return { intent: "None", score: 0, answer: brain.persona.fallback };
  }

  // 0. Penjaga keamanan (v1.15.0) — upaya menggali rahasia ditolak lebih
  // dulu daripada apa pun: api key, token, env, kode, injeksi instruksi.
  if (containsLeakAttempt(clean)) {
    return { intent: "security.refuse", score: 1, answer: GUARD_ANSWER };
  }

  // Katalog live dibaca SEKALI — dipakai leksikon runtime, kalkulator,
  // resolver, dan renderer rekomendasi (fakta selalu segar).
  const live = await readLiveCatalog();
  const lexicon = mergeLiveLexicon(brain.lexicon as Lexicon, live);

  // 1. Kalkulator — harga operand dibaca LIVE ("member mingguan dikali 2").
  if (detectMath(clean)) {
    const answer = solveMath(clean, resolveProductMention, lexicon as never);
    if (answer) {
      return { intent: "math", score: 1, answer: sanitizeAnswer(answer.slice(0, MAX_ANSWER)) };
    }
    // gagal resolve operand → lanjut ke pipeline biasa (mis. "ff dikali 2"
    // lebih baik dijawab daftar harga FF).
  }

  // 2. Resolver katalog deterministik (game + nominal).
  const hit = resolveCatalogQuery(clean, lexicon as never);
  if (hit) {
    if (hit.type === "product") {
      const product = live?.products.find((p) => p.id === hit.productId);
      const game = live?.games.find((g) => g.id === hit.gameId);
      if (product && game) {
        return { intent: `price.${product.id}`, score: 1, answer: renderProduct(product, game) };
      }
      const fallback = await trainedAnswer(`price.${hit.productId}`);
      if (fallback) return { intent: `price.${hit.productId}`, score: 1, answer: fallback.slice(0, MAX_ANSWER) };
      return { intent: `price.${hit.productId}`, score: 1, answer: brain.persona.fallback };
    }
    const game = live?.games.find((g) => g.id === hit.gameId);
    const products = live?.products.filter((p) => p.gameId === hit.gameId && p.enabled) ?? [];
    if (game && products.length > 0) {
      return { intent: `game.${game.id}`, score: 1, answer: renderGameList(game, products) };
    }
    const fallback = await trainedAnswer(`game.${hit.gameId}`);
    if (fallback) return { intent: `game.${hit.gameId}`, score: 1, answer: fallback.slice(0, MAX_ANSWER) };
    return { intent: `game.${hit.gameId}`, score: 1, answer: brain.persona.fallback };
  }

  // 3. Klasifikasi NLP — jawaban positif hanya diterima bila pesan memang
  //    dalam ranah (gerbang mencegah teks acak diklasifikasi paksa).
  const nlp = await getNlp();
  const r = await nlp.process("en", clean);
  if (r && r.intent !== "None" && r.score >= 0.5 && r.answer) {
    const isRefusal = r.intent.startsWith("off.") || r.intent.startsWith("security.");
    if (isRefusal || withinDomain(clean, lexicon as never) || withinDomain(clean, brain.lexicon)) {
      const liveRenderer = LIVE_RENDERERS[r.intent];
      const rendered = live && typeof liveRenderer === "function" ? liveRenderer(live) : "";
      const answer = rendered || r.answer;
      return { intent: r.intent, score: r.score, answer: sanitizeAnswer(answer.slice(0, MAX_ANSWER)) };
    }
  }

  // 4. Gerbang konteks — di luar ranah NEXA STORE ditolak sopan.
  if (!withinDomain(clean, lexicon as never) && !withinDomain(clean, brain.lexicon)) {
    return { intent: "off.Context", score: 1, answer: brain.persona.offContext };
  }
  return { intent: "None", score: r?.score ?? 0, answer: brain.persona.fallback };
}

// --- util kecil untuk rute API: status mode AI dari data store ---

export async function readAiModeFromStore(readBotState: () => Promise<unknown>): Promise<boolean> {
  try {
    const raw = (await readBotState()) as { nexaBot?: { autoReply?: boolean } } | null;
    return raw?.nexaBot?.autoReply !== false; // default: AKTIF
  } catch {
    return true;
  }
}

export const botPersona = brain.persona;
