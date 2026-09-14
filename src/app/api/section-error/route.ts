import { NextRequest, after } from "next/server";
import { z } from "zod";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { sendOwnerErrorNotification } from "@/lib/telegram-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Laporan error UI otomatis (v1.8.0) — dipanggil SectionBoundary ketika
 * sebuah bagian halaman gagal render. Best-effort: hanya meneruskan ke
 * Telegram pemilik (tidak menulis data store), rate-limit ketat agar tidak
 * jadi kanal spam.
 */

const bodySchema = z.object({
  section: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(300),
  stack: z.string().trim().max(900).optional(),
  path: z.string().trim().max(200).optional(),
});

// Rate limit: 6 laporan / 10 menit / IP + 6 laporan / 10 menit global.
const WINDOW_MS = 10 * 60_000;
const perIp = new Map<string, number[]>();
const globalHits: number[] = [];

function allowed(ip: string): boolean {
  const now = Date.now();
  const hits = (perIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= 6) return false;
  const global = globalHits.filter((t) => now - t < WINDOW_MS);
  if (global.length >= 6) return false;
  hits.push(now);
  globalHits.push(now);
  while (globalHits.length > 64) globalHits.shift();
  perIp.set(ip, hits);
  return true;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Payload tidak valid.");
  }
  if (!allowed(clientIp(req))) {
    return jsonOk({ ok: true, throttled: true });
  }

  const { section, message, stack, path } = parsed.data;
  after(() =>
    sendOwnerErrorNotification({
      section,
      message,
      stack,
      path,
      userAgent: req.headers.get("user-agent")?.slice(0, 120) ?? null,
      at: new Date().toISOString(),
    })
  );

  return jsonOk({ ok: true });
}
