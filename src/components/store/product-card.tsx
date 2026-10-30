"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import type { Product } from "@/lib/catalog/types";
import { useSiteFeatures } from "@/lib/queries";
import { effectivePriceForGame } from "@/lib/promo/pricing";
import { useCartStore } from "@/lib/cart/store";
import { MAX_CART_ITEMS } from "@/lib/cart/types";
import { MAX_WISHLIST_ITEMS, useWishlistStore } from "@/lib/wishlist/store";
import { formatIdr } from "@/lib/format/idr";
import { cn } from "@/lib/utils";
import { Check, Heart, ShoppingCart, TimerReset, Zap } from "lucide-react";
import { FLY_TO_CART_EVENT } from "./cart/fly-to-cart";
import type { FlyToCartDetail } from "./cart/fly-to-cart";

/**
 * Denomination-led product card with two action surfaces:
 * - Pressing anywhere on the card (or the "Beli" button) opens the instant
 *   single-item order sheet.
 * - The "Keranjang" pill quick-adds the product to the cart (max 5 items) and
 *   fires the fly-to-cart animation (see cart/fly-to-cart.tsx).
 *
 * The whole-card button is a transparent overlay (z-0); the content above it
 * is pointer-events-none so clicks fall through. The action cluster re-enables
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
  const wishlisted = useWishlistStore((s) => s.entries.some((e) => e.productId === product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const [added, setAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const { data: features } = useSiteFeatures();
  const promo = effectivePriceForGame(product.priceIdr, features?.promos, gameId);

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

    // Fly-to-cart: hand the animation layer the source geometry (the card's
    // game mark, or the card itself when the mark is not shown).
    const source =
      articleRef.current?.querySelector<HTMLElement>("[data-game-mark]") ?? articleRef.current;
    if (source) {
      window.dispatchEvent(
        new CustomEvent<FlyToCartDetail>(FLY_TO_CART_EVENT, {
          detail: {
            rect: source.getBoundingClientRect(),
            image: gameImage ?? null,
            name: gameName,
          },
        })
      );
    }
  }

  function toggleWish(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    const result = toggleWishlist({
      productId: product.id,
      gameId,
      gameSlug: null,
      gameName,
      gameImage: gameImage ?? null,
      denomination: product.denomination,
      productName: product.name,
      addedAt: new Date().toISOString(),
    });
    if (result === "added") {
      toast.success("Masuk wishlist", {
        description: "Buka lewat ikon hati di bilah atas.",
      });
    } else if (result === "full") {
      toast.info("Wishlist penuh", {
        description: `Maksimal ${MAX_WISHLIST_ITEMS} produk — hapus salah satu dulu.`,
      });
    }
  }

  function instantBuy(e: React.MouseEvent) {
    e.stopPropagation();
    onOrder(product);
  }

  const bonus = product.bonus?.trim();

  return (
    <motion.article
      ref={articleRef}
      layout="position"
      initial={reducedMotion ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-24px" }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3), ease: "easeOut" }}
      aria-label={`${product.denomination} ${product.name} ${gameName}`}
      className={cn(
        "group/card @container relative flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-card",
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
            {/* data-game-mark: fly-to-cart origin (GameMark does not take refs). */}
            <span data-game-mark className="flex">
              <GameMark name={gameName} image={gameImage} size="sm" />
            </span>
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
          {promo.percentOff > 0 ? (
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-bold tabular text-primary-foreground">
                  -{promo.percentOff}%
                </span>
                <span className="truncate text-[11px] font-medium text-muted-foreground line-through tabular">
                  {formatIdr(promo.base)}
                </span>
              </span>
              <PriceTag value={promo.price} size="lg" className="mt-0.5 text-primary leading-none" />
              {promo.promoTitle ? (
                <span className="mt-1 flex items-center gap-1 truncate text-[10px] font-medium text-primary/80">
                  <TimerReset aria-hidden="true" className="h-3 w-3 shrink-0" />
                  <span className="truncate">{promo.promoTitle}</span>
                </span>
              ) : null}
            </div>
          ) : (
            <PriceTag value={product.priceIdr} size="lg" className="leading-none" />
          )}
        </div>
      </div>

      {/* Action cluster — above the order overlay, bottom-right. On wide
          cards it floats beside the price (absolute bottom-right, same as the
          old quick-add pill). Narrow cards (container query on the card's
          content box) cannot fit cluster + price side by side, so the cluster
          drops into flow as its own row under the price — no overlap, both
          stay readable (prices reach "Rp 27.279.000" in this catalog). */}
      <div
        className={cn(
          "absolute bottom-4 right-4 z-20 flex items-center gap-2",
          "@max-[320px]:relative @max-[320px]:bottom-auto @max-[320px]:right-auto @max-[320px]:self-end"
        )}
      >
        <motion.button
          type="button"
          onClick={toggleWish}
          disabled={disabled}
          aria-pressed={wishlisted}
          aria-label={
            wishlisted
              ? `Hapus ${product.denomination} ${product.name} ${gameName} dari wishlist`
              : `Simpan ${product.denomination} ${product.name} ${gameName} ke wishlist`
          }
          initial={false}
          animate={
            wishlisted && !reducedMotion
              ? { scale: [1, 0.9, 1.15, 1], transition: { duration: 0.4 } }
              : { scale: 1 }
          }
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-card",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            wishlisted
              ? "border-primary/60 bg-primary text-primary-foreground"
              : "border-primary/30 bg-background/90 text-primary backdrop-blur transition-colors hover:border-primary/60 hover:bg-primary/10"
          )}
        >
          <Heart
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              wishlisted && "fill-current"
            )}
          />
        </motion.button>
        <button
          type="button"
          onClick={instantBuy}
          disabled={disabled}
          aria-label={`Beli ${product.denomination} ${product.name} ${gameName} sekarang`}
          className={cn(
            "flex h-8 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground shadow-card",
            "transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          )}
        >
          <Zap aria-hidden="true" className="h-3 w-3" />
          Beli
        </button>
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
            "flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            added
              ? "bg-primary text-primary-foreground shadow-card"
              : "border border-primary/30 bg-background/90 text-primary shadow-card backdrop-blur transition-colors hover:border-primary/60 hover:bg-primary/10"
          )}
        >
          {added ? (
            <Check aria-hidden="true" className="h-3 w-3" />
          ) : (
            <ShoppingCart aria-hidden="true" className="h-3 w-3" />
          )}
          {added ? "Ditambahkan" : "Keranjang"}
        </motion.button>
      </div>
    </motion.article>
  );
});
