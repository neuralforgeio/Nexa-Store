/**
 * Nexa Store — domain types.
 * Mirrors PRD §13 data model. All money values are integer IDR (no floats).
 */

export type Role = "CUSTOMER" | "ADMIN" | "DEVELOPER";

export type OrderField = {
  key: string;
  label: string;
  type: "text" | "number";
  required: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type Game = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  image?: string;
  categoryIds: string[];
  orderFieldSchema: OrderField[];
  enabled: boolean;
  sortOrder: number;
};

export type Category = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
};

export type Product = {
  id: string;
  gameId: string;
  categoryId?: string;
  name: string;
  denomination: string;
  bonus?: string;
  priceIdr: number;
  currency: "IDR";
  enabled: boolean;
  sortOrder: number;
  note?: string;
};

export type StoreSettings = {
  storeName: string;
  whatsappNumber: string;
  currency: "IDR";
  locale: "id-ID";
  announcement?: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  supportNote?: string;
};

export type CheckoutTemplate = {
  /** Message template; supports placeholders from CHECKOUT_PLACEHOLDERS. */
  template: string;
  updatedAt?: string;
  updatedBy?: string;
};

/** Canonical file keys — the only paths the mutation layer may touch. */
export type CanonicalFileKey =
  | "games"
  | "products"
  | "categories"
  | "settings"
  | "checkout-template"
  | "access-control";

export const CANONICAL_FILES: Record<CanonicalFileKey, string> = {
  games: "data/catalog/games.json",
  products: "data/catalog/products.json",
  categories: "data/catalog/categories.json",
  settings: "data/store/settings.json",
  "checkout-template": "data/store/checkout-template.json",
  "access-control": "data/store/access-control.json",
};

/**
 * One site-wide gate mode (lockdown or maintenance), controlled by the
 * Developer. `note` is the lockdown reason / maintenance message shown on the
 * gate screen; `routes` references LOCKABLE_ROUTES ids when scope="routes".
 */
export type SiteGateState = {
  active: boolean;
  scope: "all" | "routes";
  routes: string[];
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
};

/** Admin access state — developer-controlled (D8). Kept out of Admin's reach. */
export type AccessControlState = {
  adminBlocked: boolean;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;
  /** Total or route-scoped lockdown (red gate at /lockdown). */
  lockdown?: SiteGateState;
  /** Total or route-scoped maintenance (amber gate at /maintenance). */
  maintenance?: SiteGateState;
};

export type SessionInfo = {
  authenticated: boolean;
  role: Role | null;
  email: string | null;
  /**
   * Present when the caller's Admin access was revoked by the Developer —
   * drives the blocking modal in the dashboard (D8).
   */
  blocked?: { byRole: Role; reason: string | null } | null;
};

export type AdapterMode = "local" | "github";

export type SyncRevision = {
  revision: string;
  adapter: AdapterMode;
  lastSyncAt: string | null;
  lastCommitMessage: string | null;
  lastError: string | null;
};

export type ValidationIssue = {
  file: CanonicalFileKey;
  recordId?: string;
  field?: string;
  reason: string;
  received?: string;
};

export type ValidationReport = {
  ok: boolean;
  issues: ValidationIssue[];
};
