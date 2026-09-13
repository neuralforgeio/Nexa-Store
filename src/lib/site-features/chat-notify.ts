import type { ChatConversation } from "./types";

/**
 * Instant bridge app → bot service (sandbox only).
 *
 * In production the bot discovers new visitor messages by polling the
 * developer chat API. When the app runs next to the bot (panel sandbox), this
 * hook pushes the message to the bot immediately — the owner gets the
 * Telegram ping within a second. Gated by env that only exists in the sandbox.
 */

const NOTIFY_TIMEOUT_MS = 2500;

export function chatBridgeEnabled(): boolean {
  return Boolean(process.env.BOT_SERVICE_INTERNAL_URL && process.env.BOT_SERVICE_INTERNAL_SECRET);
}

export function notifyBotOfUserMessage(conversation: ChatConversation): void {
  const url = process.env.BOT_SERVICE_INTERNAL_URL;
  const secret = process.env.BOT_SERVICE_INTERNAL_SECRET;
  if (!url || !secret) return;
  const last = conversation.messages[conversation.messages.length - 1];
  void fetch(`${url}/internal/chat-notify`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexa-internal": secret },
    body: JSON.stringify({
      conversationId: conversation.id,
      name: conversation.name,
      text: last?.text ?? "",
      // lastMessageAt + id pesan memungkinkan bot menandai pesan ini sudah
      // diberitahukan → chat-watcher (poll 25 dtk) tidak mengirim ping ganda.
      lastMessageAt: conversation.lastMessageAt,
      messageId: last?.id ?? null,
      messageCount: conversation.messages.length,
      // "local" tells the bot this conversation lives on the sandbox instance
      // (http://127.0.0.1:3000) instead of the production API.
      origin: "local",
    }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  }).catch(() => undefined);
}

/** Poked after an owner reply so the bot can push it over WebSocket instantly. */
export function notifyBotOfOwnerReply(conversationId: string, text: string): void {
  const url = process.env.BOT_SERVICE_INTERNAL_URL;
  const secret = process.env.BOT_SERVICE_INTERNAL_SECRET;
  if (!url || !secret) return;
  void fetch(`${url}/internal/chat-owner-reply`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexa-internal": secret },
    body: JSON.stringify({ conversationId, text, origin: "local" }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  }).catch(() => undefined);
}
