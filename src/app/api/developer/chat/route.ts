import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability } from "@/lib/api/http";
import { readFeature, updateFeature } from "@/lib/site-features/store";
import { parseChat } from "@/lib/site-features/schema";
import { notifyBotOfOwnerReply } from "@/lib/site-features/chat-notify";
import type { ChatConversation, ConversationSummary } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Developer chat console (v1.3.0) — the owner-side of live chat.
 *
 * GET  → conversations (newest activity first) incl. recent messages.
 * POST → { conversationId, text } owner reply, or { conversationId, action: "markRead" }.
 *
 * The Telegram bot uses the same endpoints (developer session) — replies from
 * the panel and from Telegram land in one conversation stream.
 */

function summarize(c: ChatConversation): ConversationSummary {
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    lastMessageAt: c.lastMessageAt,
    unreadByOwner: c.unreadByOwner,
    messageCount: c.messages.length,
    lastText: last?.text ?? "",
    lastFrom: last?.from ?? null,
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "chat.manage");
  if (denied) return denied;
  try {
    const raw = await readFeature("chat");
    const file = parseChat(raw);
    const conversations = [...file.conversations].sort(
      (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
    );
    return jsonOk({
      conversations: conversations.map((c) => ({
        ...summarize(c),
        messages: c.messages.slice(-50),
      })),
      unreadTotal: conversations.reduce((sum, c) => sum + c.unreadByOwner, 0),
    });
  } catch {
    return jsonError(502, "chat.unavailable", "Obrolan tidak dapat dimuat.");
  }
}

const replySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reply"),
    conversationId: z.string().min(6).max(64),
    text: z.string().min(1).max(800),
  }),
  z.object({
    action: z.literal("markRead"),
    conversationId: z.string().min(6).max(64),
  }),
]);

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "chat.manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", "Data permintaan tidak valid.");
  const input = parsed.data;

  try {
    let replied = false;
    await updateFeature("chat", "chat: owner reply", (currentRaw) => {
      const file = parseChat(currentRaw);
      const conversations = [...file.conversations];
      const index = conversations.findIndex((c) => c.id === input.conversationId);
      if (index === -1) throw new Error("not-found");
      const prev = conversations[index];
      const now = new Date().toISOString();

      if (input.action === "markRead") {
        conversations[index] = { ...prev, unreadByOwner: 0, ownerLastReadAt: now };
        return { conversations };
      }

      const message = {
        id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        from: "owner" as const,
        text: input.text,
        at: now,
      };
      conversations[index] = {
        ...prev,
        messages: [...prev.messages, message],
        lastMessageAt: now,
      };
      replied = true;
      return { conversations };
    });

    if (input.action === "reply") notifyBotOfOwnerReply(input.conversationId, input.text);
    return jsonOk({ ok: true, replied });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "chat.not-found", "Percakapan tidak ditemukan.");
    }
    return jsonError(502, "chat.failed", "Balasan gagal terkirim. Coba lagi.");
  }
}
