"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { PublicCatalog } from "@/lib/queries";
import { useCartStore } from "./store";
import type { CartItem } from "./types";

/**
 * Live catalog resolution for cart items + stale-entry reconciliation.
 *
 * The cart persists only product/game references. Every render resolves the
 * CURRENT catalog: prices and availability always come from the fresh data,
 * never from client-stored values (price integrity).
 */

export type ResolvedCartItem = {
  item: CartItem;
  game: PublicCatalog["games"][number];
  product: PublicCatalog["products"][number];
};

export type CartResolution = {
  resolved: ResolvedCartItem[];
  stale: Array<{ item: CartItem; reason: string }>;
  total: number;
};

export function resolveCart(
  data: PublicCatalog | undefined,
  items: CartItem[]
): CartResolution {
  if (!data) return { resolved: [], stale: [], total: 0 };

  const gameById = new Map(data.games.map((g) => [g.id, g]));
  const productById = new Map(data.products.map((p) => [p.id, p]));

  const resolved: ResolvedCartItem[] = [];
  const stale: Array<{ item: CartItem; reason: string }> = [];

  for (const item of items) {
    const game = gameById.get(item.gameId);
    const product = productById.get(item.productId);
    if (!game || !product || product.gameId !== game.id) {
      stale.push({ item, reason: "Produk sudah tidak tersedia." });
      continue;
    }
    resolved.push({ item, game, product });
  }

  const total = resolved.reduce((sum, r) => sum + r.product.priceIdr, 0);
  return { resolved, stale, total };
}

/**
 * Drops stale entries (deleted/disabled products) whenever fresh catalog data
 * arrives, and tells the customer what happened — never a silent failure.
 * Guarded so the notification fires only when something is actually removed.
 */
export function useCartReconcile(data: PublicCatalog | undefined): void {
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    const { stale } = resolveCart(data, items);
    if (stale.length === 0) {
      notifiedRef.current = false;
      return;
    }
    for (const s of stale) removeItem(s.item.id);
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      toast.info("Keranjang diperbarui", {
        description: `${stale.length} produk di keranjang sudah tidak tersedia dan dihapus otomatis.`,
      });
    }
  }, [data, items, removeItem]);
}
