import { readAccessControl } from "@/lib/auth/access";
import { isRouteGated, normalizeGate } from "@/lib/catalog/site-control";
import type { Role } from "@/lib/catalog/types";

/**
 * Server-side gate resolution for the storefront shell.
 *
 * Bypass rules (v1.16.0):
 * - Lockdown: DEVELOPER always passes — lockdown is the emergency red screen,
 *   and the developer needs full storefront visibility during one.
 * - Maintenance: applies to EVERYONE, developer and admin included (owner
 *   request: the gate must actually gate while being tested — staff paths
 *   like /dev and /admin are never gated, so it can always be lifted).
 *
 * Lockdown wins over maintenance when both cover a path — the red screen is
 * the more severe statement.
 */

export type SiteGateDecision =
  | { mode: "ok" }
  | { mode: "lockdown"; reason: string | null; scope: "all" | "routes" }
  | { mode: "maintenance"; message: string | null; scope: "all" | "routes" };

export async function resolveSiteGate(pathname: string, role: Role | null): Promise<SiteGateDecision> {
  const control = await readAccessControl();

  const lockdown = normalizeGate(control.lockdown);
  if (role !== "DEVELOPER" && isRouteGated(lockdown, pathname)) {
    return { mode: "lockdown", reason: lockdown.note ?? null, scope: lockdown.scope };
  }

  // Maintenance berlaku bahkan bagi developer/admin yang sedang login —
  // dulu bypass ini membuat gerbang tak terlihat saat diuji pemilik.
  const maintenance = normalizeGate(control.maintenance);
  if (isRouteGated(maintenance, pathname)) {
    return { mode: "maintenance", message: maintenance.note ?? null, scope: maintenance.scope };
  }

  return { mode: "ok" };
}
