import type { BarcodeRenderOptions } from "./render";

/**
 * Barcode pesanan (v1.16.0) — Code 128 asli yang bisa dipindai.
 *
 * Payload barcode adalah TAUTAN RESI: https://<origin>/track?id=<ID Order>.
 * Dipindai dengan Google Lens / kamera / pemindai apa pun → resi pesanan
 * terbuka otomatis di Nexa Store lengkap dengan status dan penjelasannya.
 * Generator (jsbarcode) dan pemindai (@zxing/browser) di-import dinamis —
 * biaya bundel hanya dibayar saat fitur dipakai.
 */

/** Pola ID Order — sama dengan yang divalidasi API pesanan. */
export const ORDER_ID_PATTERN = /^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/;

const LOOSE_ID = /NEXA-?\d{6}-?[A-HJKMNP-TV-Z23-9]{4}/;

/** Normalisasi isian/pindai: uppercase, buang aneh, sambungkan strip otomatis. */
export function normalizeOrderId(raw: string): string {
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (up.length <= 4) return up;
  if (up.length <= 10) return `${up.slice(0, 4)}-${up.slice(4)}`;
  return `${up.slice(0, 4)}-${up.slice(4, 10)}-${up.slice(10, 14)}`;
}

/** Payload tercetak di dalam barcode: tautan resi yang bisa dipindai. */
export function orderBarcodePayload(orderId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/track?id=${encodeURIComponent(orderId)}`;
}

/**
 * Ambil ID Order dari hasil pemindaian apa pun: URL resi, teks mentah ID,
 * atau teks yang menempelkan ID di mana saja. Null bila bukan ID Order Nexa.
 */
export function extractOrderId(raw: string): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const fromParam = url.searchParams.get("id");
      if (fromParam) {
        const id = normalizeOrderId(fromParam);
        if (ORDER_ID_PATTERN.test(id)) return id;
      }
      for (const seg of url.pathname.split("/").reverse()) {
        const id = normalizeOrderId(seg);
        if (ORDER_ID_PATTERN.test(id)) return id;
      }
    } catch {
      // Bukan URL valid — lanjut cek teks mentah di bawah.
    }
  }
  const m = text.toUpperCase().match(LOOSE_ID);
  if (!m) return null;
  const id = normalizeOrderId(m[0]);
  return ORDER_ID_PATTERN.test(id) ? id : null;
}

export type { BarcodeRenderOptions };
export { renderOrderBarcodeSvg, downloadOrderBarcodePng } from "./render";
