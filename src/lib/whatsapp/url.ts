import { toWaDigits } from "@/lib/format/phone";

/** wa.me deep-link generation (PRD §12). */

export class InvalidDestinationError extends Error {
  constructor() {
    super("Nomor WhatsApp tujuan tidak valid");
    this.name = "InvalidDestinationError";
  }
}

/**
 * Builds `https://wa.me/<digits>?text=<encoded>`.
 * Deterministic; throws InvalidDestinationError for malformed store numbers.
 */
export function buildWhatsAppUrl(destination: string, message: string): string {
  const digits = toWaDigits(destination);
  if (!digits) throw new InvalidDestinationError();
  const text = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${text}`;
}
