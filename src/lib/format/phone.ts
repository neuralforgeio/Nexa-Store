/** Phone normalization for wa.me deep links. */

/**
 * Normalizes a configured store number to wa.me digit format.
 * "+62 888-6567-888" → "628886567888". Returns null when unusable.
 */
export function toWaDigits(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  // Local format "0888..." → country code 62 (Indonesian store default).
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    const converted = `62${digits.slice(1)}`;
    return converted.length >= 8 && converted.length <= 15 ? converted : null;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Human display: keeps the configured formatting, e.g. "+62 888-6567-888". */
export function displayPhone(raw: string): string {
  return raw.trim();
}
