/**
 * State bot: pairing owner (persisten) + sesi percakapan (memori).
 * Setelah pairing, hanya Telegram user id pemilik yang dikenal bot.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { OrderField, GateKey, GameRecord, ProductRecord } from "./nexa";
import type { ConversationRecord, PromoRecord, BannerRecord, ScheduleRecord } from "./nexa";
import type { CommitInfo } from "./gitops";
import type { DeploymentInfo } from "./vercel";

/**
 * Lokasi berkas state — tiga lapis:
 * 1. BOT_STATE_FILE (override eksplisit, mis. dipakai route webhook Vercel);
 * 2. runtime serverless Vercel → /tmp (satu-satunya filesystem yang bisa ditulis);
 * 3. mode layanan panel → di samping kode (seperti semula).
 * Di Vercel, pairing jangka panjang dijamin route webhook lewat fitur
 * "bot-state" pada data store aplikasi — /tmp hanya penyangga instance hangat.
 */
function resolveStatePath(): string {
  const override = process.env.BOT_STATE_FILE?.trim();
  if (override) return override;
  if (process.env.VERCEL) return "/tmp/nexa-bot-state.json";
  try {
    return new URL("../.state.json", import.meta.url).pathname;
  } catch {
    return "/tmp/nexa-bot-state.json";
  }
}

const STATE_PATH = resolveStatePath();

export type BotState = {
  ownerUserId?: number;
  ownerChatId?: number;
  pairedAt?: string;
  /** Hari (WIB) terakhir digest analitik terkirim — mencegah dobel kirim. */
  lastDigestDay?: string;
  /** Percakapan yang hidup di sandbox lokal (bukan produksi). */
  chatOrigins?: Record<string, "local">;
};

function readState(): BotState {
  try {
    if (!existsSync(STATE_PATH)) return {};
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as BotState;
  } catch {
    return {};
  }
}

function writeState(state: BotState): void {
  const tmp = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, STATE_PATH);
}

let botState: BotState = readState();

export function isPaired(): boolean {
  return typeof botState.ownerUserId === "number";
}

export function ownerId(): number | null {
  return botState.ownerUserId ?? null;
}

export function ownerChatId(): number | null {
  return botState.ownerChatId ?? null;
}

export function markDigestDay(day: string): void {
  botState.lastDigestDay = day;
  writeState(botState);
}

export function lastDigestDay(): string | null {
  return botState.lastDigestDay ?? null;
}

export function rememberChatOrigin(conversationId: string, origin: "local"): void {
  if (!botState.chatOrigins) botState.chatOrigins = {};
  botState.chatOrigins[conversationId] = origin;
  writeState(botState);
}

/** "local" = percakapan hidup di sandbox; "prod" = produksi. */
export function chatOrigin(conversationId: string): "local" | "prod" {
  return botState.chatOrigins?.[conversationId] === "local" ? "local" : "prod";
}

export function pairOwner(userId: number, chatId: number): void {
  botState = {
    ...botState,
    ownerUserId: userId,
    ownerChatId: chatId,
    pairedAt: new Date().toISOString(),
  };
  writeState(botState);
}

/** Hidrasi pemilik dari luar (route webhook memuat pairing tersimpan). */
export function hydrateOwner(userId: number, chatId: number, pairedAt?: string): void {
  botState = {
    ...botState,
    ownerUserId: userId,
    ownerChatId: chatId,
    ...(pairedAt ? { pairedAt } : {}),
  };
  writeState(botState);
}

/** Untuk pengujian — reset pairing (tidak dipakai di alur normal). */
export function resetPairing(): void {
  botState = {};
  writeState(botState);
}

// ---------------------------------------------------------------------------
// Perlindungan kode pairing: maks 5 percobaan salah per user per jam.
// ---------------------------------------------------------------------------
const pairingAttempts = new Map<number, { count: number; blockUntil: number }>();

export function pairingBlocked(userId: number): boolean {
  const rec = pairingAttempts.get(userId);
  return rec !== undefined && rec.blockUntil > Date.now();
}

export function recordWrongPairing(userId: number): { blocked: boolean; remaining: number } {
  const rec = pairingAttempts.get(userId) ?? { count: 0, blockUntil: 0 };
  rec.count += 1;
  if (rec.count >= 5) {
    rec.blockUntil = Date.now() + 60 * 60_000;
    rec.count = 0;
  }
  pairingAttempts.set(userId, rec);
  return { blocked: rec.blockUntil > 0, remaining: Math.max(0, 5 - rec.count) };
}

// ---------------------------------------------------------------------------
// Sesi percakapan per chat.
// ---------------------------------------------------------------------------

export type InputKind =
  | "lockdown-reason"
  | "maintenance-reason"
  | "ban-reason"
  | "game-name"
  | "game-slug"
  | "game-desc"
  | "game-fields"
  | "game-icon"
  | "category-name"
  | "category-slug"
  | "category-desc"
  | "product-name"
  | "product-denom"
  | "product-price"
  | "product-bonus"
  | "price-new"
  | "whatsapp-number"
  | "announcement-text"
  | "chat-reply"
  | "promo-title"
  | "promo-percent"
  | "promo-duration"
  | "banner-title"
  | "banner-message"
  | "banner-cta-label"
  | "banner-cta-href"
  | "banner-duration"
  | "task-label"
  | "task-time"
  | "task-text"
  | "task-note";

export type PendingAction =
  | { type: "lockdown-on"; gate: GateKey; scope: "all" | "routes"; routes: string[]; note?: string }
  | { type: "gate-off"; gate: GateKey }
  | { type: "ban"; reason: string }
  | { type: "unban" }
  | { type: "category-create"; payload: Record<string, unknown> }
  | { type: "game-create"; payload: Record<string, unknown> }
  | { type: "product-create"; payload: Record<string, unknown> }
  | { type: "product-price"; productId: string; newPrice: number }
  | { type: "game-toggle"; gameId: string }
  | { type: "product-toggle"; productId: string }
  | { type: "settings-whatsapp"; value: string }
  | { type: "settings-announcement"; value: string | null }
  | { type: "deploy-sha"; sha: string; label: string }
  | { type: "chat-reply"; conversationId: string; origin: "local" | "prod"; text: string }
  | { type: "promo-create"; body: Record<string, unknown> }
  | { type: "promo-toggle"; promoId: string; active: boolean }
  | { type: "banner-create"; body: Record<string, unknown> }
  | { type: "banner-toggle"; bannerId: string; enabled: boolean }
  | { type: "task-create"; body: Record<string, unknown> }
  | { type: "task-cancel"; taskId: string };

export type GameDraft = {
  name?: string;
  slug?: string;
  description?: string;
  categoryIds?: string[];
  orderFields?: OrderField[];
  image?: string;
  /** Konteks alur produk. */
  gameId?: string;
  denomination?: string;
  priceIdr?: number;
  productId?: string;
};

export type PromoDraft = {
  title?: string;
  percentOff?: number;
  scope?: "global" | "game";
  gameId?: string;
  endsAt?: string | null;
};

export type BannerDraft = {
  severity?: "info" | "sukses" | "peringatan" | "penting";
  title?: string;
  message?: string;
  ctaLabel?: string;
  ctaHref?: string;
  endsAt?: string | null;
};

export type TaskDraft = {
  type?: string;
  label?: string;
  runAt?: string;
  note?: string;
  text?: string;
  targetId?: string;
};

export type ChatCtx = {
  conversationId: string;
  origin: "local" | "prod";
  name: string | null;
};

export type Session = {
  chatId: number;
  stage: "idle" | "input" | "routes" | "confirm";
  input?: InputKind;
  pending?: PendingAction;
  gate?: GateKey;
  routes: string[];
  gameDraft: GameDraft;
  promoDraft: PromoDraft;
  bannerDraft: BannerDraft;
  taskDraft: TaskDraft;
  chatCtx?: ChatCtx;
  /** Konteks pemilih game: tambah produk / ubah harga / toggle produk / toggle game. */
  pickFor?: "add-product" | "price" | "toggle-product" | "toggle-game" | "promo-game";
  lists: {
    commits?: CommitInfo[];
    deployments?: DeploymentInfo[];
    games?: GameRecord[];
    products?: ProductRecord[];
    conversations?: ConversationRecord[];
    promos?: PromoRecord[];
    banners?: BannerRecord[];
    tasks?: ScheduleRecord[];
  };
};

const sessions = new Map<number, Session>();

export function getSession(chatId: number): Session {
  let s = sessions.get(chatId);
  if (!s) {
    s = {
      chatId,
      stage: "idle",
      routes: [],
      gameDraft: {},
      promoDraft: {},
      bannerDraft: {},
      taskDraft: {},
      lists: {},
    };
    sessions.set(chatId, s);
  }
  return s;
}

export function clearFlow(s: Session): void {
  s.stage = "idle";
  s.input = undefined;
  s.pending = undefined;
  s.gate = undefined;
  s.routes = [];
  s.gameDraft = {};
  s.promoDraft = {};
  s.bannerDraft = {};
  s.taskDraft = {};
  s.pickFor = undefined;
  s.chatCtx = undefined;
}
