import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, clientIp } from "@/lib/api/http";
import { conversationIdForToken, readFeature, updateFeature } from "@/lib/site-features/store";
import { parseChat } from "@/lib/site-features/schema";
import { notifyBotOfUserMessage } from "@/lib/site-features/chat-notify";
import type { ChatConversation } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Public live-chat endpoint (v1.3.0).
 *
 * GET  /api/chat/messages?token=<32hex>   → poll messages (last 50).
 * POST /api/chat/messages {token, text}   → send a visitor message.
 *
 * The visitor token is generated client-side (random, localStorage) and only
 * its SHA-256 becomes the conversation id — raw tokens never touch persistence.
 * Instant delivery rides WebSocket when available; this endpoint is the
 * always-works fallback (and the write path for user messages).
 */

const SEND_WINDOW_MS = 5 * 60_000;
const SEND_MAX = 12;
const buckets = new Map<string, number[]>();

function sendAllowed(key: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  buckets.set(key, hits);
  return hits.length < SEND_MAX;
}

function sendHit(key: string): void {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
}

const TOKEN_RE = /^[a-f0-9]{32}$/;

const sendSchema = z.object({
  token: z.string().regex(TOKEN_RE),
  text: z.string().min(1).max(800),
  name: z.string().trim().min(1).max(40).optional(),
});

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

function prune(conversations: ChatConversation[]): ChatConversation[] {
  const kept = [...conversations].sort(
    (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
  );
  return kept.slice(0, MAX_CONVERSATIONS).map((c) => ({
    ...c,
    messages: c.messages.slice(-MAX_MESSAGES),
  }));
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return jsonError(400, "validation", "Token percakapan tidak valid.");
  const conversationId = conversationIdForToken(token);

  try {
    const raw = await readFeature("chat");
    const file = parseChat(raw);
    const conv = file.conversations.find((c) => c.id === conversationId);
    if (!conv) return jsonOk({ conversationId, name: null, messages: [] });
    return jsonOk({
      conversationId,
      name: conv.name,
      messages: conv.messages.slice(-50),
    });
  } catch {
    return jsonError(502, "chat.unavailable", "Obrolan tidak dapat dimuat. Coba lagi.");
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Pesan tidak valid (maks 800 karakter).");
  }
  const { token, text, name } = parsed.data;
  const conversationId = conversationIdForToken(token);

  const ip = clientIp(req);
  const limiterKey = `${ip}:${conversationId.slice(0, 8)}`;
  if (!sendAllowed(limiterKey)) {
    return jsonError(429, "rate-limited", "Terlalu banyak pesan. Tunggu sebentar.");
  }
  sendHit(limiterKey);

  try {
    let updated: ChatConversation | null = null;
    let message: { id: string; from: "user" | "owner"; text: string; at: string } | null = null;
    await updateFeature("chat", "chat: visitor message", (currentRaw) => {
      const file = parseChat(currentRaw);
      const conversations = [...file.conversations];
      const index = conversations.findIndex((c) => c.id === conversationId);
      const now = new Date().toISOString();
      message = {
        id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        from: "user" as const,
        text,
        at: now,
      };
      if (index === -1) {
        const conv: ChatConversation = {
          id: conversationId,
          name: name ?? null,
          createdAt: now,
          messages: [message],
          lastMessageAt: now,
          unreadByOwner: 1,
          ownerLastReadAt: null,
        };
        conversations.push(conv);
        updated = conv;
      } else {
        const prev = conversations[index];
        const conv: ChatConversation = {
          ...prev,
          name: name ?? prev.name,
          messages: [...prev.messages, message],
          lastMessageAt: now,
          unreadByOwner: prev.unreadByOwner + 1,
        };
        conversations[index] = conv;
        updated = conv;
      }
      return { conversations: prune(conversations) };
    });

    // Sandbox bridge: instant Telegram ping to the owner (fire-and-forget).
    if (updated) notifyBotOfUserMessage(updated);
    return jsonOk({ sent: true, message });
  } catch {
    return jsonError(502, "chat.send-failed", "Pesan gagal terkirim. Coba lagi.");
  }
}
