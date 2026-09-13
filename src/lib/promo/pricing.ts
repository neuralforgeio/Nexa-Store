import type { PublicPromo } from "@/lib/site-features/types";

/**
 * Promo pricing engine (client + server safe).
 *
 * Rules:
 * - A promo applies to a product when its scope is global, or targets the
 *   product's game.
 * - When several promos apply, the biggest discount wins (never stacked).
 * - Effective prices are rounded DOWN to the nearest Rp500 — the customer
 *   never pays more than the advertised percentage.
 */

export type EffectivePrice = {
  /** Harga setelah diskon (== base ketika tidak ada promo). */
  price: number;
  /** Harga asli tanpa promo. */
  base: number;
  percentOff: number;
  promoTitle: string | null;
  endsAt: string | null;
};

const NO_PROMO: EffectivePrice = {
  price: 0,
  base: 0,
  percentOff: 0,
  promoTitle: null,
  endsAt: null,
};

export function roundPromoIdr(value: number): number {
  return Math.max(0, Math.floor(value / 500) * 500);
}

export function effectivePriceForGame(
  baseIdr: number,
  promos: PublicPromo[] | undefined | null,
  gameId: string
): EffectivePrice {
  if (!promos || promos.length === 0) {
    return { ...NO_PROMO, price: baseIdr, base: baseIdr };
  }
  let best: PublicPromo | null = null;
  for (const p of promos) {
    if (p.scope === "game" && p.gameId !== gameId) continue;
    if (!best || p.percentOff > best.percentOff) best = p;
  }
  if (!best || best.percentOff <= 0) {
    return { ...NO_PROMO, price: baseIdr, base: baseIdr };
  }
  return {
    price: roundPromoIdr((baseIdr * (100 - best.percentOff)) / 100),
    base: baseIdr,
    percentOff: best.percentOff,
    promoTitle: best.title,
    endsAt: best.endsAt,
  };
}

/** Promo global terkuat saat ini — untuk strip promo di beranda. */
export function bestGlobalPromo(promos: PublicPromo[] | undefined | null): PublicPromo | null {
  if (!promos || promos.length === 0) return null;
  return (
    promos
      .filter((p) => p.scope === "global")
      .sort((a, b) => b.percentOff - a.percentOff)[0] ?? null
  );
}

/** "2 jam 5 menit" style countdown — dipakai strip promo & kartu produk. */
export function countdownParts(
  target: string | null | undefined,
  now: number = Date.now()
): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
} {
  if (!target) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  const total = Math.max(0, Date.parse(target) - now);
  return {
    days: Math.floor(total / 86_400_000),
    hours: Math.floor((total % 86_400_000) / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
    total,
  };
}
