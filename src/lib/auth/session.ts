import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { Role } from "@/lib/catalog/types";

/**
 * Stateless HMAC-SHA256 signed session cookie (A8/D3).
 * Payload: base64url(JSON).sig — serverless-friendly, no session store needed.
 * Upgrade path to a real IdP: swap this module + credentials.ts only.
 */

export const SESSION_COOKIE = "nexa_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

type SessionPayload = {
  sub: string; // email
  role: Extract<Role, "ADMIN" | "DEVELOPER">;
  iat: number;
  exp: number;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET tidak dikonfigurasi (min 32 karakter)");
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(email: string, role: "ADMIN" | "DEVELOPER"): string {
  const now = Date.now();
  const payload: SessionPayload = {
    sub: email,
    role,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; email: string; role: "ADMIN" | "DEVELOPER"; exp: number }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifySessionToken(token: string | undefined | null): VerifyResult {
  if (!token) return { ok: false, reason: "malformed" };
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = Buffer.from(sign(body));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "bad-signature" };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (payload.role !== "ADMIN" && payload.role !== "DEVELOPER") {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, email: payload.sub, role: payload.role, exp: payload.exp };
}

/** Digest-based timing-safe string compare (no early-exit leakage). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}
