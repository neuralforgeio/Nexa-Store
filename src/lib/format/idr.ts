/** IDR formatting — integer-only, id-ID locale (PRD §16.3). */

const groupFormatter = new Intl.NumberFormat("id-ID");
const numberFormatter = new Intl.NumberFormat("id-ID");

/**
 * "Rp56.000" for 56000 — currency code joined to the Intl-formatted group
 * (PRD examples show no space). Deterministic across ICU builds: grouping
 * separators come from Intl, the "Rp" join is ours.
 */
export function formatIdr(value: number): string {
  if (!Number.isInteger(value)) {
    throw new TypeError(`formatIdr menerima nilai non-integer: ${value}`);
  }
  return `Rp${groupFormatter.format(value)}`;
}

/** "56.000" for 56000 — for compact table columns. */
export function formatNumberId(value: number): string {
  return numberFormatter.format(value);
}

/** Parse "56.000" / "56000" / "Rp56.000" → 56000, or null when invalid. */
export function parseIdrInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Reject anything carrying a sign — money here is unsigned.
  if (trimmed.includes("-") || trimmed.includes("+")) return null;
  const cleaned = trimmed.replace(/[^\d]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}
