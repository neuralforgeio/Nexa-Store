import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NexaApp } from "@/components/store/nexa-app";
import { resolveSiteGate } from "@/lib/auth/site-control";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Nexa Store — single user-visible route (sandbox platform constraint, A1).
 * All views are client-side routes rendered by this shell; server-side logic
 * lives in /api route handlers.
 *
 * Before rendering, the Developer's site gates are enforced server-side:
 * a locked-down path redirects to /lockdown, a maintenance-covered path to
 * /maintenance — the storefront content never flashes (middleware passes the
 * original pathname down even through rewrites).
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);

  const pathname = headerList.get("x-pathname") ?? "/";
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  const role = session.ok ? session.role : null;

  const gate = await resolveSiteGate(pathname, role);
  if (gate.mode === "lockdown") redirect("/lockdown");
  if (gate.mode === "maintenance") redirect("/maintenance");

  return <NexaApp />;
}
