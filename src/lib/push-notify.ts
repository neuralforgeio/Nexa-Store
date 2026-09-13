import webpush from "web-push";
import { readFeature, updateFeature } from "@/lib/site-features/store";

/**
 * Web Push (v1.6.0) — notifikasi browser untuk pengunjung yang menyetujui.
 *
 * Pengunjung menekan tombol bel di widget obrolan → browser meminta izin →
 * service worker berlangganan (VAPID) → endpoint disimpan di data store
 * "push-subs" per percakapan. Saat pemilik membalas, balasan dikirim sebagai
 * push notification — pengunjung melihatnya meski sudah meninggalkan situs.
 *
 * Selalu best-effort: kegagalan kirim tidak pernah mengganggu respons API.
 */

const SEND_TIMEOUT_MS = 4_000;

type PushSub = {
  endpoint: string;
  p256dh: string;
  auth: string;
  name: string | null;
  at: string;
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

/**
 * Kirim push notification ke langganan percakapan ini.
 * Langganan kedaluwarsa (404/410) dibersihkan otomatis.
 */
export async function sendVisitorChatPush(conversationId: string, replyText: string): Promise<void> {
  if (!ensureConfigured()) return;
  let sub: PushSub | undefined;
  try {
    const file = (await readFeature("push-subs")) as { subs?: Record<string, PushSub> };
    sub = file.subs?.[conversationId];
  } catch {
    return;
  }
  if (!sub?.endpoint) return;

  const preview = replyText.length > 140 ? `${replyText.slice(0, 140)}…` : replyText;
  const payload = JSON.stringify({
    title: "Nexa Store membalas obrolanmu",
    body: preview,
    url: "/",
    tag: "nexa-chat-reply",
  });

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 24 * 60 * 60 }
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
