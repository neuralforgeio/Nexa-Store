/**
 * Chat watcher (v1.3.0) — memantau percakapan PRODUKSI tiap 25 detik.
 *
 * Pesan dari sandbox sudah mendapat ping instan via /internal/chat-notify;
 * watcher ini menutup jalur produksi (Vercel tidak bisa memanggil bot).
 * Notifikasi hanya untuk pesan user yang belum pernah diberitahu.
 */
import * as nexa from "./nexa";
import { notifyOwner } from "./owner";
import { chatNotifyKeyboard, chatNotifyText } from "./ui";
import type { ConversationRecord } from "./nexa";

const POLL_MS = 25_000;
const BOOT_WINDOW_MS = 2 * 3600_000;

const lastNotified = new Map<string, string>();
let booted = false;
let running = false;

export function startChatWatcher(): void {
  // Hot-reload safe: bersihkan interval generasi lama sebelum memulai.
  const g = globalThis as { __nexaChatWatchInterval?: ReturnType<typeof setInterval> };
  if (g.__nexaChatWatchInterval) clearInterval(g.__nexaChatWatchInterval);
  g.__nexaChatWatchInterval = setInterval(() => void tick(), POLL_MS);
  void tick();
}

async function tick(): Promise<void> {
  if (running || !notifyTargetReady()) return;
  running = true;
  try {
    const conversations = await nexa.getChatConversations().catch(() => null);
    if (!conversations) return;
    const bootCutoff = booted ? "0000" : new Date(Date.now() - BOOT_WINDOW_MS).toISOString();
    booted = true;

    for (const c of conversations) {
      if (c.lastFrom === "owner") {
        // Balasan terakhir dari pemilik — percakapan sudah ditangani.
        lastNotified.set(c.id, c.lastMessageAt);
        continue;
      }
      const seen = lastNotified.get(c.id) ?? bootCutoff;
      if (c.unreadByOwner > 0 && c.lastFrom === "user" && c.lastMessageAt > seen) {
        lastNotified.set(c.id, c.lastMessageAt);
        await notifyOwner(chatNotifyText(c.name, c.lastText, false), chatNotifyKeyboard(c.id));
      }
    }
  } finally {
    running = false;
  }
}

function notifyTargetReady(): boolean {
  // Pairing belum selesai → jangan buang kuota API.
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function markNotified(conversation: ConversationRecord): void {
  lastNotified.set(conversation.id, conversation.lastMessageAt);
}
