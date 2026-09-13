import { readFeature } from "@/lib/site-features/store";
import type { ChatConversation } from "@/lib/site-features/types";

/**
 * Direct Telegram notify (v1.5.0) — jalur produksi untuk pesan chat baru.
 *
 * Di sandbox, pesan pengunjung diteruskan instan ke layanan bot lokal lewat
 * BOT_SERVICE_INTERNAL_URL (bridge) dan bot-lah yang mengirim ping Telegram
 * lengkap dengan tombol balas interaktif. Di Vercel, layanan bot itu tidak
 * ada — jadi aplikasi mengirim notifikasi sendiri langsung ke Telegram Bot
 * API. Tidak butuh polling, tidak butuh kredensial developer produksi.
 *
 * Syarat (di Vercel, cukup sekali):
 *   1. Env TELEGRAM_BOT_TOKEN (token bot yang sama dengan panel).
 *   2. Chat id pemilik — dibaca dari data store "bot-state" (terisi saat
 *      pairing bot) atau env TELEGRAM_OWNER_CHAT_ID sebagai fallback manual.
 *
 * Selalu best-effort: kegagalan kirim tidak pernah mengganggu respons API.
 */

const NOTIFY_TIMEOUT_MS = 4_000;
const PREVIEW_MAX = 180;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function resolveOwnerChatId(): Promise<number | null> {
  const manual = Number(process.env.TELEGRAM_OWNER_CHAT_ID);
  if (Number.isInteger(manual) && manual > 0) return manual;
  try {
    const raw = (await readFeature("bot-state")) as { owner?: { chatId?: unknown } } | null;
    const chatId = raw?.owner?.chatId;
    if (typeof chatId === "number" && Number.isInteger(chatId) && chatId > 0) return chatId;
  } catch {
    // store bermasalah → tidak ada notifikasi, jalur chat tetap hidup
  }
  return null;
}

/** Kirim ping "pesan baru" ke Telegram pemilik — fire-and-forget. */
export async function sendOwnerChatNotification(conversation: ChatConversation, origin: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  const chatId = await resolveOwnerChatId();
  if (!chatId) return;

  const last = conversation.messages[conversation.messages.length - 1];
  if (!last) return;
  const preview = last.text.length > PREVIEW_MAX ? `${last.text.slice(0, PREVIEW_MAX)}…` : last.text;
  const text = [
    "💬 <b>PESAN BARU DARI PENGGUNA</b>",
    "",
    `Nama: <b>${esc(conversation.name ?? "Tanpa nama")}</b>`,
    "Sumber: website",
    "",
    esc(preview),
    "",
    "Balas lewat dashboard — pesanmu tampil di widget chat pengunjung.",
  ].join("\n");

  const dashboardBase = (process.env.NEXT_PUBLIC_APP_URL?.trim() || origin).replace(/\/+$/, "");
  const dashboardUrl = `${dashboardBase}/admin/chat`;
  // Telegram hanya menerima tombol URL https:// — di origin http (uji lokal)
  // pesan tetap terkirim, hanya tanpa tombol.
  const useButton = /^https:\/\//i.test(dashboardUrl);
  const keyboard = useButton
    ? {
        inline_keyboard: [
          [
            {
              text: "💬 Balas di dashboard",
              url: dashboardUrl,
            },
          ],
        ],
      }
    : undefined;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[telegram-notify] sendMessage gagal:", res.status, (await res.text()).slice(0, 200));
    }
  } catch (e) {
    // jaringan/timeout — coba lagi di pesan berikutnya
    console.error("[telegram-notify] kirim error:", (e as Error).message);
  }
}
