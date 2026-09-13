/**
 * State bot: pairing owner (persisten) + sesi percakapan (memori).
 * Setelah pairing, hanya Telegram user id pemilik yang dikenal bot.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { OrderField, GateKey, GameRecord, ProductRecord } from "./nexa";
import type { CommitInfo } from "./gitops";
import type { DeploymentInfo } from "./vercel";

const STATE_PATH = new URL("../.state.json", import.meta.url).pathname;

export type BotState = {
  ownerUserId?: number;
  ownerChatId?: number;
  pairedAt?: string;
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

export function pairOwner(userId: number, chatId: number): void {
  botState = { ownerUserId: userId, ownerChatId: chatId, pairedAt: new Date().toISOString() };
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
  | "announcement-text";

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
  | { type: "deploy-sha"; sha: string; label: string };

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

export type Session = {
  chatId: number;
  stage: "idle" | "input" | "routes" | "confirm";
  input?: InputKind;
  pending?: PendingAction;
  gate?: GateKey;
  routes: string[];
  gameDraft: GameDraft;
  /** Konteks pemilih game: tambah produk / ubah harga / toggle produk / toggle game. */
  pickFor?: "add-product" | "price" | "toggle-product" | "toggle-game";
  lists: {
    commits?: CommitInfo[];
    deployments?: DeploymentInfo[];
    games?: GameRecord[];
    products?: ProductRecord[];
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
  s.pickFor = undefined;
}
