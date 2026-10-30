/**
 * Rate limiter publik bersama (v1.22.0 hardening).
 *
 * Sliding-window in-memory per kunci (biasanya `ip` atau `ip:scope`).
 * Dipakai endpoint publik yang mahal/bisa disalahgunakan: subscribe push,
 * lacak pesanan, site-features, catalog. Endpoint mutasi admin memakai
 * enforceMutationRateLimit() per sesi (lib/api/http) — ini jalur publik.
 *
 * Prinsip:
 * - FAIL-OPEN: kesalahan tak pernah membuat endpoint mati total.
 * - Per-instance (serverless): lapisan pertahanan app-layer di atas
 *   proteksi volumetric edge Vercel — bukan penggantinya.
 * - Sweeper periodik menjaga peta tetap kecil (anti memory-bloat).
 */

const MAX_KEYS = 8_000;

const hits = new Map<string, number[]>();
let sweepAt = 0;

function sweep(now: number): void {
  if (now - sweepAt < 60_000) return;
  sweepAt = now;
  for (const [key, arr] of hits) {
    // Hapus kunci yang seluruh jendelanya sudah lewat — cukup cek termuda.
    const newest = arr[arr.length - 1] ?? 0;
    if (now - newest > 10 * 60_000) hits.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Detik hingga boleh mencoba lagi (≥1 saat terblokir). */
  retryAfterSeconds: number;
  /** Sisa kuota di jendela ini. */
  remaining: number;
};

/**
 * Catat + periksa satu percobaan. Kembalikan ok=false (dan retry-after)
 * bila kuota jendela sudah habis.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  try {
    const now = Date.now();
    sweep(now);
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      const retryAfterMs = Math.max(windowMs - (now - arr[0]), 1_000);
      return { ok: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000), remaining: 0 };
    }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > MAX_KEYS) hits.clear(); // pengaman ekstrem: fail-open
    return { ok: true, retryAfterSeconds: 0, remaining: limit - arr.length };
  } catch {
    // Tidak pernah menggagalkan endpoint karena limiter bermasalah.
    return { ok: true, retryAfterSeconds: 0, remaining: limit };
  }
}
