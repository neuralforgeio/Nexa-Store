import { NextRequest, after } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, clientIp } from "@/lib/api/http";
import { conversationIdForToken, readFeature, updateFeature } from "@/lib/site-features/store";
import { parseChat } from "@/lib/site-features/schema";
import { chatBridgeEnabled, notifyBotOfUserMessage } from "@/lib/site-features/chat-notify";
import { sendOwnerChatNotification } from "@/lib/telegram-notify";
import { nexaBotAnswer, readAiModeFromStore, type AgentAction } from "@/lib/nexa-bot/engine";
import type { ChatConversation, ChatMessage } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public live-chat endpoint (v1.3.0).
 *
 * GET  /api/chat/messages?token=<32hex>   → poll messages (last 50) + mode AI.
 * POST /api/chat/messages {token, text}   → send a visitor message.
 *
 * The visitor token is generated client-side (random, localStorage) and only
 * its SHA-256 becomes the conversation id — raw tokens never touch persistence.
 * Instant delivery rides WebSocket when available; this endpoint is the
 * always-works fallback (and the write path for user messages).
 *
 * v1.14.0: pesan pengunjung dijawab OTOMATIS oleh Nexa Bot (AI lokal,
 * @nlpjs/basic) selama saklar nexaBot.autoReply aktif di data store. Mode AI
 * dimatikan → hanya developer/admin yang menjawab (balasan tetap ke Telegram).
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

/** v1.18.0: bentuk aksi agent yang dikirim ke klien (ephemeral, tervalidasi). */
const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_to_cart"),
    productId: z.string().min(1).max(120),
    gameId: z.string().min(1).max(120),
    label: z.string().min(1).max(120),
    gameName: z.string().min(1).max(80),
    price: z.number().int().min(0).max(100_000_000),
    requiredFields: z
      .array(z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(80), required: z.boolean() }))
      .max(10),
  }),
  z.object({
    type: z.literal("fill_data"),
    productId: z.string().min(1).max(120),
    gameId: z.string().min(1).max(120),
    fields: z.record(z.string(), z.string()),
    customerName: z.string().max(80).optional(),
  }),
]);

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

/** Tambahkan balasan Nexa Bot ke percakapan (commit terpisah agar preview
 *  notifikasi pemilik tetap menampilkan pesan PENGGUNA, bukan jawaban bot). */
async function appendBotMessage(conversationId: string, text: string): Promise<ChatMessage | null> {
  let appended: ChatMessage | null = null;
  await updateFeature("chat", "chat: nexa bot reply", (currentRaw) => {
    const file = parseChat(currentRaw);
    const conversations = [...file.conversations];
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index === -1) throw new Error("not-found");
    const prev = conversations[index];
    const message: ChatMessage = {
      id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      from: "bot",
      text: text.slice(0, 800),
      at: new Date().toISOString(),
    };
    conversations[index] = {
      ...prev,
      messages: [...prev.messages, message],
      lastMessageAt: message.at,
    };
    appended = message;
    return { conversations: prune(conversations) };
  });
  return appended;
}

/** v1.18.0: simpan meta agent (produk tertunda + data akun terkumpul) di
 * percakapan — memori bot antar-pesan untuk alur pesan → kirim data → checkout. */
async function persistAgentMeta(
  conversationId: string,
  addToCart: Extract<AgentAction, { type: "add_to_cart" }> | null,
  fillData: Extract<AgentAction, { type: "fill_data" }> | null
): Promise<void> {
  try {
    await updateFeature("chat", "chat: agent order context", (currentRaw) => {
      const file = parseChat(currentRaw);
      const conversations = [...file.conversations];
      const index = conversations.findIndex((c) => c.id === conversationId);
      if (index === -1) return { conversations: prune(conversations) };
      const prev = conversations[index];
      if (addToCart) {
        conversations[index] = {
          ...prev,
          agent: {
            productId: addToCart.productId,
            gameId: addToCart.gameId,
            at: new Date().toISOString(),
          },
        };
      } else if (fillData) {
        const prevAgent = prev.agent;
        conversations[index] = {
          ...prev,
          agent: prevAgent
            ? {
                ...prevAgent,
                filled: { ...(prevAgent.filled ?? {}), ...fillData.fields },
                ...(fillData.customerName ? { customerName: fillData.customerName } : {}),
              }
            : {
                productId: fillData.productId,
                gameId: fillData.gameId,
                at: new Date().toISOString(),
                filled: fillData.fields,
                ...(fillData.customerName ? { customerName: fillData.customerName } : {}),
              },
        };
      }
      return { conversations: prune(conversations) };
    });
  } catch {
    // meta agent gagal tersimpan — aksi tetap dieksekusi klien, hanya
    // ingatan antar-pesan yang hilang (tidak boleh menggagalkan balasan).
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return jsonError(400, "validation", "Token percakapan tidak valid.");
  const conversationId = conversationIdForToken(token);

  try {
    const [raw, botState] = await Promise.all([
      readFeature("chat"),
      readFeature("bot-state"),
    ]);
    const aiAutoReply = await readAiModeFromStore(async () => botState);
    const file = parseChat(raw);
    const conv = file.conversations.find((c) => c.id === conversationId);
    if (!conv) return jsonOk({ conversationId, name: null, messages: [], aiAutoReply });
    return jsonOk({
      conversationId,
      name: conv.name,
      messages: conv.messages.slice(-50),
      aiAutoReply,
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
    let message: ChatMessage | null = null;
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

    // Notifikasi pemilik: bridge instan di sandbox, kirim langsung ke
    // Telegram Bot API di lingkungan tanpa layanan bot (produksi/Vercel).
    if (updated) {
      const conversation = updated; // const — narrowing aman untuk closure after()
      if (chatBridgeEnabled()) {
        notifyBotOfUserMessage(conversation);
      } else {
        // v1.8.0: after() menjamin notifikasi dieksekusi setelah respons —
        // `void` biasa bisa ter-freeze runtime serverless sebelum terkirim.
        // v1.14.0: sertakan cuplikan jawaban Nexa Bot bila AI ikut menjawab.
        after(() =>
          sendOwnerChatNotification(
            conversation,
            req.nextUrl.origin,
            botMessage ? botMessage.text : undefined
          )
        );
      }
    }

    // v1.14.0: Nexa Bot menjawab otomatis (mode AI aktif). Kegagalan bot
    // TIDAK pernah menggagalkan pesan pengunjung.
    let botMessage: ChatMessage | null = null;
    const botActions: AgentAction[] = [];
    const botState = await readFeature("bot-state").catch(() => null);
    const aiAutoReply = await readAiModeFromStore(async () => botState);
    if (aiAutoReply && updated) {
      // v1.17.0: identitas pengunjung (nama) diikutkan — bot menyapa personal
      // dan menjawab "kamu mengenal saya?" dengan nama yang benar.
      // v1.18.0: meta agent (produk tertunda) diikutkan — "pesan 2000 dm ff"
      // memasukkan produk ke keranjang, "id saya 123…" mengisi data akun.
      const conversation: ChatConversation = updated;
      try {
        // v1.19.0: riwayat obrolan (tanpa pesan terkini) diikutkan — otak LLM
        // mengingat konteks percakapan, menjawab lanjutan secara wajar.
        const history = (conversation.messages ?? [])
          .slice(-13, -1)
          .map((m) => ({ from: m.from, text: m.text }));
        const reply = await nexaBotAnswer(text, {
          userName: conversation.name ?? null,
          pendingProduct: conversation.agent ?? null,
          history,
        });
        if (reply?.answer) {
          botMessage = await appendBotMessage(conversationId, reply.answer);

          const addToCart = reply.actions?.find((a) => a.type === "add_to_cart");
          const fillData = reply.actions?.find((a) => a.type === "fill_data");
          if (addToCart || fillData) {
            await persistAgentMeta(conversationId, addToCart ?? null, fillData ?? null);
          }
          for (const action of reply.actions ?? []) {
            const parsed = agentActionSchema.safeParse(action);
            if (parsed.success) botActions.push(parsed.data);
          }
        }
      } catch {
        // bot gagal — pengunjung tetap terkirim, admin tetap dapat notifikasi
      }
    }

    return jsonOk({ sent: true, message, botMessage, aiAutoReply, botActions });
  } catch {
    return jsonError(502, "chat.send-failed", "Pesan gagal terkirim. Coba lagi.");
  }
}
