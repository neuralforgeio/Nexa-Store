import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import type { Role } from "@/lib/catalog/types";
import { assertCapability, type Capability } from "@/lib/auth/permissions";
import { isAdminBlocked } from "@/lib/auth/access";

/** Reads + verifies the session from the request cookie (server-side only). */
export function getSession(req: NextRequest): {
  role: Role | null;
  email: string | null;
} {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = verifySessionToken(token);
  if (result.ok) return { role: result.role, email: result.email };
  return { role: null, email: null };
}

/**
 * Route guard: returns a 401/403 response, or null when allowed.
 * A blocked Admin is rejected on every protected surface, so an existing
 * session loses its write access immediately after the Developer blocks it.
 */
export async function requireCapability(
  req: NextRequest,
  capability: Capability
): Promise<NextResponse | null> {
  const { role } = getSession(req);
  const check = assertCapability(role, capability);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: { code: check.status === 401 ? "unauthorized" : "forbidden", message: check.message } },
      { status: check.status }
    );
  }
  if (role === "ADMIN" && (await isAdminBlocked())) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "admin-blocked",
          message: "Akses admin sedang diblokir oleh Developer.",
        },
      },
      { status: 403 }
    );
  }
  return null;
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, ...extra } }, { status: status });
}

// ---------------------------------------------------------------------------
// Mutation rate limit (v1.12.0 hardening): authenticated saves are capped per
// session so a hijacked session cannot hammer the persistence layer (GitHub
// API quota / repo churn). Generous enough for real admin work — the whole
// catalog rebuild fits inside one window.
// ---------------------------------------------------------------------------

const MUTATION_WINDOW_MS = 5 * 60 * 1000;
const MUTATION_MAX = 40;

const mutationHits = new Map<string, number[]>();
let mutationSweepAt = 0;

function sweepMutations(now: number): void {
  if (now - mutationSweepAt < 60_000) return;
  mutationSweepAt = now;
  for (const [key, hits] of mutationHits) {
    const live = hits.filter((t) => now - t < MUTATION_WINDOW_MS);
    if (live.length === 0) mutationHits.delete(key);
    else mutationHits.set(key, live);
  }
}

/**
 * Per-session mutation guard. Returns a 429 response when the session is
 * over the budget, or null when the mutation may proceed.
 */
export function enforceMutationRateLimit(email: string): NextResponse | null {
  const now = Date.now();
  sweepMutations(now);
  const key = `mut:${email}`;
  const hits = (mutationHits.get(key) ?? []).filter((t) => now - t < MUTATION_WINDOW_MS);
  if (hits.length >= MUTATION_MAX) {
    const oldest = Math.min(...hits);
    const retryAfterSeconds = Math.max(Math.ceil((oldest + MUTATION_WINDOW_MS - now) / 1000), 1);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "rate-limited",
          message: `Terlalu banyak penyimpanan beruntun. Tunggu ${retryAfterSeconds} detik lalu coba lagi.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }
  mutationHits.set(key, [...hits, now]);
  return null;
}
