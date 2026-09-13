import { NextRequest, NextResponse } from "next/server";
// Relative imports (bukan alias @bot/*): Turbopack build produksi di Vercel
// tidak me-resolve alias tsconfig yang menunjuk keluar src/ — jalur relatif
// selalu aman di dev maupun build.
import { handleUpdate } from "../../../../../mini-services/telegram-bot/src/handlers";
import {
  isPaired,
  ownerId,
  ownerChatId,
  hydrateOwner,
} from "../../../../../mini-services/telegram-bot/src/state";
import { BOT_COMMANDS } from "../../../../../mini-services/telegram-bot/src/commands";
import {
  setMyCommands,
  type TelegramUpdate,
} from "../../../../../mini-services/telegram-bot/src/telegram";
import { readFeature, updateFeature } from "@/lib/site-features/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Telegram webhook runtime (v1.4.0) — bot bisa berjalan DI VERCEL.
 *
 * Kenapa bot sebelumnya hanya hidup di panel: bot memakai long polling
 * getUpdates yang butuh proses terus-menerus, sedangkan Vercel bersifat
 * serverless (fungsi hanya bangkit saat ada HTTP request). Solusinya:
 * webhook — Telegram yang mendorong update ke endpoint ini, dan seluruh
 * alur percakapan bot (kode yang sama dengan layanan panel) dijalankan
 * di dalam fungsi ini.
 *
 * Pairing pemilik bertahan lintas cold-start: tersimpan di fitur
 * "bot-state" pada data store (write-through GitHub di produksi).
 *
 * Aktivasi (sekali):
 * 1. Vercel → Settings → Environment Variables:
 *    TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
 *    NEXA_DEV_EMAIL + NEXA_DEV_PASSWORD (kredensial developer produksi),
 *    NEXA_API_BASE (URL produksi sendiri).
 * 2. Redeploy, lalu dari bot panel jalankan /runtime → "Pindah ke Vercel".
 */

const HEADER_SECRET = "x-telegram-bot-api-secret-token";

type StoredOwner = { userId: number; chatId: number; pairedAt?: string };

function notFound(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "not-found", message: "Tidak ditemukan." } },
    { status: 404 }
  );
}

// ---------------------------------------------------------------------------
// Pairing persistence (data store "bot-state")
// ---------------------------------------------------------------------------

async function hydrateFromStore(): Promise<void> {
  try {
    const raw = (await readFeature("bot-state")) as { owner?: StoredOwner | null };
    const owner = raw?.owner;
    if (owner && typeof owner.userId === "number" && typeof owner.chatId === "number") {
      hydrateOwner(owner.userId, owner.chatId, typeof owner.pairedAt === "string" ? owner.pairedAt : undefined);
      console.log("[webhook] pairing dimuat dari data store");
    }
  } catch {
    // store error → biarkan belum pairing (user diminta kode lagi)
  }
}

async function persistOwner(userId: number): Promise<void> {
  const chatId = ownerChatId();
  if (chatId === null) return;
  await updateFeature("bot-state", "ops: pair telegram bot owner", (current) => ({
    ...(typeof current === "object" && current !== null ? current : {}),
    owner: { userId, chatId, pairedAt: new Date().toISOString() },
  }));
  console.log("[webhook] pairing tersimpan ke data store");
}

// ---------------------------------------------------------------------------
// Pemrosesan update — berurutan per instance (state percakapan aman)
// ---------------------------------------------------------------------------

async function processUpdate(update: TelegramUpdate): Promise<void> {
  const before = ownerId();
  if (!isPaired()) await hydrateFromStore();
  await handleUpdate(update);
  const after = ownerId();
  if (after !== null && after !== before) {
    await persistOwner(after).catch((e) => {
      console.error("[webhook] gagal menyimpan pairing:", (e as Error).message);
    });
  }
}

let chain: Promise<void> = Promise.resolve();

function enqueue(update: TelegramUpdate): Promise<void> {
  const run = chain.then(() => processUpdate(update)).catch((e) => {
    console.error("[webhook] error memproses update:", (e as Error).message);
  });
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ---------------------------------------------------------------------------
// Registrasi menu perintah "/" — sekali per instance (best-effort)
// ---------------------------------------------------------------------------

let commandsPromise: Promise<void> | null = null;

function ensureCommands(): void {
  if (!commandsPromise) {
    commandsPromise = setMyCommands(BOT_COMMANDS).then(
      () => {
        console.log("[webhook] menu perintah terdaftar");
      },
      (e) => {
        console.error("[webhook] setMyCommands gagal:", (e as Error).message);
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!secret) return notFound();
  if (req.headers.get(HEADER_SECRET) !== secret) return notFound();
  return NextResponse.json({
    ok: true,
    data: {
      configured: Boolean(token && secret),
      paired: isPaired(),
      runtime: "webhook",
    },
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !secret) {
    // Webhook terpasang tetapi env belum ada — 503 agar Telegram mencoba
    // ulang setelah operator melengkapi konfigurasi.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "webhook-not-configured",
          message: "TELEGRAM_BOT_TOKEN dan TELEGRAM_WEBHOOK_SECRET wajib diisi.",
        },
      },
      { status: 503 }
    );
  }
  if (req.headers.get(HEADER_SECRET) !== secret) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Kode rahasia webhook salah." } },
      { status: 401 }
    );
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad-request", message: "Body bukan JSON valid." } },
      { status: 400 }
    );
  }

  ensureCommands();
  const done = enqueue(update as TelegramUpdate);
  // Ack setelah diproses — batas 20 detik menjaga Telegram tetap sabar.
  await Promise.race([
    done,
    new Promise<void>((r) => setTimeout(r, 20_000)),
  ]);
  return NextResponse.json({ ok: true });
}
