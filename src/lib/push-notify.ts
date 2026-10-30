import webpush from "web-push";
import { readFeature, updateFeature } from "@/lib/site-features/store";

/**
 * Web Push (v1.6.0 → v1.21.0) — notifikasi browser untuk pengunjung yang
 * menyetujui. Pengunjung menekan tombol bel (widget chat / langkah sukses
 * pesanan / halaman Lacak) → service worker berlangganan (VAPID) → endpoint
 * disimpan di data store "push-subs" per percakapan.
 *
 * v1.21.0 — tiga jenis pemicu:
 * 1. sendVisitorChatPush  — pemilik (manusia) membalas obrolan. Selalu tampil.
 * 2. sendBotReplyPush     — Nexa Bot (AI) membalas. skipWhenVisible: notifikasi
 *                           di-skip saat tab toko sedang terlihat (sudah dibaca).
 * 3. sendOrderStatusPush  — status pesanan berubah (admin/panel/Telegram).
 *
 * Selalu best-effort: kegagalan kirim tidak pernah mengganggu respons API.
 * Langganan kedaluwarsa (404/410) dibersihkan otomatis.
 */

const SEND_TIMEOUT_MS = 4_000;

type PushSub = {
  endpoint: string;
  p256dh: string;
  auth: string;
  name: string | null;
  at: string;
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** true → service worker melewati notifikasi bila tab toko terlihat. */
  skipWhenVisible?: boolean;
};

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@nexastore.id";
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

/** Kirim payload push ke langganan percakapan ini; prune 404/410. */
async function sendPushPayload(conversationId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  let sub: PushSub | undefined;
  try {
    const file = (await readFeature("push-subs")) as { subs?: Record<string, PushSub> };
    sub = file.subs?.[conversationId];
  } catch {
    return;
  }
  if (!sub?.endpoint) return;

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 24 * 60 * 60, timeout: SEND_TIMEOUT_MS }
    );
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      // Langganan tidak berlaku lagi — bersihkan.
      try {
        await updateFeature("push-subs", "push: prune stale", (currentRaw) => {
          const subs = { ...((currentRaw as { subs?: Record<string, PushSub> })?.subs ?? {}) };
          delete subs[conversationId];
          return { subs };
        });
      } catch {
        // abaikan
      }
      return;
    }
    console.error("[push-notify] kirim error:", status ?? (e as Error).message);
  }
}

/** 1. Pemilik membalas obrolan — selalu tampil (manusia = penting). */
export async function sendVisitorChatPush(conversationId: string, replyText: string): Promise<void> {
  const preview = replyText.length > 140 ? `${replyText.slice(0, 140)}…` : replyText;
  await sendPushPayload(conversationId, {
    title: "Nexa Store membalas obrolanmu",
    body: preview,
    url: "/",
    tag: "nexa-chat-reply",
  });
}

/** 2. Nexa Bot (AI) membalas — skip bila tab toko sedang terlihat. */
export async function sendBotReplyPush(conversationId: string, replyText: string): Promise<void> {
  const preview = replyText.length > 120 ? `${replyText.slice(0, 120)}…` : replyText;
  await sendPushPayload(conversationId, {
    title: "Nexa Bot membalas",
    body: preview,
    url: "/",
    tag: "nexa-bot-reply",
    skipWhenVisible: true,
  });
}

/** 3. Status pesanan berubah — buka resi saat diklik. */
const ORDER_STATUS_TEXT: Record<string, string> = {
  pending: "Menunggu pembayaran/konfirmasi",
  processing: "Sedang diproses",
  success: "Selesai — selamat bermain! 🎉",
  cancel: "Dibatalkan",
};

export async function sendOrderStatusPush(
  conversationId: string,
  order: { id: string; status: string; reason?: string | null }
): Promise<void> {
  const label = ORDER_STATUS_TEXT[order.status] ?? order.status;
  const reason = order.reason?.trim();
  const body = reason ? `${label} — ${reason.slice(0, 120)}` : label;
  await sendPushPayload(conversationId, {
    title: `Pesanan ${order.id}`,
    body,
    url: `/track?id=${encodeURIComponent(order.id)}`,
    tag: `nexa-order-${order.id}`,
  });
}
