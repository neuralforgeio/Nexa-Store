import type { Role } from "@/lib/catalog/types";

/**
 * Permission matrix — PRD §7.2, enforced server-side on every endpoint.
 * UI hiding is never authorization.
 */

export type Capability =
  | "storefront.view"
  | "catalog.read"
  | "login"
  | "dashboard.view"
  | "games.manage"
  | "categories.manage"
  | "products.manage"
  | "prices.manage"
  | "products.toggle"
  | "settings.manage"
  | "checkoutTemplate.manage"
  | "storefront.preview"
  | "gitSync.viewLimited"
  | "data.inspect"
  | "data.importExport"
  | "diagnostics.repository"
  | "diagnostics.deployment"
  | "rollback.inspect"
  | "featureFlags.manage"
  | "validation.run"
  | "access.manage"
  | "promos.manage"
  | "banners.manage"
  | "schedules.manage"
  | "chat.manage"
  | "analytics.read";

const ADMIN_CAPABILITIES = new Set<Capability>([
  "storefront.view",
  "catalog.read",
  "login",
  "dashboard.view",
  "games.manage",
  "categories.manage",
  "products.manage",
  "prices.manage",
  "products.toggle",
  "settings.manage",
  "checkoutTemplate.manage",
  "storefront.preview",
  "gitSync.viewLimited",
  "promos.manage",
  "banners.manage",
]);

const DEVELOPER_CAPABILITIES = new Set<Capability>([
  ...ADMIN_CAPABILITIES,
  "data.inspect",
  "data.importExport",
  "diagnostics.repository",
  "diagnostics.deployment",
  "rollback.inspect",
  "featureFlags.manage",
  "validation.run",
  "access.manage",
  "promos.manage",
  "banners.manage",
  "schedules.manage",
  "chat.manage",
  "analytics.read",
]);

const CUSTOMER_CAPABILITIES = new Set<Capability>(["storefront.view"]);

const BY_ROLE: Record<Role, Set<Capability>> = {
  CUSTOMER: CUSTOMER_CAPABILITIES,
  ADMIN: ADMIN_CAPABILITIES,
  DEVELOPER: DEVELOPER_CAPABILITIES,
};

export function can(role: Role, capability: Capability): boolean {
  return BY_ROLE[role].has(capability);
}

/** Minimum role accepted for a capability — route guard helper. */
export function assertCapability(
  role: Role | null | undefined,
  capability: Capability
): { ok: true } | { ok: false; status: 401 | 403; message: string } {
  if (!role) {
    return { ok: false, status: 401, message: "Masuk terlebih dahulu." };
  }
  if (!can(role, capability)) {
    // Deliberately generic: API responses must not reveal which higher
    // roles or capabilities exist beyond the caller's own.
    return {
      ok: false,
      status: 403,
      message: "Anda tidak memiliki izin untuk aksi ini.",
    };
  }
  return { ok: true };
}
