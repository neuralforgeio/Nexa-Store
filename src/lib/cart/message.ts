import { formatIdr } from "@/lib/format/idr";
import { productTitle } from "@/lib/whatsapp/template";
import type { OrderField } from "@/lib/catalog/types";
import type { CartRecipient } from "./types";

/**
 * Multi-item cart checkout message + order reference.
 *
 * ONE structured WhatsApp message for the whole cart, written for a human
 * store administrator: plain text, numbered items, explicit account data per
 * item (each game has its own identifiers), and a single total.
 */

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

/** NEXA-YYMMDD-XXXX — short, readable, collision-resistant enough client-side. */
export function generateOrderReference(date: Date = new Date()): string {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  let rand = "";
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  for (const b of bytes) rand += REF_ALPHABET[b % REF_ALPHABET.length];
  return `NEXA-${yy}${mm}${dd}-${rand}`;
}

export type CartMessageItem = {
  gameName: string;
  /** Full product title, e.g. "1000 + 50 Valorant Points". */
  productName: string;
  priceIdr: number;
  recipient: CartRecipient;
  orderFields: OrderField[];
};

export function buildCartWhatsAppMessage(input: {
  storeName: string;
  reference: string;
  items: CartMessageItem[];
  total: number;
}): string {
  const { storeName, reference, items, total } = input;
  const line = "────────────────";

  const blocks = items.map((item, i) => {
    const rows: string[] = [];
    rows.push(`${i + 1}. ${item.gameName.toUpperCase()}`);
    rows.push(`Produk: ${item.productName}`);
    rows.push(`Harga: ${formatIdr(item.priceIdr)}`);
    rows.push(`Nama: ${item.recipient.customerName.trim() || "—"}`);
    for (const f of item.orderFields) {
      const value = (item.recipient.fields[f.key] ?? "").trim();
      rows.push(`${f.label}: ${value || "—"}`);
    }
    const note = item.recipient.note.trim();
    if (note) rows.push(`Catatan: ${note}`);
    return rows.join("\n");
  });

  return [
    `Halo ${storeName}, saya ingin melakukan pemesanan.`,
    "",
    `ORDER ${storeName.toUpperCase()} — ${reference}`,
    line,
    blocks.join("\n\n"),
    line,
    `Total (${items.length} item): ${formatIdr(total)}`,
    "",
    "Mohon dikonfirmasi kembali sebelum proses.",
  ].join("\n");
}

/** Convenience: title used for review/history rows. */
export function itemTitle(item: { productName: string }): string {
  return item.productName;
}

export { productTitle };
