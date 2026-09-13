/**
 * Pembungkus Telegram Bot API (HTTP murni, tanpa dependensi).
 * Semua pesan memakai parse_mode HTML — teks dari user WAJIB lewat esc().
 */
import { config } from "./config";

const API_BASE = `https://api.telegram.org/bot${config.telegramToken}`;

export class TelegramError extends Error {
  constructor(
    public readonly description: string,
    public readonly code: number
  ) {
    super(`Telegram ${code}: ${description}`);
    this.name = "TelegramError";
  }
}

async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };
  if (!json.ok) {
    throw new TelegramError(json.description ?? "kesalahan tak diketahui", json.error_code ?? 0);
  }
  return json.result as T;
}

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = InlineButton[][];

export type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage & { from?: { id: number; first_name?: string; username?: string } };
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    message?: TelegramMessage;
    data?: string;
  };
};

/** Escape teks untuk parse_mode HTML. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function getMe(): Promise<{ id: number; username: string; first_name: string }> {
  return call("getMe", {});
}

export type BotCommand = { command: string; description: string };

/**
 * Daftarkan menu perintah — saat pengguna mengetik "/" di chat, Telegram
 * menampilkan seluruh pilihan lengkap dengan deskripsinya (autocomplete).
 */
export async function setMyCommands(commands: BotCommand[]): Promise<boolean> {
  return call("setMyCommands", { commands });
}

export type WebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
};

export async function getWebhookInfo(): Promise<WebhookInfo> {
  return call("getWebhookInfo", {});
}

/** Set webhook — bot berpindah ke runtime serverless (Vercel). */
export async function setWebhook(url: string, secret: string): Promise<boolean> {
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

/** Hapus webhook — bot kembali ke polling panel. */
export async function deleteWebhook(): Promise<boolean> {
  return call("deleteWebhook", { drop_pending_updates: false });
}

export async function getUpdates(offset: number, timeoutSec = 25): Promise<TelegramUpdate[]> {
  return call("getUpdates", {
    offset,
    timeout: timeoutSec,
    allowed_updates: ["message", "callback_query"],
  });
}

export async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard
): Promise<{ message_id: number }> {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard
): Promise<boolean> {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
    return true;
  } catch (e) {
    // "message is not modified" & sejenisnya tidak fatal untuk UX.
    if (e instanceof TelegramError && /not modified/i.test(e.description)) return true;
    throw e;
  }
}

export async function answerCallbackQuery(id: string, text?: string): Promise<void> {
  try {
    await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  } catch (e) {
    if (e instanceof TelegramError && /query is too old/i.test(e.description)) return;
    throw e;
  }
}

export type TelegramFile = { file_id: string; file_size?: number; file_path?: string };

export async function getFile(fileId: string): Promise<TelegramFile> {
  return call("getFile", { file_id: fileId });
}

/** Unduh isi berkas dari Telegram → Buffer. */
export async function downloadFile(filePath: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/file/${filePath}`);
  if (!res.ok) {
    throw new TelegramError(`gagal mengunduh berkas (${res.status})`, res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}
