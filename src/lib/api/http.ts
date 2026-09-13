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
  return NextResponse.json({ ok: false, error: { code, message, ...extra } }, { status });
}
