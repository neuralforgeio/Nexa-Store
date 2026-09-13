import { readAccessControl } from "@/lib/auth/access";
import { isRouteGated, normalizeGate } from "@/lib/catalog/site-control";
import type { Role } from "@/lib/catalog/types";

/**
 * Server-side gate resolution for the storefront shell.
 *
 * Bypass rules:
 * - DEVELOPER always passes (they need to reach the panel to lift the gate).
 * - ADMIN passes maintenance (they may be the one performing it), but is
 *   subject to lockdown like everyone else.
 *
 * Lockdown wins over maintenance when both cover a path — the red screen is
 * the more severe statement.
 */

export type SiteGateDecision =
  | { mode: "ok" }
  | { mode: "lockdown"; reason: string | null; scope: "all" | "routes" }
  | { mode: "maintenance"; message: string | null; scope: "all" | "routes" };

export async function resolveSiteGate(pathname: string, role: Role | null): Promise<SiteGateDecision> {
  if (role === "DEVELOPER") return { mode: "ok" };

  const control = await readAccessControl();
  const lockdown = normalizeGate(control.lockdown);
  if (isRouteGated(lockdown, pathname)) {
    return { mode: "lockdown", reason: lockdown.note ?? null, scope: lockdown.scope };
  }

  const maintenance = normalizeGate(control.maintenance);
  if (role !== "ADMIN" && isRouteGated(maintenance, pathname)) {
    return { mode: "maintenance", message: maintenance.note ?? null, scope: maintenance.scope };
  }

  return { mode: "ok" };
}
