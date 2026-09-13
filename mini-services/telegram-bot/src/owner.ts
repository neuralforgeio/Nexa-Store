/**
 * Notifikasi ke pemilik via Telegram — best-effort, tidak pernah melempar.
 */
import * as tg from "./telegram";
import { ownerChatId } from "./state";

export function notifyOwner(text: string, keyboard?: tg.InlineKeyboard): Promise<void> {
  const chat = ownerChatId();
  if (!chat) return Promise.resolve();
  return tg
    .sendMessage(chat, text, keyboard)
    .then(() => undefined)
    .catch(() => undefined);
}
