import { safeEqual } from "./session";

/**
 * Bootstrap credential verification (PRD §8.2/§8.3).
 * Credentials live ONLY in server env. Never logged, never returned.
 */

export type ResolvedRole = "ADMIN" | "DEVELOPER";

function envCredententials(): Array<{ email: string; password: string; role: ResolvedRole }> {
  const out: Array<{ email: string; password: string; role: ResolvedRole }> = [];
  const adminEmail = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.AUTH_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) out.push({ email: adminEmail, password: adminPassword, role: "ADMIN" });
  const devEmail = process.env.AUTH_DEVELOPER_EMAIL?.trim().toLowerCase();
  const devPassword = process.env.AUTH_DEVELOPER_PASSWORD;
  if (devEmail && devPassword) out.push({ email: devEmail, password: devPassword, role: "DEVELOPER" });
  return out;
}

export function authConfigured(): boolean {
  return envCredententials().length > 0 && Boolean(process.env.SESSION_SECRET);
}

/**
 * Verifies email+password against env credentials.
 * Returns null on any mismatch (generic — no user enumeration).
 * Always compares against every configured account to keep timing uniform.
 */
export function verifyCredentials(email: string, password: string): ResolvedRole | null {
  const accounts = envCredententials();
  if (accounts.length === 0) return null;
  const normalized = email.trim().toLowerCase();
  let matched: ResolvedRole | null = null;
  for (const account of accounts) {
    const emailOk = safeEqual(normalized, account.email);
    const passOk = safeEqual(password, account.password);
    if (emailOk && passOk) matched = account.role;
  }
  return matched;
}
