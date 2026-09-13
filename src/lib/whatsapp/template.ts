import type { Game, Product, StoreSettings } from "@/lib/catalog/types";
import { formatIdr } from "@/lib/format/idr";
import { formatJakartaDateTime } from "@/lib/format/date";

/**
 * Checkout template engine (PRD §37).
 * Deterministic render, unknown placeholders rejected, no null/undefined leakage,
 * line breaks preserved. {orderDetails}/{timestamp} extensions documented in A9.
 */

export const CHECKOUT_PLACEHOLDERS = [
  "storeName",
  "gameName",
  "productName",
  "price",
  "customerName",
  "playerId",
  "serverId",
  "note",
  "orderDetails",
  "timestamp",
] as const;

export type PlaceholderName = (typeof CHECKOUT_PLACEHOLDERS)[number];

export class UnknownPlaceholderError extends Error {
  constructor(public readonly name: string) {
    super(`Placeholder tidak dikenal: {${name}}`);
    this.name = "UnknownPlaceholderError";
  }
}

export type OrderFormValues = {
  customerName: string;
  note: string;
  /** Values keyed by the game's orderFieldSchema keys. */
  fields: Record<string, string>;
};

export type TemplateContext = {
  storeName: string;
  gameName: string;
  productName: string;
  price: string;
  customerName: string;
  playerId: string | undefined;
  serverId: string | undefined;
  note: string;
  orderDetails: string;
  timestamp: string;
};

/** Throws UnknownPlaceholderError when the template uses a non-allowlisted placeholder. */
export function validateTemplate(template: string): void {
  for (const name of extractPlaceholderNames(template)) {
    if (!CHECKOUT_PLACEHOLDERS.includes(name as PlaceholderName)) {
      throw new UnknownPlaceholderError(name);
    }
  }
}

export function extractPlaceholderNames(template: string): string[] {
  const out: string[] = [];
  const re = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) out.push(m[1]);
  return out;
}

export function buildTemplateContext(
  settings: StoreSettings,
  game: Game,
  product: Product,
  values: OrderFormValues
): TemplateContext {
  const fieldLines = game.orderFieldSchema
    .map((f) => `${f.label}: ${values.fields[f.key]?.trim() || "—"}`)
    .join("\n");

  return {
    storeName: settings.storeName,
    gameName: game.name,
    productName: productTitle(product),
    price: formatIdr(product.priceIdr),
    customerName: values.customerName.trim(),
    playerId: values.fields["playerId"]?.trim() || undefined,
    serverId: values.fields["serverId"]?.trim() || undefined,
    note: values.note.trim() || "—",
    orderDetails: fieldLines,
    timestamp: formatJakartaDateTime(new Date()),
  };
}

/** Renders the template. Unknown placeholders throw (fail-closed). */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  validateTemplate(template);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_all, name: string) => {
    const value = (ctx as Record<string, string | undefined>)[name];
    if (value === undefined) {
      // Known placeholder without a value — render as empty, never "undefined".
      return "";
    }
    return value;
  });
}

/** Product display title: "300 + 30 Genesis Crystals" (PRD §10.4). */
export function productTitle(product: Product): string {
  const bonus = product.bonus?.trim();
  return bonus ? `${product.denomination} ${bonus} ${product.name}` : `${product.denomination} ${product.name}`;
}
