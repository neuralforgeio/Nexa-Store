/**
 * Daftar perintah bot (v1.6.0) — didaftarkan lewat setMyCommands sehingga
 * mengetik "/" di chat langsung memunculkan menu autocomplete lengkap.
 *
 * Setiap perintah dipetakan ke menu yang sama dengan tombol — lihat
 * COMMAND_TO_ROOT di handlers.ts.
 */
import type { BotCommand } from "./telegram";

export const BOT_COMMANDS: BotCommand[] = [
  { command: "menu", description: "Menu kendali utama" },
  { command: "status", description: "Status situs sekarang" },
  { command: "lockdown", description: "Kunci situs — total atau rute" },
  { command: "maintenance", description: "Mode perbaikan situs" },
  { command: "promo", description: "Event diskon storefront" },
  { command: "banner", description: "Banner pengumuman" },
  { command: "chat", description: "Obrolan pelanggan" },
  { command: "lacak_order", description: "Lacak & ubah status pesanan" },
  { command: "tasks", description: "Tugas terjadwal" },
  { command: "analytics", description: "Statistik pengunjung" },
  { command: "admin", description: "Blokir / buka blokir admin" },
  { command: "catalog", description: "Game, produk, kategori" },
  { command: "deploy", description: "Deploy & rollback Vercel" },
  { command: "settings", description: "WhatsApp & announcement" },
  { command: "runtime", description: "Pindah bot: panel ⇄ Vercel" },
  { command: "cancel", description: "Batalkan alur berjalan" },
  { command: "help", description: "Cara pakai bot" },
];

/** Perintah → callback root yang setara (dipakai router perintah). */
export const COMMAND_TO_ROOT: Record<string, string> = {
  "/lockdown": "lk",
  "/maintenance": "mt",
  "/admin": "adm",
  "/catalog": "cat",
  "/settings": "set",
  "/deploy": "dep",
  "/chat": "cht",
  "/lacak_order": "ord",
  "/promo": "prm",
  "/banner": "bnr",
  "/analytics": "stx",
  "/tasks": "tsk",
  "/runtime": "rt",
};
