import { Nlp } from "@nlpjs/basic";
import brain from "../../../nexa-brain.js";
import { resolveCatalogQuery, resolveProductForOrder, resolveProductMention, withinDomain } from "../../../nexa-resolve.js";
import { containsLeakAttempt, sanitizeAnswer, GUARD_ANSWER } from "../../../nexa-guard.js";
import { detectMath, solveMath } from "../../../nexa-math.js";
import { buildOverlay, matchOverlay, personalize } from "../../../nexa-overlay.js";
import { renderIntentLive, renderOrderStatus, ORDER_ID_RE } from "../../../nexa-userctx.js";
import { AGENT_TTL_MS, agentAddToCart, agentFillData, detectPurchaseIntent, extractAccountData } from "../../../nexa-agent.js";
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
  /** v1.19.0: diagnostik otak LLM (ephemeral — hanya metadata respons). */
  llmDebug?: { ok: boolean; kind: string; ms: number };
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
  productId: string;
  gameId: string;
  at: string;
  filled?: Record<string, string>;
  customerName?: string;
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
  if (p.bonus) push(p.bonus);
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
    `Mau langsung pesan? Bilang saja \`pesan ${label.toLowerCase()} ${game.name.toLowerCase()}\` — otomatis kumasukkan ke keranjangmu!\n\n` +
    `Atau buka halaman **${game.name}** → pilih nominal → checkout via WhatsApp.`
  );
}

function renderGameList(game: Game, products: Product[]): string {
  const sorted = products
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const items = sorted.map((p) => `- **${prettyLabel(p, game)}** — ${idr(p.priceIdr)}`);
  const hintLabel = sorted[0] ? labelOf(sorted[0], game) : "nominal";
  const head = `### ⚡ ${game.name} — Daftar Harga\n\n`;
  const tail = `\n💡 Bilang \`pesan ${hintLabel} ${game.name.toLowerCase()}\` — langsung kumasukkan ke keranjang!`;
  const budget = 740 - head.length - tail.length;
  let used = 0;
  const out: string[] = [];
  for (const it of items) {
    const add = (out.length ? "\n" : "") + it;
    if (used + add.length > budget) {
      out.push("- …");
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
      tokens: label.split(" ").filter((w) => w.length > 1),
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

function renderLiveGameList(live: { games: Game[]; products: Product[] }): string {
  const names = live.games
    .filter((g) => live.products.some((p) => p.gameId === g.id && p.enabled))
    .map((g) => g.name);
  const head = `### 🎮 Ada ${names.length} game di NEXA STORE!\n\n`;
  const tail = `\n\n💡 Ketik nama game buat lihat harga — atau bilang \`pesan 2000 diamonds free fire\` biar kumasukkan ke keranjang!`;
  const budget = 740 - head.length - tail.length;
  const shown = names.slice(0, Math.max(2, Math.floor(budget / 18)));
  const list = "- " + shown.join("\n- ") + (names.length > shown.length ? "\n- …" : "");
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
    .map((r) => `- **${r.game.name}** — ${prettyLabel(r.product, r.game)} · ${idr(r.price)}`);
  return (
    "### 💸 Top up termurah di NEXA STORE\n\n" +
    lines.join("\n") +
    "\n\n💡 Ketik nama game-nya buat lihat semua nominal!"
  );
}

function renderLivePopular(live: { games: Game[]; products: Product[] }): string {
  const popular = POPULAR_IDS.map((id) => live.games.find((g) => g.id === id)).filter(
    (g): g is Game => Boolean(g)
  );
  const rest = live.games.filter((g) => !POPULAR_IDS.includes(g.id));
  const lines = popular
    .slice(0, 6)
    .map((g) => `- **${g.name}** — ketik \`${g.name.toLowerCase()}\` buat lihat harga`);
  const total = popular.length + rest.length;
  return (
    "### 🔥 Paling laris di NEXA STORE\n\n" +
    lines.join("\n") +
    `\n\nSemua ada **${total} game** — ketik \`daftar game\` buat lihat semuanya!`
  );
}

function renderLiveValue(live: { games: Game[]; products: Product[] }): string {
  // v1.19.0: produk berbonus terdeteksi lewat field `bonus` ATAU tanda "+"
  // di denominasi (dua format katalog) — sebelumnya selalu kosong.
  const withBonus = live.products
    .filter((p) => p.enabled && (p.bonus || (p.denomination ?? "").includes("+")))
    .slice(0, 10);
  const lines = withBonus.map((p) => {
    const game = live.games.find((g) => g.id === p.gameId);
    return game
      ? `- **${game.name} ${p.denomination}${p.bonus ? ` (+${String(p.bonus).replace(/\s+/g, "")})` : ""}** — ${idr(p.priceIdr)}`
      : null;
  });
  if (lines.length === 0) {
    // Fallback: daftar termurah per game — jangan pernah balas kosong.
    const rows: Array<{ game: Game; product: Product; price: number }> = [];
    for (const game of live.games) {
      const items = live.products.filter((p) => p.gameId === game.id && p.enabled);
      const min = items.length > 0 ? items.reduce((m, p) => (p.priceIdr < m.priceIdr ? p : m), items[0]) : null;
      if (min) rows.push({ game, product: min, price: min.priceIdr });
    }
    rows.sort((a, b) => a.price - b.price);
    const cheap = rows.slice(0, 6).map((r) => `- **${r.game.name}** — ${prettyLabel(r.product, r.game)} · ${idr(r.price)}`);
    return (
      "### 💎 Paling worth it\n\n" +
      cheap.join("\n") +
      "\n\nBonus nominal besar biasanya lebih hemat per unit — worth it buat push rank! 🎮"
    );
  }
  return (
    "### 💎 Paling worth it (ada bonus ekstra)\n\n" +
    lines.filter(Boolean).join("\n") +
    "\n\nBonus nominal besar biasanya lebih hemat per unit — worth it buat push rank! 🎮"
  );
}

const LIVE_RENDERERS: Record<string, (live: { games: Game[]; products: Product[] }) => string> = {
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
// Agent transaksi (v1.18.0)
// ---------------------------------------------------------------------------

/**
 * Langkah agent: mengisi data akun ke item tertunda, atau memasukkan produk
 * ke keranjang pengguna. Mengembalikan BotReply lengkap dengan aksi, atau
 * null bila pesan bukan urusan agent.
 */
function runAgentStep(
  clean: string,
  lexicon: Lexicon,
  live: LiveSnapshot,
  userName: string | null,
  pending: PendingAgentProduct | null
): BotReply | null {
  if (!live) return null;

  // (a) Pengisian data akun — hanya bila ada produk tertunda yang segar.
  if (pending && Date.now() - Date.parse(pending.at) < AGENT_TTL_MS) {
    const product = live.products.find((p) => p.id === pending.productId);
    const game = live.games.find((g) => g.id === pending.gameId);
    if (product && game) {
      // Niat memesan produk BARU menang atas pengisian data (user ganti pikiran).
      const switching =
        detectPurchaseIntent(clean) && resolveProductForOrder(clean, lexicon as never) !== null;
      if (!switching) {
        const extracted = extractAccountData(clean, game.orderFieldSchema ?? []);
        if (extracted) {
          const merged = { ...(pending.filled ?? {}), ...extracted.fields };
          const label = prettyLabel(product, game);
          const built = agentFillData({
            product,
            game,
            label,
            price: product.priceIdr,
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
  }

  // (b) Niat memesan + produk resolvable → masukkan ke keranjang pengguna.
  if (detectPurchaseIntent(clean)) {
    const hit = resolveProductForOrder(clean, lexicon as never);
    if (hit) {
      const product = live.products.find((p) => p.id === hit.productId);
      const game = live.games.find((g) => g.id === hit.gameId);
      if (product && game) {
        const label = prettyLabel(product, game);
        const built = agentAddToCart({
          product,
          game,
          label,
          price: product.priceIdr,
          userName,
          withCartAction: true,
        });
        return {
          intent: "agent.add_to_cart",
          score: 1,
          answer: sanitizeAnswer(built.answer.slice(0, MAX_ANSWER)),
          ...(built.action ? { actions: [built.action] } : {}),
        };
      }
    }
  }

  return null;
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
  // Pola nexa-math: deteksi pola → hitung → render — tanpa menunggu LLM,
  // identik di sandbox maupun produksi.
  const lexProducts = (lexicon.products ?? []) as Array<{
    id: string; gameId: string; label?: string; priceIdr?: number; gameName?: string;
  }>;
  const lexGames = (lexicon.games ?? []) as Array<{ id: string; name: string; aliases?: string[] }>;
  const budgetHit = budgetMatch(clean, lexProducts, lexGames);
  if (budgetHit) {
    const overallCheapest = lexProducts.length > 0
      ? Math.min(...lexProducts.filter((p) => typeof p.priceIdr === "number" && p.priceIdr > 0).map((p) => p.priceIdr as number))
      : null;
    return {
      intent: budgetHit.gameName ? "budget.game" : "budget.all",
      score: 1,
      answer: sanitizeAnswer(renderBudgetAnswer(budgetHit, overallCheapest).slice(0, MAX_ANSWER)),
    };
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
      const fallback = await trainedAnswer(`price.${hit.productId}`, state.modelJson);
      if (fallback) return { intent: `price.${hit.productId}`, score: 1, answer: fallback.slice(0, MAX_ANSWER) };
      return { intent: `price.${hit.productId}`, score: 1, answer: brain.persona.fallback };
    }
    const game = live?.games.find((g) => g.id === hit.gameId);
    const products = live?.products.filter((p) => p.gameId === hit.gameId && p.enabled) ?? [];
    if (game && products.length > 0) {
      return { intent: `game.${game.id}`, score: 1, answer: renderGameList(game, products) };
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
