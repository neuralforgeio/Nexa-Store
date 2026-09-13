import type { OrderField } from "@/lib/catalog/types";
import type { CartRecipient } from "./types";

/**
 * Per-item recipient validation, data-driven by each game's orderField schema.
 * Mirrors the single-order rules (required / minLength / maxLength / pattern)
 * so cart checkout and the instant order form agree on what "valid" means.
 */

export type RecipientErrors = Record<string, string>;

export function validateRecipient(
  orderFields: OrderField[],
  recipient: CartRecipient
): RecipientErrors {
  const errors: RecipientErrors = {};

  const name = recipient.customerName.trim();
  if (!name) errors.customerName = "Nama wajib diisi";
  else if (name.length > 80) errors.customerName = "Nama terlalu panjang";

  for (const f of orderFields) {
    const raw = (recipient.fields[f.key] ?? "").trim();
    if (f.required && !raw) {
      errors[f.key] = `${f.label} wajib diisi`;
      continue;
    }
    if (!raw) continue; // optional + empty → fine
    if (f.minLength && raw.length < f.minLength) {
      errors[f.key] = `Minimal ${f.minLength} karakter`;
      continue;
    }
    if (f.maxLength && raw.length > f.maxLength) {
      errors[f.key] = `Maksimal ${f.maxLength} karakter`;
      continue;
    }
    if (f.pattern) {
      try {
        const re = new RegExp(f.pattern);
        if (!re.test(raw)) errors[f.key] = `Format ${f.label} tidak sesuai`;
      } catch {
        // Invalid configured pattern must not brick checkout — skip regex.
      }
    }
  }

  return errors;
}

export function isRecipientComplete(
  orderFields: OrderField[],
  recipient: CartRecipient
): boolean {
  return Object.keys(validateRecipient(orderFields, recipient)).length === 0;
}
