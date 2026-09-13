"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import type { Product } from "@/lib/catalog/types";
import { useCartStore } from "@/lib/cart/store";
import { MAX_CART_ITEMS } from "@/lib/cart/types";
import { cn } from "@/lib/utils";
import { Check, Plus } from "lucide-react";

/**
 * Denomination-led product card with two actions:
 * - Pressing anywhere on the card opens the instant single-item order sheet.
 * - The "Tambah" pill quick-adds the product to the cart (max 5 items).
 *
 * The whole-card button is a transparent overlay (z-0); the content above it
 * is pointer-events-none so clicks fall through. The quick-add pill re-enables
 * pointer events on top of the overlay.
 */
export const ProductCard = memo(function ProductCard({
  product,
  gameName,
  gameImage,
  gameId,
  showGame,
  index = 0,
  disabled,
  onOrder,
}: {
  product: Product;
  gameName: string;
  gameImage?: string | null;
  gameId: string;
  showGame: boolean;
  index?: number;
  disabled?: boolean;
  onOrder: (product: Product) => void;
}) {
  const addItem = useCartStore((s) => s.addItem);
  const [added, setAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  function quickAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    const result = addItem(product.id, gameId);
    if (!result.ok) {
      toast.info("Keranjang sudah penuh", {
        description: `Maksimal ${MAX_CART_ITEMS} item per pesanan. Hapus salah satu untuk menambah yang lain.`,
      });
      return;
    }
    setAdded(true);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(false), 1400);
  }

  const bonus = product.bonus?.trim();

  return (
    <motion.article
      layout="position"
      initial={reducedMotion ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-24px" }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3), ease: "easeOut" }}
      aria-label={`${product.denomination} ${product.name} ${gameName}`}
      className={cn(
        "group/card relative flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-card",
        "transition-[border-color,box-shadow,transform] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-card-hover",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      {/* Whole-card action: instant single-item order. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOrder(product)}
        aria-label={`Pesan ${product.denomination} ${product.name} ${gameName} sekarang`}
        className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />

      {/* Visual content — clicks fall through to the order overlay. */}
      <div className="pointer-events-none relative z-10 flex flex-1 flex-col gap-3">
        {showGame ? (
          <div className="flex items-center gap-2">
            <GameMark name={gameName} image={gameImage} size="sm" />
            <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {gameName}
            </span>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-1">
          <p className="font-display text-xl font-semibold leading-tight tracking-tight">
            {product.denomination} <span className="text-foreground/70">{product.name}</span>
          </p>
          {bonus ? (
            <p className="text-sm font-semibold text-primary">bonus {bonus.replace(/^\+\s*/, "+")}</p>
          ) : null}
          {product.note ? <p className="text-xs text-muted-foreground">{product.note}</p> : null}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3">
          <PriceTag value={product.priceIdr} size="lg" className="leading-none" />
        </div>
      </div>

      {/* Quick-add to cart — above the overlay, in the footer row. */}
      <motion.button
        type="button"
        onClick={quickAdd}
        disabled={disabled}
        aria-label={`Tambah ${product.denomination} ${product.name} ${gameName} ke keranjang`}
        initial={false}
        animate={
          added && !reducedMotion
            ? { scale: [1, 0.92, 1.04, 1], transition: { duration: 0.35 } }
            : { scale: 1 }
        }
        className={cn(
          "absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          added
            ? "bg-primary text-primary-foreground shadow-card"
            : "border border-primary/30 bg-background/90 text-primary shadow-card backdrop-blur transition-colors hover:border-primary/60 hover:bg-primary/10"
        )}
      >
        {added ? (
          <Check aria-hidden="true" className="h-3 w-3" />
        ) : (
          <Plus aria-hidden="true" className="h-3 w-3" />
        )}
        {added ? "Ditambahkan" : "Tambah"}
      </motion.button>
    </motion.article>
  );
});
