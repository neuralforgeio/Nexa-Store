import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
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

/** PID file ditulis proses bot saat boot — sinyal kedua (mode headless). */
function botPid(): number | null {
  try {
    const raw = readFileSync(path.join(BOT_DIR, ".bot.pid"), "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = proses ada tapi bukan milik kita — tetap anggap hidup (konservatif).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Hidup bila health menjawab ATAU PID proses bot masih bernyawa. */
async function botRunning(): Promise<{ running: boolean; health: Record<string, unknown> | null; pid: number | null }> {
  const health = await botHealth();
  if (health) return { running: true, health, pid: null };
  const pid = botPid();
  if (pid && pidAlive(pid)) return { running: true, health: null, pid };
  return { running: false, health: null, pid };
}

export async function GET() {
  if (!launchEnabled()) return notFound();
  const { running, health, pid } = await botRunning();
  return NextResponse.json({
    ok: true,
    data: { service: "telegram-bot", running, health, pid },
  });
}

export async function POST() {
  if (!launchEnabled()) return notFound();

  const state = await botRunning();
  if (state.running) {
    return NextResponse.json({
      ok: true,
      data: {
        service: "telegram-bot",
        running: true,
        health: state.health,
        pid: state.pid,
        note: "sudah berjalan",
      },
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
    // Beri waktu boot, lalu laporkan hasilnya (health ATAU pid file).
    await new Promise((r) => setTimeout(r, 4000));
    const after = await botRunning();
    return NextResponse.json({
      ok: true,
      data: {
        service: "telegram-bot",
        running: after.running,
        pid: child.pid,
        health: after.health,
        detectedPid: after.pid,
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
