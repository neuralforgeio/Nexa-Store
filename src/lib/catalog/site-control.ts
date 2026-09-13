import type { SiteGateState } from "@/lib/catalog/types";

/**
 * Developer site-control: lockdown + maintenance gates.
 *
 * Shared between server (enforcement) and client (dashboard UI), so it must
 * stay free of node/next imports.
 *
 * Gateable routes are the public storefront only. Staff surfaces (/login,
 * /admin, /dev) are never gated — otherwise nobody could lift a lockdown.
 */

export type LockableRoute = {
  id: string;
  label: string;
  description: string;
};

export const LOCKABLE_ROUTES: LockableRoute[] = [
  {
    id: "/",
    label: "Beranda",
    description: "Halaman utama store",
  },
  {
    id: "/games",
    label: "Katalog game",
    description: "Daftar semua game",
  },
  {
    id: "/games/*",
    label: "Halaman detail game",
    description: "Semua halaman /games/…",
  },
  {
    id: "/help",
    label: "Bantuan",
    description: "Pusat bantuan dan FAQ",
  },
  {
    id: "/track",
    label: "Lacak Pesanan",
    description: "Cek status pesanan lewat ID Order",
  },
  {
    id: "/reports",
    label: "Laporan",
    description: "Laporan bug, saran fitur, dan lainnya",
  },
];

/** Paths that must never be redirected to a gate screen. */
export function isStaffPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/dev" ||
    pathname === "/developer" ||
    pathname.startsWith("/dev/") ||
    pathname.startsWith("/developer/") ||
    pathname === "/lockdown" ||
    pathname === "/maintenance"
  );
}

export function routeMatchesLockable(pathname: string, routeId: string): boolean {
  if (routeId === "/games/*") {
    return pathname.startsWith("/games/") && pathname.length > "/games/".length;
  }
  return pathname === routeId;
}

/** True when `gate` covers `pathname`. Staff paths are never gated. */
export function isRouteGated(gate: SiteGateState | undefined | null, pathname: string): boolean {
  if (!gate?.active) return false;
  if (isStaffPath(pathname)) return false;
  if (gate.scope === "all") return true;
  return gate.routes.some((routeId) => routeMatchesLockable(pathname, routeId));
}

export const GATE_DEFAULTS: SiteGateState = { active: false, scope: "all", routes: [] };

export function normalizeGate(gate: SiteGateState | undefined | null): SiteGateState {
  if (!gate) return { ...GATE_DEFAULTS };
  return {
    active: gate.active === true,
    scope: gate.scope === "routes" ? "routes" : "all",
    routes: Array.isArray(gate.routes) ? gate.routes.filter((r) => typeof r === "string") : [],
    note: typeof gate.note === "string" ? gate.note : undefined,
    updatedAt: gate.updatedAt,
    updatedBy: gate.updatedBy,
  };
}
