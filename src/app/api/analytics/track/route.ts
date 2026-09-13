import { NextRequest } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { jsonError, jsonOk, clientIp } from "@/lib/api/http";
import { trackEvent } from "@/lib/site-features/analytics";

export const dynamic = "force-dynamic";

/**
 * Public analytics beacon (v1.3.0). Fire-and-forget page/event tracking with
 * per-IP sliding-window limits. Visitor identity is a client-generated random
 * token — only a salted hash reaches persistence (no fingerprint, no PII).
 */

const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 80;
const buckets = new Map<string, number[]>();

function allowed(key: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  buckets.set(key, hits);
  return hits.length < MAX_PER_WINDOW;
}

function hit(key: string): void {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
}

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["view", "chat_open", "order_click", "wa_handoff", "report_submit", "order_track"]),
        path: z.string().min(1).max(120),
        referrer: z.string().max(300).optional(),
        device: z.enum(["mobile", "desktop"]).optional(),
      })
    )
    .max(10),
  visitor: z.string().min(8).max(64),
});

const SALT = "nexa-analytics-v1";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!allowed(`t:${ip}`)) return jsonError(429, "rate-limited", "Terlalu banyak peristiwa. Coba lagi nanti.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", "Data peristiwa tidak valid.");

  hit(`t:${ip}`);
  const tokenHash = createHash("sha256").update(`${SALT}:${parsed.data.visitor}`).digest("hex").slice(0, 24);
  for (const e of parsed.data.events) {
    trackEvent({ ...e, tokenHash });
  }
  return jsonOk({ recorded: parsed.data.events.length });
}
