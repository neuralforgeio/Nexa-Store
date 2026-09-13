import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Launcher layanan bot Telegram (khusus lingkungan development panel).
 *
 * Mengapa ada: proses yang lahir dari sesi shell panel selalu dibersihkan saat
 * sesi berakhir — hanya pohon proses dev server yang bertahan. Route ini
 * menjalankan bot dari DALAM server sehingga prosesnya tetap hidup, dan bisa
 * dipakai ulang kapan pun untuk memulihkan bot yang mati.
 *
 * Keamanan: hanya aktif bila BOT_SERVICE_LAUNCH=1 (hanya di .env sandbox —
 * tidak pernah ada di Vercel). Tanpa env itu, route ini 404 generik dan tidak
 * membocorkan keberadaan bot ke siapa pun, termasuk Admin.
 */

const BOT_DIR = path.join(process.cwd(), "mini-services", "telegram-bot");
const BOT_PORT = 3005;

function launchEnabled(): boolean {
  return process.env.BOT_SERVICE_LAUNCH === "1";
}

function notFound(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "not-found", message: "Tidak ditemukan." } },
    { status: 404 }
  );
}

async function botHealth(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${BOT_PORT}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!launchEnabled()) return notFound();
  const health = await botHealth();
  return NextResponse.json({
    ok: true,
    data: { service: "telegram-bot", running: health !== null, health },
  });
}

export async function POST() {
  if (!launchEnabled()) return notFound();

  const running = await botHealth();
  if (running) {
    return NextResponse.json({
      ok: true,
      data: { service: "telegram-bot", running: true, health: running, note: "sudah berjalan" },
    });
  }
  if (!existsSync(path.join(BOT_DIR, "package.json"))) {
    return NextResponse.json(
      { ok: false, error: { code: "bot-missing", message: "Folder layanan bot tidak ditemukan." } },
      { status: 500 }
    );
  }

  try {
    // fd langsung (bukan WriteStream) — aman dipakai sebagai stdio di spawn.
    const logFd = openSync(path.join(BOT_DIR, "bot.log"), "a");
    const child = spawn("bun", ["run", "dev"], {
      cwd: BOT_DIR,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    child.once("spawn", () => {
      try {
        closeSync(logFd);
      } catch {
        // abaikan — fd sudah diduplikasi oleh anak
      }
    });
    child.unref();
    child.on("error", () => undefined);
    // Beri waktu boot, lalu laporkan hasilnya.
    await new Promise((r) => setTimeout(r, 4000));
    const health = await botHealth();
    return NextResponse.json({
      ok: true,
      data: {
        service: "telegram-bot",
        running: health !== null,
        pid: child.pid,
        health,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "launch-failed",
          message: "Gagal menjalankan layanan bot.",
          detail: (e as Error).message?.slice(0, 200) ?? null,
          execPath: process.execPath,
        },
      },
      { status: 500 }
    );
  }
}
