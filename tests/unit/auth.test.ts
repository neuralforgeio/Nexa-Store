import { test, expect, beforeAll } from "bun:test";
import {
  createSessionToken,
  verifySessionToken,
  safeEqual,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { verifyCredentials } from "@/lib/auth/credentials";
import { can, assertCapability } from "@/lib/auth/permissions";
import { checkRateLimit, recordAttempt, resetRateLimiter } from "@/lib/auth/rate-limit";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-value-0123456789abcdef0123456789abcdef";
  process.env.AUTH_ADMIN_EMAIL = "admin@adminnexa.id";
  process.env.AUTH_ADMIN_PASSWORD = "adminnexa20";
  process.env.AUTH_DEVELOPER_EMAIL = "dev@example.com";
  process.env.AUTH_DEVELOPER_PASSWORD = "devpass123";
});

test("session token round-trips (PRD §8.3)", () => {
  const token = createSessionToken("admin@adminnexa.id", "ADMIN");
  const result = verifySessionToken(token);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.role).toBe("ADMIN");
    expect(result.email).toBe("admin@adminnexa.id");
  }
});

test("tampered token is rejected", () => {
  const token = createSessionToken("a@b.c", "DEVELOPER");
  const parts = token.split(".");
  parts[0] = parts[0].slice(0, -2) + (parts[0].endsWith("x") ? "y" : "x");
  const tampered = parts.join(".");
  expect(verifySessionToken(tampered).ok).toBe(false);
});

test("token signed with a different secret is rejected", () => {
  const token = createSessionToken("a@b.c", "ADMIN");
  process.env.SESSION_SECRET = "another-secret-9876543210abcdef0123456789abcdef";
  expect(verifySessionToken(token).ok).toBe(false);
  process.env.SESSION_SECRET = "test-secret-value-0123456789abcdef0123456789abcdef";
});

test("malformed tokens are rejected without throwing", () => {
  expect(verifySessionToken(undefined).ok).toBe(false);
  expect(verifySessionToken("").ok).toBe(false);
  expect(verifySessionToken("garbage").ok).toBe(false);
  expect(verifySessionToken("a.b.c.d.e").ok).toBe(false);
});

test("safeEqual does not leak on length differences", () => {
  expect(safeEqual("abc", "abc")).toBe(true);
  expect(safeEqual("abc", "abd")).toBe(false);
  expect(safeEqual("abc", "abcd")).toBe(false);
});

test("credentials verify against env with exact roles (PRD §8.2)", () => {
  expect(verifyCredentials("admin@adminnexa.id", "adminnexa20")).toBe("ADMIN");
  expect(verifyCredentials("dev@example.com", "devpass123")).toBe("DEVELOPER");
  expect(verifyCredentials("admin@adminnexa.id", "wrong")).toBeNull();
  expect(verifyCredentials("nobody@example.com", "adminnexa20")).toBeNull();
  // Case-insensitive email.
  expect(verifyCredentials("ADMIN@ADMINNEXA.ID", "adminnexa20")).toBe("ADMIN");
});

test("permission matrix: developer capabilities are not granted to admin (PRD §7.2)", () => {
  expect(can("CUSTOMER", "storefront.view")).toBe(true);
  expect(can("CUSTOMER", "products.manage")).toBe(false);

  expect(can("ADMIN", "products.manage")).toBe(true);
  expect(can("ADMIN", "settings.manage")).toBe(true);
  expect(can("ADMIN", "gitSync.viewLimited")).toBe(true);

  expect(can("DEVELOPER", "products.manage")).toBe(true);
  expect(can("DEVELOPER", "data.inspect")).toBe(true);
  expect(can("DEVELOPER", "data.importExport")).toBe(true);
  expect(can("DEVELOPER", "rollback.inspect")).toBe(true);

  // Admin may NOT touch developer-only surfaces.
  expect(can("ADMIN", "data.inspect")).toBe(false);
  expect(can("ADMIN", "diagnostics.repository")).toBe(false);
  expect(can("ADMIN", "rollback.inspect")).toBe(false);
});

test("assertCapability returns 401 for anonymous, 403 for wrong role", () => {
  expect(assertCapability(null, "products.manage")).toEqual({
    ok: false,
    status: 401,
    message: "Masuk terlebih dahulu.",
  });
  const adminDevSurface = assertCapability("ADMIN", "data.inspect");
  expect(adminDevSurface.ok).toBe(false);
  if (!adminDevSurface.ok) expect(adminDevSurface.status).toBe(403);
  expect(assertCapability("DEVELOPER", "data.inspect").ok).toBe(true);
});

test("rate limiter blocks after 5 attempts in the window (PRD §8.3)", () => {
  resetRateLimiter();
  const key = "test:rl@example.com";
  for (let i = 0; i < 5; i++) {
    const result = checkRateLimit(key);
    expect(result.allowed).toBe(true);
    recordAttempt(key);
  }
  const blocked = checkRateLimit(key);
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

  // Different key unaffected.
  expect(checkRateLimit("test:other@example.com").allowed).toBe(true);
});

test("rate limit recovers after the window passes", () => {
  resetRateLimiter();
  const key = "test:expire@example.com";
  const past = Date.now() - 11 * 60 * 1000;
  for (let i = 0; i < 5; i++) recordAttempt(key, past);
  expect(checkRateLimit(key, Date.now()).allowed).toBe(true);
});

test("session cookie name is stable", () => {
  expect(SESSION_COOKIE).toBe("nexa_session");
});
