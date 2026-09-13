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

/** Admin access state — developer-controlled (D8). Kept out of Admin's reach. */
export type AccessControlState = {
  adminBlocked: boolean;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;
};

export type SessionInfo = {
  authenticated: boolean;
  role: Role | null;
  email: string | null;
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
