/**
 * Nexa Store Telegram Bot — konfigurasi.
 * Nilai dibaca dari environment (Bun memuat .env dari cwd secara otomatis),
 * dengan fallback parser manual agar aman dijalankan dari direktori mana pun.
 */

function loadDotEnvFile(path: string): void {
  // Best-effort: abaikan error (file bisa absen saat dijalankan dari luar).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(path)) return;
    const raw = fs.readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch {
    // diam — env sudah mungkin dimuat oleh runtime
  }
}

loadDotEnvFile(new URL("../.env", import.meta.url).pathname);
loadDotEnvFile(`${process.cwd()}/.env`);

function env(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

export const config = {
  telegramToken: env("TELEGRAM_BOT_TOKEN"),
  pairingCode: env("PAIRING_CODE"),
  apiBase: env("NEXA_API_BASE", "https://nexastoregame.vercel.app").replace(/\/+$/, ""),
  localBase: env("NEXA_LOCAL_BASE", "http://127.0.0.1:3000").replace(/\/+$/, ""),
  internalSecret: env("BOT_INTERNAL_SECRET"),
  devEmail: env("NEXA_DEV_EMAIL"),
  devPassword: env("NEXA_DEV_PASSWORD"),
  vercelToken: env("VERCEL_TOKEN"),
  vercelTeam: env("VERCEL_TEAM"),
  vercelProject: env("VERCEL_PROJECT", "nexastoregame"),
  vercelOrgId: env("VERCEL_ORG_ID"),
  vercelRepoId: env("VERCEL_REPO_ID"),
  githubToken: env("GITHUB_TOKEN"),
  githubRepo: env("GITHUB_REPO", "neuralforgeio/Nexa-Store"),
  githubBranch: env("GITHUB_BRANCH", "main"),
  repoDir: env("REPO_DIR", "/home/z/my-project"),
  port: 3005,
  /** Tanpa server HTTP/WS — proses jadi orphan biasa yang lolos pembersihan sesi. */
  headless: env("BOT_HEADLESS") === "1",
} as const;

/** Rute publik yang bisa dikunci — cermin LOCKABLE_ROUTES di aplikasi utama. */
export const LOCKABLE_ROUTES: Array<{ id: string; label: string; code: string }> = [
  { id: "/", label: "Beranda", code: "h" },
  { id: "/games", label: "Katalog game", code: "g" },
  { id: "/games/*", label: "Detail game", code: "gd" },
  { id: "/help", label: "Bantuan", code: "hp" },
];

export function routeIdFromCode(code: string): string | null {
  return LOCKABLE_ROUTES.find((r) => r.code === code)?.id ?? null;
}

export function assertConfigured(): void {
  const missing: string[] = [];
  if (!config.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.devEmail || !config.devPassword) missing.push("NEXA_DEV_EMAIL/NEXA_DEV_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`Konfigurasi belum lengkap: ${missing.join(", ")}`);
  }
}
