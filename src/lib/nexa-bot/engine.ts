import { Nlp } from "@nlpjs/basic";
import brain from "../../../nexa-brain.js";
import { resolveCatalogQuery, resolveProductForOrder, resolveProductMention, withinDomain } from "../../../nexa-resolve.js";
import { containsLeakAttempt, sanitizeAnswer, GUARD_ANSWER } from "../../../nexa-guard.js";
import { detectMath, solveMath } from "../../../nexa-math.js";
import { buildOverlay, matchOverlay, personalize } from "../../../nexa-overlay.js";
import { renderIntentLive, renderOrderStatus, ORDER_ID_RE } from "../../../nexa-userctx.js";
import { AGENT_TTL_MS, agentAddToCart, agentAskChoice, agentFillData, detectPurchaseIntent, extractAccountData } from "../../../nexa-agent.js";
import { isBarePick, resolvePick } from "../../../nexa-pick.js";
import { llmAnswer, llmStatus } from "../../../nexa-llm.js";
import { budgetMatch, renderBudgetAnswer } from "../../../nexa-budget.js";
import { getRepository } from "@/lib/catalog/repo";
import type { Game, Product } from "@/lib/catalog/types";
import { readFeature } from "@/lib/site-features/store";
import { botBrainFileSchema, parsePromos, parseOrders, type BotBrainFile, type CustomIntent } from "@/lib/site-features/schema";
import { activePromos } from "@/lib/site-features/types";

/**
 * Nexa Bot engine (v1.17.0) — otak AI lokal untuk obrolan storefront.
 *
 * Pipeline: penjaga keamanan (anti-bocor) → STATUS PESANAN (ID Order NEXA-…)
 * → kalkulator (nexa-math, harga LIVE) → resolver entitas katalog (NER ala
 * Indonesia: alias game + nominal) → LAPISAN KUSTOM (overlay TF-IDF atas
 * dataset hasil impor — langsung hidup tanpa training) → klasifikasi niat
 * NLP (model bawaan ATAU model hasil latih ulang dari panel AI developer)
 * → gerbang konteks. Jawaban harga selalu dirender dari katalog LIVE.
 *
 * v1.17.0 — SADAR PENGGUNA: identitas chat (nama pengunjung) atau nama
 * Telegram diikutkan sebagai ctx — sapaan, "kamu mengenal saya?", dan
 * jawaban kustom ({name}) dipersonalisasi.
 *
 * v1.17.0 — OTAK KUSTOM: data/store/bot-brain.json (fitur store, dual-mode
 * sandbox/produksi) memuat dataset kustom + model hasil training ulang.
 * Model kustom dipakai bila valid; dataset kustom selalu dipakai overlay.
 *
 * 100% lokal — tanpa API eksternal.
 */

export type BotReply = {
  intent: string;
  score: number;
  answer: string;
  /** v1.18.0: aksi agent (ephemeral — hanya lewat respons POST chat). */
  actions?: AgentAction[];
  /** v1.21.0: opsi pilihan aktif (ephemeral — dipersist rute chat sebagai
   * memori percakapan; "1"/"yang termurah" pada pesan berikutnya langsung
   * dieksekusi add_to_cart oleh lapisan pick). */
  agentOptions?: AgentOption[];
  /** v1.19.0: diagnostik otak LLM (ephemeral — hanya metadata respons). */
  llmDebug?: { ok: boolean; kind: string; ms: number };
};

/** Opsi pilihan — produk yang barusan ditawarkan bot (v1.21.0). */
export type AgentOption = {
  productId: string;
  gameId: string;
  label: string;
  price: number;
};

/** Aksi keranjang dari agent — dieksekusi klien web, tidak pernah dipersist. */
export type AgentAction =
  | {
      type: "add_to_cart";
      productId: string;
      gameId: string;
      label: string;
      gameName: string;
      price: number;
      requiredFields: { key: string; label: string; required: boolean }[];
    }
  | {
      type: "fill_data";
      productId: string;
      gameId: string;
      fields: Record<string, string>;
      customerName?: string;
    };

/** Konteks percakapan — nama pengguna dari identitas chat / Telegram. */
export type BotCtx = {
  userName?: string | null;
  /** v1.18.0: produk tertunda dari meta percakapan (agent transaksi). */
  pendingProduct?: PendingAgentProduct | null;
  /** v1.19.0: riwayat obrolan terakhir (untuk memori otak LLM). */
  history?: { from: "user" | "bot" | "owner"; text: string }[];
};

export type PendingAgentProduct = {
  /** v1.21.0: nullable — entri agent boleh berisi opsi pilihan saja (belum
   * ada produk tertunda) saat bot baru menampilkan daftar budget/harga. */
  productId?: string | null;
  gameId?: string | null;
  at: string;
  filled?: Record<string, string>;
  customerName?: string;
  /** v1.21.0: opsi pilihan aktif (daftar yang barusan bot tampilkan). */
  options?: AgentOption[];
  optionsAt?: string;
};

const MAX_ANSWER = 780; // chatFileSchema: text max 800 — beri ruang.

// ---------------------------------------------------------------------------
// Otak: bundel repo (default) + otak kustom dari data store
// ---------------------------------------------------------------------------

type BrainState = {
  /** kunci versi — "bundled" | "custom-<trainedAt>" */
  key: string;
  /** model NLP kustom (string JSON) bila hasil training tersimpan */
  modelJson: string | null;
  customIntents: CustomIntent[];
  overlay: ReturnType<typeof buildOverlay>;
  at: number;
};

let brainState: BrainState | null = null;
const BRAIN_REFRESH_MS = 30_000;

function emptyOverlayState(key: string, modelJson: string | null, customIntents: CustomIntent[]): BrainState {
  return { key, modelJson, customIntents, overlay: buildOverlay(customIntents), at: Date.now() };
}

/** Otak aktif saat ini — kustom bila ada, bawaan sebagai fallback. */
async function currentBrain(): Promise<BrainState> {
  if (brainState && Date.now() - brainState.at < BRAIN_REFRESH_MS) return brainState;
  try {
    const raw = await readFeature("bot-brain");
    const parsed = botBrainFileSchema.safeParse(raw);
    if (!parsed.success) {
      brainState = emptyOverlayState("bundled", null, []);
      return brainState;
    }
    const file: BotBrainFile = parsed.data;
    // v1.18.0: model kustom hanya dipakai bila dilatih dari korpus yang
    // SAMA versinya dengan bundel — model lama (korpus usang) otomatis
    // mundur ke bundel agar jawaban markdown/korpus baru langsung aktif.
    // Dataset kustom TETAP hidup lewat overlay TF-IDF apa pun versinya.
    const modelCurrent = Boolean(file.modelJson) && file.version === brain.version;
    const key = modelCurrent && file.trainedAt ? `custom-${file.trainedAt}` : "bundled";
    // Optimasi: hanya segarkan overlay saat dataset/trainedAt berubah.
    if (brainState && brainState.key === key && brainState.customIntents === file.customIntents) {
      brainState.at = Date.now();
      return brainState;
    }
    brainState = emptyOverlayState(key, modelCurrent ? file.modelJson ?? null : null, file.customIntents);
    return brainState;
  } catch {
    brainState = emptyOverlayState("bundled", null, []);
    return brainState;
  }
}

const nlpCache = new Map<string, Promise<Nlp>>();

function getNlpFor(key: string, modelJson: string | null): Promise<Nlp> {
  if (!modelJson) return getNlp();
  let p = nlpCache.get(key);
  if (!p) {
    p = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(modelJson);
      return nlp;
    });
    p.catch(() => nlpCache.delete(key));
    nlpCache.set(key, p);
    if (nlpCache.size > 4) {
      // pertahankan kunci terbaru — buang yang paling lama.
      const first = nlpCache.keys().next().value;
      if (first && first !== key) nlpCache.delete(first);
    }
  }
  return p;
}

function getNlp(): Promise<Nlp> {
  let p = nlpCache.get("bundled");
  if (!p) {
    p = Promise.resolve().then(() => {
      const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
      nlp.import(JSON.stringify(brain.model));
      return nlp;
    });
    p.catch(() => nlpCache.delete("bundled"));
    nlpCache.set("bundled", p);
  }
  return p;
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
  // v1.21.0: bonus dirapatkan jadi satu token "+N" (dulu "+ 2" pecah jadi
  // "+" dan "2" sehingga label tampil "30 Delta Coins + 2" yang membingungkan).
  if (p.bonus) push(`+${String(p.bonus).replace(/\D/g, "")}`);
  return words.join(" ");
}

/** Label produk rapi untuk tampilan: "2000 Diamonds". */
function prettyLabel(p: Product, game: Game): string {
  return labelOf(p, game).replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderProduct(p: Product, game: Game): string {
  const label = prettyLabel(p, game);
  return (
    `### ⚡ ${label} — ${game.name}\n\n` +
    `💵 Harga: **${idr(p.priceIdr)}**\n\n` +
    // v1.21.0: cukup bilang "gas" / "beli" — opsi tunggal aktif otomatis.
    `Mau ambil? Bilang saja \`gas\` atau \`beli\` — langsung kumasukkan ke keranjangmu! 🛒\n\n` +
    `Atau buka halaman **${game.name}** → pilih nominal → checkout via WhatsApp.`
  );
}

function renderGameList(game: Game, products: Product[]): string {
  const sorted = products
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  // v1.21.0: DINOMORI — user tinggal balas "1"/"2"/nominalnya, lapisan pick
  // (nexa-pick.js) mengeksekusi add_to_cart tanpa perintah panjang.
  const items = sorted.map((p, i) => `${i + 1}. **${prettyLabel(p, game)}** — ${idr(p.priceIdr)}`);
  const head = `### ⚡ ${game.name} — Daftar Harga\n\n`;
  const tail = `\n💡 Balas **nomornya** (\`1\`, \`2\`) atau nominalnya — langsung kumasukkan ke keranjang!`;
  const budget = 740 - head.length - tail.length;
  let used = 0;
  const out: string[] = [];
  for (const it of items) {
    const add = (out.length ? "\n" : "") + it;
    if (used + add.length > budget) {
      out.push("…");
      break;
    }
    out.push(it);
    used += add.length;
  }
  return head + out.join("\n") + tail;
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
      // v1.21.0: token "+"-prefiks (bonus) dikecualikan dari pencocokan —
      // "pesan 30 delta coins" harus cocok tanpa mengetik "+36".
      tokens: label
        .split(" ")
        .filter((w) => w.length > 1 && !w.startsWith("+")),
      priceIdr: p.priceIdr,
      label,
      gameName: game.name,
    };
  });

  return { ...base, games, products };
}

async function trainedAnswer(intent: string, modelJson: string | null): Promise<string | null> {
  try {
    const state = await currentBrain();
    const nlp = await getNlpFor(state.key, modelJson);
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

function renderLiveGameList(live: { games: Game[]; products: Product[] }): { answer: string; options?: AgentOption[] } {
  const names = live.games
    .filter((g) => live.products.some((p) => p.gameId === g.id && p.enabled))
    .map((g) => g.name);
  const head = `### 🎮 Ada ${names.length} game di NEXA STORE!\n\n`;
  const tail = `\n\n💡 Ketik nama game buat lihat harga — atau bilang \`pesan 2000 diamonds free fire\` biar kumasukkan ke keranjang!`;
  const budget = 740 - head.length - tail.length;
  const shown = names.slice(0, Math.max(2, Math.floor(budget / 18)));
  const list = "- " + shown.join("\n- ") + (names.length > shown.length ? "\n- …" : "");
  return { answer: head + list + tail };
}

function renderLiveCheap(live: { games: Game[]; products: Product[] }): { answer: string; options: AgentOption[] } {
  const rows: Array<{ game: Game; product: Product; price: number }> = [];
  for (const game of live.games) {
    const items = live.products.filter((p) => p.gameId === game.id && p.enabled);
    if (items.length === 0) continue;
    const min = items.reduce((m, p) => (p.priceIdr < m.priceIdr ? p : m), items[0]);
    if (!min) continue;
    rows.push({ game, product: min, price: min.priceIdr });
  }
  rows.sort((a, b) => a.price - b.price);
  const top = rows.slice(0, 8);
  const lines = top.map(
    (r, i) => `${i + 1}. **${r.game.name}** — ${prettyLabel(r.product, r.game)} · ${idr(r.price)}`
  );
  return {
    answer:
      "### 💸 Top up termurah di NEXA STORE\n\n" +
      lines.join("\n") +
      "\n\n💡 Balas **nomornya** (\`1\`, \`2\`) — langsung kumasukkan ke keranjang!",
    options: top.map((r) => ({
      productId: r.product.id,
      gameId: r.game.id,
      label: prettyLabel(r.product, r.game),
      price: r.price,
    })),
  };
}

function renderLivePopular(live: { games: Game[]; products: Product[] }): { answer: string; options?: AgentOption[] } {
  const popular = POPULAR_IDS.map((id) => live.games.find((g) => g.id === id)).filter(
    (g): g is Game => Boolean(g)
  );
  const rest = live.games.filter((g) => !POPULAR_IDS.includes(g.id));
  const lines = popular
    .slice(0, 6)
    .map((g) => `- **${g.name}** — ketik \`${g.name.toLowerCase()}\` buat lihat harga`);
  const total = popular.length + rest.length;
  return {
    answer:
      "### 🔥 Paling laris di NEXA STORE\n\n" +
      lines.join("\n") +
      `\n\nSemua ada **${total} game** — ketik \`daftar game\` buat lihat semuanya!`,
  };
}

function renderLiveValue(live: { games: Game[]; products: Product[] }): { answer: string; options?: AgentOption[] } {
  // v1.19.0: produk berbonus terdeteksi lewat field `bonus` ATAU tanda "+"
  // di denominasi (dua format katalog) — sebelumnya selalu kosong.
  const withBonus = live.products
    .filter((p) => p.enabled && (p.bonus || (p.denomination ?? "").includes("+")))
    .slice(0, 10);
  if (withBonus.length === 0) {
    // Fallback: daftar termurah per game — jangan pernah balas kosong.
    const rows: Array<{ game: Game; product: Product; price: number }> = [];
    for (const game of live.games) {
      const items = live.products.filter((p) => p.gameId === game.id && p.enabled);
      const min = items.length > 0 ? items.reduce((m, p) => (p.priceIdr < m.priceIdr ? p : m), items[0]) : null;
      if (min) rows.push({ game, product: min, price: min.priceIdr });
    }
    rows.sort((a, b) => a.price - b.price);
    const top = rows.slice(0, 6);
    const cheap = top.map(
      (r, i) => `${i + 1}. **${r.game.name}** — ${prettyLabel(r.product, r.game)} · ${idr(r.price)}`
    );
    return {
      answer:
        "### 💎 Paling worth it\n\n" +
        cheap.join("\n") +
        "\n\nBonus nominal besar biasanya lebih hemat per unit — worth it buat push rank! 🎮",
      options: top.map((r) => ({
        productId: r.product.id,
        gameId: r.game.id,
        label: prettyLabel(r.product, r.game),
        price: r.price,
      })),
    };
  }
  const rows = withBonus
    .map((p) => ({ p, game: live.games.find((g) => g.id === p.gameId) }))
    .filter((r): r is { p: Product; game: Game } => Boolean(r.game))
    .slice(0, 8);
  const lines = rows.map(
    (r, i) =>
      `${i + 1}. **${r.game.name} ${r.p.denomination}${r.p.bonus ? ` (+${String(r.p.bonus).replace(/\s+/g, "")})` : ""}** — ${idr(r.p.priceIdr)}`
  );
  return {
    answer:
      "### 💎 Paling worth it (ada bonus ekstra)\n\n" +
      lines.join("\n") +
      "\n\nBalas **nomornya** (\`1\`, \`2\`) — langsung kumasukkan ke keranjang! Bonus nominal besar juga lebih hemat per unit 🎮",
    options: rows.map((r) => ({
      productId: r.p.id,
      gameId: r.game.id,
      label: prettyLabel(r.p, r.game),
      price: r.p.priceIdr,
    })),
  };
}

const LIVE_RENDERERS: Record<string, (live: { games: Game[]; products: Product[] }) => { answer: string; options?: AgentOption[] }> = {
  "store.list": renderLiveGameList,
  "rekomendasi.cheap": renderLiveCheap,
  "rekomendasi.popular": renderLivePopular,
  "rekomendasi.value": renderLiveValue,
};

/** Promo aktif (data mentah — dipakai renderer & otak LLM, v1.19.0). */
async function readActivePromos(): Promise<Array<{ title: string; percentOff: number; endsAt?: string | null }>> {
  try {
    const raw = await readFeature("promos");
    const file = parsePromos(raw);
    const now = new Date();
    return activePromos(file.promos, now).slice(0, 6).map((p) => ({
      title: p.title,
      percentOff: p.percentOff,
      ...(p.endsAt ? { endsAt: new Date(p.endsAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) } : {}),
    }));
  } catch {
    return [];
  }
}

/** Promo aktif (dirender dari data promo live, v1.17.0). */
async function renderActivePromos(): Promise<string> {
  try {
    const raw = await readFeature("promos");
    const file = parsePromos(raw);
    const now = new Date();
    const active = activePromos(file.promos, now).slice(0, 6);
    if (active.length === 0) {
      return "Belum ada promo aktif saat ini 🏷️ Tapi tenang — potongan suka muncul tanpa pengumuman di halaman depan. Pantau terus, atau tanya \"rekomendasi termurah\" buat yang hemat!";
    }
    const lines = active.map((p) => `• ${p.title} — diskon ${p.percentOff}%${p.endsAt ? ` s/d ${new Date(p.endsAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}` : ""}`);
    return (
      "🏷️ Promo AKTIF sekarang di NEXA STORE:\n" +
      lines.join("\n") +
      "\nPotongan otomatis terpasang di harga nominal. Jangan sampai kehabisan!"
    );
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Otak cerdas LLM (v1.19.0) — memahami maksud, menalar data live, menyimpulkan
// ---------------------------------------------------------------------------

/**
 * Tanya otak cerdas, validasi aksinya terhadap katalog LIVE, dan bentuk
 * BotReply lengkap. Mengembalikan null bila LLM tak tersedia/gagal —
 * pipeline lalu melanjutkan ke klasifikasi NLP lokal (cadangan).
 */
async function runLlmBrain(
  clean: string,
  live: LiveSnapshot,
  userName: string | null,
  ctx: BotCtx,
  ctxRef: { llmDebug?: { ok: boolean; kind: string; ms: number } }
): Promise<BotReply | null> {
  if (!live) return null;
  const promos = await readActivePromos();
  const out = await llmAnswer({
    text: clean,
    userName,
    history: ctx.history ?? [],
    games: live.games.filter((g) => g.enabled !== false),
    products: live.products,
    promos,
    pendingProduct: ctx.pendingProduct ?? null,
    cartActions: true,
    siteUrl: process.env.NEXA_SITE_URL || "https://nexastoregame.vercel.app",
    today: new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(new Date()),
  });
  if (!out) {
    // Diagnostik ephemeral: kategori kegagalan (timeout/http/network) — tanpa rahasia.
    const diag = await llmStatus().catch(() => null);
    const last = diag && diag.lastCall ? diag.lastCall : null;
    if (last) ctxRef.llmDebug = { ok: false, kind: String(last.kind), ms: Number(last.ms) || 0 };
    return null;
  }

  // Validasi aksi terhadap katalog LIVE — aksi tak dikenal dibuang diam-diam.
  const actions: AgentAction[] = [];
  if (out.action) {
    if (out.action.type === "add_to_cart") {
      const product = live.products.find((p) => p.id === out.action!.productId && p.enabled !== false);
      const game = live.games.find((g) => g.id === product?.gameId);
      if (product && game) {
        actions.push({
          type: "add_to_cart",
          productId: product.id,
          gameId: game.id,
          label: prettyLabel(product, game),
          gameName: game.name,
          price: product.priceIdr,
          requiredFields: (game.orderFieldSchema ?? []).map((f) => ({
            key: f.key,
            label: f.label ?? f.key,
            required: f.required !== false,
          })),
        });
      }
    } else if (out.action.type === "fill_data") {
      const product = live.products.find((p) => p.id === out.action!.productId);
      const game = live.games.find((g) => g.id === product?.gameId);
      if (product && game) {
        const schema = game.orderFieldSchema ?? [];
        const fields: Record<string, string> = {};
        for (const f of schema) {
          const v = out.action.fields?.[f.key];
          if (typeof v === "string" && v.trim()) fields[f.key] = v.trim().slice(0, 80);
        }
        if (Object.keys(fields).length > 0) {
          actions.push({
            type: "fill_data",
            productId: product.id,
            gameId: game.id,
            fields,
            ...(out.action.customerName ? { customerName: out.action.customerName } : {}),
          });
        }
      }
    }
  }

  return {
    intent: "llm.answer",
    score: 1,
    answer: sanitizeAnswer(out.answer.slice(0, MAX_ANSWER)),
    ...(actions.length > 0 ? { actions } : {}),
    llmDebug: { ok: true, kind: "ok", ms: Number(out.ms) || 0 },
  };
}

/** Cari pesanan berdasar ID Order yang tertanam di pesan (v1.17.0). */
async function findOrderById(orderId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFeature("orders");
    const file = parseOrders(raw);
    return (file.orders.find((o) => o.id === orderId) as unknown as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent transaksi (v1.18.0 → v1.21.0 sadar-konteks)
// ---------------------------------------------------------------------------

/** Opsi pilihan aktif + segar dari meta percakapan (TTL sama dengan produk tertunda). */
function freshOptions(pending: PendingAgentProduct | null): AgentOption[] {
  if (!pending?.options?.length) return [];
  const at = pending.optionsAt ?? pending.at;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms) || Date.now() - ms >= AGENT_TTL_MS) return [];
  return pending.options;
}

/** Ubah alasan pick (nexa-pick) jadi catatan konteks yang manusiawi. */
function noteOf(why: string): string {
  if (why.startsWith("nomor")) return `Pilihan ${why} diterima!`;
  if (why.includes("termurah")) return "Yang termurah, sesuai pilihanmu!";
  if (why.includes("termahal")) return "Yang termahal, sesuai pilihanmu!";
  if (why.includes("nominal")) return "Nominalnya cocok — langsung kuproses!";
  return "Sesuai rekomendasi tadi!";
}

/** Balas add_to_cart lengkap (aksi + jawaban terisi konteks). */
function cartReply(
  product: Product,
  game: Game,
  userName: string | null,
  contextNote?: string
): BotReply {
  const label = prettyLabel(product, game);
  const built = agentAddToCart({
    product,
    game,
    label,
    price: product.priceIdr,
    userName,
    withCartAction: true,
    ...(contextNote ? { contextNote } : {}),
  });
  return {
    intent: "agent.add_to_cart",
    score: 1,
    answer: sanitizeAnswer(built.answer.slice(0, MAX_ANSWER)),
    ...(built.action ? { actions: [built.action] } : {}),
  };
}

/**
 * v1.21.0: nominal telanjang di pesan yang cocok dengan produk game pending —
 * "yang 2400 aja" setelah memesan pb-1200 adalah GANTI NOMINAL, bukan data
 * akun. Mengembalikan produk tujuan switch, atau null.
 */
function nominalInGame(clean: string, game: Game | null, live: LiveSnapshot): Product | null {
  if (!game) return null;
  const t = ` ${clean.toLowerCase().replace(/\s+/g, " ")} `;
  const nums: string[] = [];
  for (const m of t.matchAll(/(?:^|\s)(\d{2,6})(?=\s|$|\+)/g)) nums.push(m[1]);
  if (nums.length === 0) return null;
  const products = live.products.filter((p) => p.gameId === game.id && p.enabled !== false);
  for (const n of nums) {
    const hit = products.find((p) => String(p.denomination ?? "") === n);
    if (hit) return hit;
  }
  return null;
}

/**
 * Langkah agent (v1.21.0 — LANGSUNG PAHAM KONTEKS):
 * (0) PILIH dari opsi aktif — "1", "yang kedua", "1200", "yang termurah",
 *     "masukin yang point blank itu" dieksekusi add_to_cart tanpa mengetik
 *     ulang perintah panjang. Ambigu → pertanyaan pilihan bernomor.
 * (a) Pengisian data akun ke item tertunda (kalimat data akun murni).
 * (b) Niat memesan presisi ("pesan 2000 dm rp246.000 ff") → add_to_cart.
 * (c) Niat memesan + game disebut tapi nominal belum jelas → selesai lewat
 *     opsi aktif (budget sebelumnya) atau tanya pilihan bernomor — BUKAN
 *     memuntahkan daftar harga pasif lagi.
 * Mengembalikan BotReply lengkap, atau null bila pesan bukan urusan agent.
 */
function runAgentStep(
  clean: string,
  lexicon: Lexicon,
  live: LiveSnapshot,
  userName: string | null,
  pending: PendingAgentProduct | null
): BotReply | null {
  if (!live) return null;

  const options = freshOptions(pending);
  const intent = detectPurchaseIntent(clean);
  const barePick = isBarePick(clean);

  // Pesan yang jelas-jelas PENGIRIMAN DATA AKUN murni (ada field terisi)
  // didahulukan ke (a) — angka di dalamnya bukan pilihan nominal.
  const pendingFresh =
    pending?.productId && Date.now() - Date.parse(pending.at) < AGENT_TTL_MS ? pending : null;
  const pendingGame = pendingFresh
    ? live.games.find((g) => g.id === pendingFresh.gameId)
    : null;
  const pendingProduct = pendingFresh
    ? live.products.find((p) => p.id === pendingFresh.productId)
    : null;
  // v1.21.0: nominal telanjang yang cocok produk game pending = GANTI NOMINAL
  // ("yang 2400 aja" setelah pb-1200) — bukan data akun.
  const nominalSwitch =
    (intent || barePick) && pendingGame ? nominalInGame(clean, pendingGame, live) : null;
  const accountish =
    pendingGame && !intent && !barePick && !nominalSwitch
      ? extractAccountData(clean, pendingGame.orderFieldSchema ?? [])
      : null;

  // (0) PILIHAN dari opsi aktif — pintu masuk utama v1.21.0.
  if (options.length > 0 && !accountish && (intent || barePick)) {
    const resolved = resolvePick(clean, options, lexicon as never);
    if (resolved.kind === "unique") {
      const product = live.products.find((p) => p.id === resolved.pick.productId);
      const game = live.products.length > 0 ? live.games.find((g) => g.id === resolved.pick.gameId) : null;
      if (product) {
        const g = game ?? live.games.find((x) => x.id === product.gameId);
        if (g) return cartReply(product, g, userName, noteOf(resolved.why));
      }
    }
    if (resolved.kind === "ambiguous" && resolved.candidates.length >= 2) {
      // Konfirmasi singkat bernomor — balasan "1"/"2" berikutnya dieksekusi.
      const built = agentAskChoice({
        gameName:
          resolved.candidates.every((c) => c.gameId === resolved.candidates[0].gameId)
            ? live.games.find((g) => g.id === resolved.candidates[0].gameId)?.name ?? null
            : null,
        reason: "ambiguous",
        options: resolved.candidates,
        userName,
      });
      return {
        intent: "agent.ask_choice",
        score: 1,
        answer: sanitizeAnswer(built.answer.slice(0, MAX_ANSWER)),
        agentOptions: built.options as AgentOption[],
      };
    }
  }

  // (a) Pengisian data akun — hanya bila ada produk tertunda yang segar.
  if (pendingGame && pendingProduct) {
    // Niat memesan produk BARU menang atas pengisian data (user ganti pikiran):
    // resolusi presisi ATAU nominal yang cocok produk game pending.
    const switching =
      (intent && resolveProductForOrder(clean, lexicon as never) !== null) ||
      Boolean(nominalSwitch);
    if (!switching) {
      const extracted = extractAccountData(clean, pendingGame.orderFieldSchema ?? []);
      if (extracted) {
        const merged = { ...(pending.filled ?? {}), ...extracted.fields };
        const label = prettyLabel(pendingProduct, pendingGame);
        const built = agentFillData({
          product: pendingProduct,
          game: pendingGame,
          label,
          price: pendingProduct.priceIdr,
          extracted: { fields: merged, hits: extracted.hits },
          customerName: extracted.customerName ?? pending.customerName,
        });
        return {
          intent: "agent.fill_data",
          score: 1,
          answer: sanitizeAnswer(built.answer.slice(0, MAX_ANSWER)),
          actions: [built.action],
        };
      }
    }
  }

  // (b) Niat memesan presisi → langsung masukkan ke keranjang pengguna.
  if (intent) {
    const hit = resolveProductForOrder(clean, lexicon as never);
    if (hit) {
      const product = live.products.find((p) => p.id === hit.productId);
      const game = live.games.find((g) => g.id === hit.gameId);
      if (product && game) return cartReply(product, game, userName);
    }
  }

  // (c) Niat memesan + game disebut + nominal belum jelas → selesaikan lewat
  // konteks: opsi aktif game itu (budget/rekomendasi barusan), game produk
  // tunggal, atau pertanyaan pilihan bernomor. Dulu: daftar harga pasif +
  // disuruh ketik "pesan <label panjang> <game>" — inilah yang dikeluhkan.
  if (intent) {
    const gameHit = findGameLiteFromLexicon(clean, lexicon);
    if (gameHit) {
      const game = live.games.find((g) => g.id === gameHit.id);
      const products = game
        ? live.products
            .filter((p) => p.gameId === game.id && p.enabled !== false)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        : [];
      if (game && products.length > 0) {
        const inOptions = options.filter((o) => o.gameId === game.id);
        if (inOptions.length === 1) {
          // Budget/rekomendasi barusan sudah memilihkan satu produk game ini.
          const product = live.products.find((p) => p.id === inOptions[0].productId);
          if (product) {
            return cartReply(
              product,
              game,
              userName,
              "Sesuai budget & rekomendasi tadi!"
            );
          }
        }
        if (products.length === 1) {
          return cartReply(products[0], game, userName, "Satu-satunya nominal game ini!");
        }
        // Pilih kandidat: opsi game itu (jika ada) atau 6 termurah dulu.
        const candidates = (
          inOptions.length > 0
            ? inOptions.map((o) => products.find((p) => p.id === o.productId)).filter((p): p is Product => Boolean(p))
            : products.slice(0, 6)
        ).slice(0, 6);
        if (candidates.length > 0) {
          const built = agentAskChoice({
            gameName: game.name,
            reason: inOptions.length > 0 ? "budget" : "list",
            options: candidates.map((p) => ({
              label: prettyLabel(p, game),
              price: p.priceIdr,
            })),
            userName,
          });
          return {
            intent: "agent.ask_choice",
            score: 1,
            answer: sanitizeAnswer(built.answer.slice(0, MAX_ANSWER)),
            agentOptions: candidates.map((p) => ({
              productId: p.id,
              gameId: game.id,
              label: prettyLabel(p, game),
              price: p.priceIdr,
            })),
          };
        }
      }
    } else if (nominalSwitch && pendingGame) {
      // "yang 2400 aja" tanpa menyebut game — ganti nominal item pending.
      return cartReply(nominalSwitch, pendingGame, userName, "Ganti nominal — siap!");
    } else if (options.length > 0 && /\b(?:termurah|paling murah|paling hemat|termahal|paling mahal)\b/.test(clean.toLowerCase())) {
      // "yang termurah aja" tanpa game — ambil dari opsi aktif.
      const wantCheap = !/mahal/.test(clean.toLowerCase());
      const sorted = options.slice().sort((a, b) => (wantCheap ? a.price - b.price : b.price - a.price));
      const ties = sorted.filter((o) => o.price === sorted[0].price);
      if (ties.length === 1) {
        const product = live.products.find((p) => p.id === ties[0].productId);
        const game = live.games.find((g) => g.id === ties[0].gameId);
        if (product && game) {
          return cartReply(product, game, userName, noteOf(wantCheap ? "termurah" : "termahal"));
        }
      }
    } else if (options.length === 1) {
      // Opsi tunggal aktif + niat memesan tanpa selector → ambil langsung.
      const product = live.products.find((p) => p.id === options[0].productId);
      const game = live.games.find((g) => g.id === options[0].gameId);
      if (product && game) return cartReply(product, game, userName, noteOf("rekomendasi"));
    }
  }

  return null;
}

/** Deteksi penyebutan game untuk langkah (c) — versi ringan dari findGame. */
function findGameLiteFromLexicon(clean: string, lexicon: Lexicon): { id: string; name: string } | null {
  const norm = ` ${clean.toLowerCase().replace(/\s+/g, " ").trim()} `;
  let best: { id: string; name: string; len: number } | null = null;
  for (const g of lexicon.games ?? []) {
    for (const alias of [g.name.toLowerCase(), ...(g.aliases ?? [])]) {
      if (!alias || alias.length < 2) continue;
      const re = new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
      if (re.test(norm) && (!best || alias.length > best.len)) {
        best = { id: g.id, name: g.name, len: alias.length };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Jawaban utama
// ---------------------------------------------------------------------------

export async function nexaBotAnswer(text: string, ctx: BotCtx = {}): Promise<BotReply> {
  // v1.19.0: pembungkus diagnostik — bila otak LLM dicoba dan gagal,
  // kategori kegalannya ikut pada respons (ephemeral, tanpa rahasia).
  const debugRef: { llmDebug?: { ok: boolean; kind: string; ms: number } } = {};
  const reply = await nexaBotAnswerInner(text, ctx, debugRef);
  return debugRef.llmDebug && !reply.llmDebug ? { ...reply, llmDebug: debugRef.llmDebug } : reply;
}

async function nexaBotAnswerInner(
  text: string,
  ctx: BotCtx,
  llmDebugRef: { llmDebug?: { ok: boolean; kind: string; ms: number } }
): Promise<BotReply> {
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
  const state = await currentBrain();
  const userName = ctx.userName ?? null;

  // 0.5 STATUS PESANAN (v1.17.0) — ID Order NEXA-… di pesan → resi instan.
  const orderIdHit = clean.toUpperCase().match(ORDER_ID_RE);
  if (orderIdHit) {
    const order = await findOrderById(orderIdHit[0]);
    return {
      intent: order ? "order.status" : "order.notfound",
      score: 1,
      answer: sanitizeAnswer(renderOrderStatus(order).slice(0, MAX_ANSWER)),
    };
  }

  // 1. Kalkulator — harga operand dibaca LIVE ("member mingguan dikali 2").
  if (detectMath(clean)) {
    const answer = solveMath(clean, resolveProductMention, lexicon as never);
    if (answer) {
      return { intent: "math", score: 1, answer: sanitizeAnswer(answer.slice(0, MAX_ANSWER)) };
    }
    // gagal resolve operand → lanjut ke pipeline biasa (mis. "ff dikali 2"
    // lebih baik dijawab daftar harga FF).
  }

  // 1.5 AGENT TRANSAKSI (v1.18.0) — "pesan 2000 diamonds rp246.000 ff"
  // memasukkan produk ke keranjang pengguna; "id saya 123456789" mengisikan
  // data akun ke item yang tertunda. Aksi bersifat ephemeral (respons POST).
  const agentReply = runAgentStep(clean, lexicon, live, userName, ctx.pendingProduct ?? null);
  if (agentReply) return agentReply;

  // 1.7 KALKULATOR BUDGET (v1.20.0) — "modal 50rb bisa top up apa?" dijawab
  // presisi dari data live: daftar produk yang benar-benar muat di budget
  // (nominal terbesar per game), fokus ke game yang disebut bila ada.
  // v1.21.0: baris jawaban DINOMORI dan produknya menjadi OPsi pilihan aktif —
  // "masukin yang point blank itu" pada pesan berikutnya langsung dieksekusi
  // add_to_cart oleh lapisan pick (runAgentStep 0/c).
  const lexProducts = (lexicon.products ?? []) as Array<{
    id: string; gameId: string; label?: string; priceIdr?: number; gameName?: string;
  }>;
  const lexGames = (lexicon.games ?? []) as Array<{ id: string; name: string; aliases?: string[] }>;
  const budgetHit = budgetMatch(clean, lexProducts, lexGames);
  if (budgetHit) {
    const overallCheapest = lexProducts.length > 0
      ? Math.min(...lexProducts.filter((p) => typeof p.priceIdr === "number" && p.priceIdr > 0).map((p) => p.priceIdr as number))
      : null;
    const shown = budgetHit.rows.slice(0, 8);
    return {
      intent: budgetHit.gameName ? "budget.game" : "budget.all",
      score: 1,
      answer: sanitizeAnswer(renderBudgetAnswer({ ...budgetHit, rows: shown }, overallCheapest).slice(0, MAX_ANSWER)),
      ...(shown.length > 0
        ? {
            agentOptions: shown.map((r) => ({
              productId: r.productId,
              gameId: r.gameId,
              label: r.label,
              price: r.price,
            })),
          }
        : {}),
    };
  }

  // 2. Resolver katalog deterministik (game + nominal).
  // v1.21.0: daftar harga / kartu produk kini membawa OPsi pilihan aktif —
  // balasan "1"/"1200"/"gas" pada pesan berikutnya langsung dieksekusi.
  const hit = resolveCatalogQuery(clean, lexicon as never);
  if (hit) {
    if (hit.type === "product") {
      const product = live?.products.find((p) => p.id === hit.productId);
      const game = live?.games.find((g) => g.id === hit.gameId);
      if (product && game) {
        return {
          intent: `price.${product.id}`,
          score: 1,
          answer: renderProduct(product, game),
          agentOptions: [
            { productId: product.id, gameId: game.id, label: prettyLabel(product, game), price: product.priceIdr },
          ],
        };
      }
      const fallback = await trainedAnswer(`price.${hit.productId}`, state.modelJson);
      if (fallback) return { intent: `price.${hit.productId}`, score: 1, answer: fallback.slice(0, MAX_ANSWER) };
      return { intent: `price.${hit.productId}`, score: 1, answer: brain.persona.fallback };
    }
    const game = live?.games.find((g) => g.id === hit.gameId);
    const products = live?.products.filter((p) => p.gameId === hit.gameId && p.enabled) ?? [];
    if (game && products.length > 0) {
      const sorted = products.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return {
        intent: `game.${game.id}`,
        score: 1,
        answer: renderGameList(game, sorted),
        agentOptions: sorted.slice(0, 8).map((p) => ({
          productId: p.id,
          gameId: game.id,
          label: prettyLabel(p, game),
          price: p.priceIdr,
        })),
      };
    }
    const fallback = await trainedAnswer(`game.${hit.gameId}`, state.modelJson);
    if (fallback) return { intent: `game.${hit.gameId}`, score: 1, answer: fallback.slice(0, MAX_ANSWER) };
    return { intent: `game.${hit.gameId}`, score: 1, answer: brain.persona.fallback };
  }

  // 2.5 LAPISAN KUSTOM (v1.17.0) — dataset hasil impor dicocokkan secara
  // statistik (TF-IDF cosine) SEBELUM klasifikasi NLP — langsung hidup.
  if (state.customIntents.length > 0) {
    const overlayHit = matchOverlay(state.overlay, clean);
    if (overlayHit) {
      return {
        intent: overlayHit.intent,
        score: overlayHit.score,
        answer: sanitizeAnswer(personalize(overlayHit.answer, userName).slice(0, MAX_ANSWER)),
      };
    }
  }

  // 2.6 OTAK CERDAS LLM (v1.19.0) — pertanyaan yang tidak tertangani lapisan
  // di atasnya diserahkan ke LLM: memahami maksud dalam bahasa apa pun
  // (typo/slang/campur ID-EN), menalar data katalog LIVE (termurah, budget,
  // perbandingan, rekomendasi), lalu menyimpulkan dan menjawab Markdown rapi.
  // Gagal/timeout/tak tersedia → lanjut ke NLP lokal (cadangan) tanpa henti.
  const llmCtxRef: { llmDebug?: { ok: boolean; kind: string; ms: number } } = {};
  const llmReply = await runLlmBrain(clean, live, userName, ctx, llmCtxRef);
  if (llmReply) return llmReply;
  if (llmCtxRef.llmDebug) llmDebugRef.llmDebug = llmCtxRef.llmDebug;

  // 3. Klasifikasi NLP — jawaban positif hanya diterima bila pesan memang
  //    dalam ranah (gerbang mencegah teks acak diklasifikasi paksa).
  const nlp = await getNlpFor(state.key, state.modelJson);
  const r = await nlp.process("en", clean);
  if (r && r.intent !== "None" && r.score >= 0.5 && r.answer) {
    const isRefusal = r.intent.startsWith("off.") || r.intent.startsWith("security.");
    if (isRefusal || withinDomain(clean, lexicon as never) || withinDomain(clean, brain.lexicon)) {
      // v1.17.0: renderer sadar-pengguna & sadar-fakta menimpa jawaban statis
      // (sapaan personal, "kamu mengenal saya", statistik toko live…).
      const personal = renderIntentLive(r.intent, { lexicon, userName });
      if (personal) {
        return { intent: r.intent, score: r.score, answer: sanitizeAnswer(personal.slice(0, MAX_ANSWER)) };
      }
      if (r.intent === "store.promo.now") {
        const promos = await renderActivePromos();
        if (promos) return { intent: r.intent, score: r.score, answer: sanitizeAnswer(promos.slice(0, MAX_ANSWER)) };
      }
      const liveRenderer = LIVE_RENDERERS[r.intent];
      if (live && typeof liveRenderer === "function") {
        const rendered = liveRenderer(live);
        return {
          intent: r.intent,
          score: r.score,
          answer: sanitizeAnswer(rendered.answer.slice(0, MAX_ANSWER)),
          ...(rendered.options && rendered.options.length > 0 ? { agentOptions: rendered.options.slice(0, 8) } : {}),
        };
      }
      return { intent: r.intent, score: r.score, answer: sanitizeAnswer(r.answer.slice(0, MAX_ANSWER)) };
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

/** Metadata otak aktif — dipakai panel AI developer. */
export async function brainStatus(): Promise<{
  active: "bundled" | "custom";
  llm: { available: boolean; source: string };
  custom: { version: string | null; trainedAt: string | null; intentsCount: number | null; utterancesCount: number | null; customCount: number; hasModel: boolean } | null;
  bundled: { version: string; trainedAt: string; trainedAtLabel: string };
}> {
  const state = await currentBrain().catch(() => null);
  const llm = await llmStatus().catch(() => ({ available: false, source: "unavailable" }));
  let file: BotBrainFile | null = null;
  try {
    const parsed = botBrainFileSchema.safeParse(await readFeature("bot-brain"));
    file = parsed.success ? parsed.data : null;
  } catch {
    file = null;
  }
  return {
    active: state?.modelJson ? "custom" : "bundled",
    llm,
    custom: file
      ? {
          version: file.version ?? null,
          trainedAt: file.trainedAt ?? null,
          intentsCount: file.intentsCount ?? null,
          utterancesCount: file.utterancesCount ?? null,
          customCount: file.customIntents.length,
          hasModel: Boolean(file.modelJson),
        }
      : null,
    bundled: {
      version: brain.version,
      trainedAt: brain.trainedAt,
      trainedAtLabel: brain.trainedAtLabel,
    },
  };
}

/** Paksa segarkan cache otak (dipanggil setelah latih ulang / impor). */
export function invalidateBrainCache(): void {
  brainState = null;
}

export const botPersona = brain.persona;
