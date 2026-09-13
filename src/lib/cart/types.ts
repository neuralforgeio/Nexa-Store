/**
 * Nexa Store — cart domain types.
 *
 * Design notes:
 * - A cart item stores product/game REFERENCES only (no catalog snapshot).
 *   Prices and product data are always resolved live from the loaded catalog
 *   (price integrity: tampered client state can never redefine a price).
 * - Every item owns its own recipient data. Different games ask for different
 *   account identifiers, so there is no global player-ID form.
 * - Maximum 5 line items per order (business rule, enforced in store + UI +
 *   checkout validation).
 */

/** Maximum number of line items allowed in one cart/order. */
export const MAX_CART_ITEMS = 5;

/** Maximum local order records kept (browser history only, never a claim of server-side orders). */
export const MAX_ORDER_HISTORY = 10;

export type CartRecipient = {
  /** Contact name for this order line. */
  customerName: string;
  /** Free-form note (optional). */
  note: string;
  /** Values keyed by the game's orderField key (User ID, Riot ID, …). */
  fields: Record<string, string>;
};

export type CartItem = {
  /** Unique line id (not the product id — duplicate products are allowed). */
  id: string;
  productId: string;
  gameId: string;
  addedAt: string;
  recipient: CartRecipient;
};

export function emptyRecipient(): CartRecipient {
  return { customerName: "", note: "", fields: {} };
}

/**
 * Lightweight local order record (§ order history — local-first).
 * Deliberately does NOT store account identifiers: it is a convenience
 * re-order aid, not sensitive data to keep around indefinitely.
 */
export type LocalOrderRecord = {
  reference: string;
  createdAt: string;
  total: number;
  itemCount: number;
  items: Array<{
    gameName: string;
    productName: string;
    price: number;
  }>;
};

export type AddItemResult = { ok: true; id: string } | { ok: false; reason: "full" };
