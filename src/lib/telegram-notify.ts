import { readFeature } from "@/lib/site-features/store";
import type { ChatConversation } from "@/lib/site-features/types";
import { circuitBreaker } from "@/lib/circuit-breaker";

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
 *
 * v1.6.0: + notifikasi laporan pengguna (dengan lampiran media) dan
 *         + notifikasi pesanan baru (dengan tombol status untuk bot).
 * v1.8.0: + circuit breaker "telegram-api" — saat Telegram bermasalah,
 *         pengiriman di-skip cepat (best-effort) tanpa memperlambat
 *         request pengguna; + fallback sendDocument untuk gambar yang
 *         ditolak sendPhoto.
 */

const NOTIFY_TIMEOUT_MS = 4_000;
const PREVIEW_MAX = 180;

const telegramBreaker = circuitBreaker("telegram-api", { cooldownMs: 60_000 });

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

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** Kirim ping "pesan baru" ke Telegram pemilik — fire-and-forget. */
export async function sendOwnerChatNotification(conversation: ChatConversation, origin: string): Promise<void> {
  const token = botToken();
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
    const res = await telegramBreaker.run(() =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
      })
    );
    if (!res.ok) {
      console.error("[telegram-notify] sendMessage gagal:", res.status, (await res.text()).slice(0, 200));
    }
  } catch (e) {
    // jaringan/timeout/breaker terbuka — coba lagi di pesan berikutnya
    console.error("[telegram-notify] kirim error:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Laporan pengguna (v1.6.0)
// ---------------------------------------------------------------------------

export type ReportNotifyPayload = {
  id: string;
  type: "bug" | "feature" | "other";
  name: string | null;
  text: string;
  createdAt: string;
};

const REPORT_TYPE_LABEL: Record<ReportNotifyPayload["type"], string> = {
  bug: "🐞 Laporan Bug",
  feature: "💡 Saran Fitur",
  other: "📋 Lainnya",
};

/** Format teks laporan untuk Telegram (HTML). */
export function reportNotifyText(r: ReportNotifyPayload, timeWib: string): string {
  const preview = r.text.length > 1200 ? `${r.text.slice(0, 1200)}…` : r.text;
  return [
    `<b>${REPORT_TYPE_LABEL[r.type].toUpperCase()}</b>`,
    "",
    `ID: <code>${esc(r.id)}</code>`,
    `Waktu: <b>${esc(timeWib)}</b> (WIB)`,
    `Nama: <b>${esc(r.name ?? "Tanpa nama")}</b>`,
    "",
    esc(preview),
  ].join("\n");
}

/**
 * Kirim laporan pengguna ke Telegram pemilik. Lampiran media (opsional)
 * di-upload multipart — sendPhoto untuk gambar, sendVideo untuk video,
 * fallback sendDocument.
 */
export async function sendOwnerReportNotification(
  report: ReportNotifyPayload,
  timeWib: string,
  media?: { blob: Blob; kind: "image" | "video"; fileName: string } | null
): Promise<void> {
  const token = botToken();
  if (!token) return;
  const chatId = await resolveOwnerChatId();
  if (!chatId) return;

  const caption = reportNotifyText(report, timeWib).slice(0, 1024);

  const attempt = async (method: string, build: () => Promise<FormData>) => {
    const fd = await build();
    return telegramBreaker.run(() =>
      fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(20_000),
      })
    );
  };

  try {
    if (media) {
      const buf = new Uint8Array(await media.blob.arrayBuffer());
      const isVideo = media.kind === "video";
      const method = isVideo ? "sendVideo" : "sendPhoto";
      const field = isVideo ? "video" : "photo";

      const build = (uploadField: string) => {
        const fd = new FormData();
        fd.append("chat_id", String(chatId));
        fd.append("caption", caption);
        fd.append("parse_mode", "HTML");
        fd.append(uploadField, new Blob([buf], { type: media.blob.type }), media.fileName);
        return Promise.resolve(fd);
      };

      let res = await attempt(method, () => build(field));
      // Media ditolak (video terlalu besar / format gambar tidak didukung)
      // → kirim sebagai dokumen agar laporan tetap sampai lengkap.
      if (!res.ok) {
        console.warn(`[telegram-notify] ${method} gagal (${res.status}) — fallback sendDocument.`);
        res = await attempt("sendDocument", () => build("document"));
      }
      if (!res.ok) {
        console.error(`[telegram-notify] ${method} gagal:`, res.status, (await res.text()).slice(0, 200));
      }
      return;
    }

    // Tanpa media — teks saja.
    const res = await telegramBreaker.run(() =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: reportNotifyText(report, timeWib),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      })
    );
    if (!res.ok) {
      console.error("[telegram-notify] report sendMessage gagal:", res.status);
    }
  } catch (e) {
    console.error("[telegram-notify] laporan kirim error:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Error UI otomatis (v1.8.0) — SectionBoundary melaporkan bagian halaman
// yang gagal render; diisolasi di perbatasannya, dilaporkan ke pemilik.
// ---------------------------------------------------------------------------

export type ErrorNotifyPayload = {
  section: string;
  message: string;
  stack?: string;
  path?: string;
  userAgent?: string | null;
  at: string;
};

export async function sendOwnerErrorNotification(e: ErrorNotifyPayload): Promise<void> {
  const token = botToken();
  if (!token) return;
  const chatId = await resolveOwnerChatId();
  if (!chatId) return;

  const stackLines = (e.stack ?? "")
    .split("\n")
    .slice(0, 6)
    .map((l) => `  ${esc(l.trim().slice(0, 110))}`)
    .join("\n");
  const text = [
    "🧯 <b>ERROR UI TERTANGKAP CIRCUIT BREAKER</b>",
    "",
    `Bagian: <b>${esc(e.section)}</b>`,
    `Halaman: <code>${esc(e.path ?? "—")}</code>`,
    `Waktu: <b>${esc(new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(e.at)))}</b> (WIB)`,
    "",
    `Pesan: <code>${esc(e.message.slice(0, 280))}</code>`,
    stackLines ? `\n<pre>${stackLines}</pre>` : "",
    "",
    "Bagian halaman lain tetap berjalan — pengunjung masih bisa memakai situs.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3800);

  try {
    const res = await telegramBreaker.run(() =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      })
    );
    if (!res.ok) {
      console.error("[telegram-notify] section-error sendMessage gagal:", res.status);
    }
  } catch (err) {
    console.error("[telegram-notify] section-error kirim error:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Pesanan baru (v1.6.0) — tombol status ditangani runtime bot
// (webhook Vercel / panel) lewat callback_data `ord:<id>:<status>`.
// ---------------------------------------------------------------------------

export type OrderNotifyPayload = {
  id: string;
  source: "instant" | "cart";
  summary: string;
  customerName: string | null;
  items: Array<{ gameName: string; productName: string; price: number }>;
  total: number;
  createdAt: string;
};

export function orderNotifyText(o: OrderNotifyPayload, timeWib: string): string {
  const lines = o.items
    .slice(0, 10)
    .map((it) => `• ${esc(it.productName)} — ${esc(it.gameName)}: Rp${it.price.toLocaleString("id-ID")}`);
  return [
    "🧾 <b>PESANAN BARU</b>",
    "",
    `ID Order: <code>${esc(o.id)}</code>`,
    `Waktu: <b>${esc(timeWib)}</b> (WIB)`,
    `Pembeli: <b>${esc(o.customerName ?? "—")}</b>`,
    `Sumber: ${o.source === "cart" ? "Keranjang" : "Pesan instan"}`,
    "",
    ...lines,
    "",
    `Total: <b>Rp${o.total.toLocaleString("id-ID")}</b>`,
  ].join("\n");
}

const ORDER_STATUS_BUTTONS: Array<{ label: string; status: string }> = [
  { label: "⏳ Pending", status: "pending" },
  { label: "🔄 Proses", status: "processing" },
  { label: "✅ Sukses", status: "success" },
  { label: "❌ Batal", status: "cancel" },
];

export async function sendOwnerOrderNotification(o: OrderNotifyPayload, timeWib: string): Promise<void> {
  const token = botToken();
  if (!token) return;
  const chatId = await resolveOwnerChatId();
  if (!chatId) return;

  try {
    const res = await telegramBreaker.run(() =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: orderNotifyText(o, timeWib),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              ORDER_STATUS_BUTTONS.map((b) => ({
                text: b.label,
                callback_data: `ord:${o.id}:${b.status}`,
              })),
              [{ text: "🔍 Detail / ubah status", callback_data: `ord:${o.id}` }],
            ],
          },
        }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      })
    );
    if (!res.ok) {
      console.error("[telegram-notify] order sendMessage gagal:", res.status);
    }
  } catch (e) {
    console.error("[telegram-notify] order kirim error:", (e as Error).message);
  }
}
