import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/http";
import { clientIp } from "@/lib/api/http";
import { verifyCredentials, authConfigured } from "@/lib/auth/credentials";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";
import { checkRateLimit, recordAttempt } from "@/lib/auth/rate-limit";
import { readAccessControl, isAdminBlocked } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  if (!authConfigured()) {
    return jsonError(503, "auth.not-configured", "Autentikasi belum dikonfigurasi di server ini.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "bad-request", "Email dan password wajib diisi.");
  }

  const ip = clientIp(req);
  const key = `${ip}:${parsed.data.email.toLowerCase()}`;
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "rate-limited",
          message: `Terlalu banyak percobaan masuk. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const role = verifyCredentials(parsed.data.email, parsed.data.password);
  if (!role) {
    recordAttempt(key);
    // Generic message. No user enumeration (PRD §8.3).
    return jsonError(401, "invalid-credentials", "Email atau password salah.");
  }

  // A blocked Admin cannot log back in (D8). Revealed only after the
  // credentials verify, so it leaks nothing about account existence.
  if (role === "ADMIN" && (await isAdminBlocked())) {
    const control = await readAccessControl();
    return jsonError(403, "admin-blocked", "Akses admin sedang diblokir oleh Developer.", {
      blocked: true,
      reason: control.reason ?? null,
      updatedBy: control.updatedBy ?? null,
    });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const token = createSessionToken(email, role);
  const response = NextResponse.json({
    ok: true,
    data: { role, email },
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
