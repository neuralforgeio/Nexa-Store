import { NextRequest } from "next/server";
import { jsonOk, getSession } from "@/lib/api/http";
import { readAccessControl } from "@/lib/auth/access";
import { isRouteGated, normalizeGate, isStaffPath } from "@/lib/catalog/site-control";

export const dynamic = "force-dynamic";

/**
 * Public site-gate probe — lets the client enforce the Developer's lockdown /
 * maintenance on soft navigations (the server covers hard loads).
 *
 * GET /api/store-status?path=/games/valorant
 * → { lockdown: { active, applies, reason, scope }, maintenance: { … } }
 *
 * `applies` is already filtered by the caller's role bypass:
 * DEVELOPER never gated; ADMIN exempt from maintenance only.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "/";
  const { role } = getSession(req);
  const control = await readAccessControl();

  const lockdown = normalizeGate(control.lockdown);
  const maintenance = normalizeGate(control.maintenance);

  const lockdownApplies =
    role !== "DEVELOPER" && !isStaffPath(path) && isRouteGated(lockdown, path);
  const maintenanceApplies =
    role !== "DEVELOPER" &&
    role !== "ADMIN" &&
    !isStaffPath(path) &&
    isRouteGated(maintenance, path);

  return jsonOk({
    lockdown: {
      active: lockdown.active,
      applies: lockdownApplies,
      scope: lockdown.scope,
      routes: lockdown.routes,
      reason: lockdown.note ?? null,
    },
    maintenance: {
      active: maintenance.active,
      applies: maintenanceApplies,
      scope: maintenance.scope,
      routes: maintenance.routes,
      message: maintenance.note ?? null,
    },
  });
}
