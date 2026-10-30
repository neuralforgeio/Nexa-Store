"use client";

import { Gamepad2, Heart, HeartCrack, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import { RouteLink } from "@/components/shared/route-link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCartUI } from "@/components/store/cart/cart-ui-context";
import { FLY_TO_CART_EVENT, type FlyToCartDetail } from "@/components/store/cart/fly-to-cart";
import { useCartStore } from "@/lib/cart/store";
import { MAX_CART_ITEMS } from "@/lib/cart/types";
import { formatIdr } from "@/lib/format/idr";
import { effectivePriceForGame } from "@/lib/promo/pricing";
import { useCatalog, useSiteFeatures } from "@/lib/queries";
import { MAX_WISHLIST_ITEMS, useWishlistStore, type WishlistEntry } from "@/lib/wishlist/store";

/**
 * Drawer wishlist (v1.21.0) — daftar produk favorit dari perangkat ini.
 * Harga selalu live dari katalog (termasuk promo aktif); produk yang sudah
 * dihapus/di-nonaktifkan ditandai dan tetap bisa dibuang. Item bisa
 * dimasukkan ke keranjang (dengan animasi fly-to-cart) langsung dari baris.
 */
export function WishlistDrawer() {
  const open = useWishlistStore((s) => s.open);
  const setOpen = useWishlistStore((s) => s.setOpen);
  const entries = useWishlistStore((s) => s.entries);
  const remove = useWishlistStore((s) => s.remove);
  const addItem = useCartStore((s) => s.addItem);
  const { setOpen: setCartOpen } = useCartUI();
  const { data, isLoading } = useCatalog();
  const { data: features } = useSiteFeatures();

  function addToCart(e: React.MouseEvent, entry: WishlistEntry) {
    const result = addItem(entry.productId, entry.gameId);
    if (!result.ok) {
      toast.info("Keranjang sudah penuh", {
        description: `Maksimal ${MAX_CART_ITEMS} item per pesanan. Hapus salah satu dulu ya.`,
      });
      return;
    }
    toast.success("Masuk keranjang", {
      description: `${entry.denomination} ${entry.productName} — ${entry.gameName}`,
    });
    // Fly-to-cart dari ikon game di baris ini (fallback: baris itu sendiri).
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-wishlist-row]");
    const source = row?.querySelector<HTMLElement>("[data-game-mark]") ?? row;
    if (source) {
      window.dispatchEvent(
        new CustomEvent<FlyToCartDetail>(FLY_TO_CART_EVENT, {
          detail: {
            rect: source.getBoundingClientRect(),
            image: entry.gameImage,
            name: entry.gameName,
          },
        })
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="flex-none border-b border-border/70 px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2.5 font-display">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-primary/25 bg-primary/10 text-primary"
            >
              <Heart className="h-4 w-4" />
            </span>
            <span className="truncate">Wishlist</span>
            {entries.length > 0 ? (
              <span className="ml-1 shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-semibold tabular text-primary">
                {entries.length}/{MAX_WISHLIST_ITEMS}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            Produk favorit tersimpan di perangkat ini — harga selalu mengikuti katalog terbaru.
          </SheetDescription>
        </SheetHeader>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <span
                aria-hidden="true"
                className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-primary/30 bg-primary/5 text-primary/70"
              >
                <HeartCrack className="h-7 w-7" />
              </span>
              <div>
                <p className="font-display text-base font-semibold">Wishlist masih kosong</p>
                <p className="mx-auto mt-1 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
                  Tekan ikon hati di kartu produk untuk menyimpan favoritmu — nanti kembali
                  membelinya tinggal satu klik.
                </p>
              </div>
              <Button asChild size="lg" className="gap-2 font-semibold">
                <RouteLink href="/games" onClick={() => setOpen(false)}>
                  <Gamepad2 aria-hidden="true" className="h-4 w-4" />
                  Jelajahi Game
                </RouteLink>
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.map((entry) => {
                const product = data?.products.find(
                  (p) => p.id === entry.productId && p.gameId === entry.gameId && p.enabled
                );
                const game = data?.games.find((g) => g.id === entry.gameId);
                const gameSlug = game?.slug ?? entry.gameSlug ?? null;
                const promo = product
                  ? effectivePriceForGame(product.priceIdr, features?.promos, product.gameId)
                  : null;
                const price =
                  promo && promo.percentOff > 0
                    ? promo.price
                    : product
                      ? product.priceIdr
                      : null;

                return (
                  <li
                    key={`${entry.gameId}:${entry.productId}`}
                    data-wishlist-row
                    className="rounded-xl border bg-card p-3.5 shadow-card"
                  >
                    <div className="flex items-start gap-3">
                      <span data-game-mark className="flex shrink-0">
                        <GameMark name={entry.gameName} image={entry.gameImage} size="md" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-semibold leading-tight">
                          {entry.denomination}{" "}
                          <span className="text-foreground/70">{entry.productName}</span>
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {entry.gameName}
                        </p>

                        {product && price !== null ? (
                          <div className="mt-1.5 flex items-baseline gap-2">
                            {promo && promo.percentOff > 0 ? (
                              <span className="truncate text-[11px] text-muted-foreground line-through tabular">
                                {formatIdr(promo.base)}
                              </span>
                            ) : null}
                            <PriceTag
                              value={price}
                              size="md"
                              className={promo && promo.percentOff > 0 ? "text-primary" : undefined}
                            />
                            {promo && promo.percentOff > 0 ? (
                              <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-bold tabular text-primary-foreground">
                                -{promo.percentOff}%
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-xs font-medium text-muted-foreground/80">
                            Sudah tidak tersedia di katalog
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {product ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 flex-1 gap-1.5 text-[11px] font-semibold"
                          onClick={(e) => addToCart(e, entry)}
                        >
                          <ShoppingCart aria-hidden="true" className="h-3 w-3" />
                          Keranjang
                        </Button>
                      ) : null}
                      {gameSlug ? (
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="h-8 flex-1 gap-1.5 text-[11px] font-medium"
                        >
                          <RouteLink href={`/games/${gameSlug}`} onClick={() => setOpen(false)}>
                            Lihat Game
                          </RouteLink>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Hapus ${entry.denomination} ${entry.productName} dari wishlist`}
                        className="h-8 w-8 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(entry.productId)}
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}

              {isLoading && !data
                ? [0, 1, 2].map((i) => (
                    <li key={`sk-${i}`} className="rounded-xl border bg-card p-3.5">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    </li>
                  ))
                : null}
            </ul>
          )}
        </div>

        {entries.length > 0 ? (
          <div className="flex-none border-t border-border/70 bg-background/95 p-4 backdrop-blur sm:px-5">
            <Button
              type="button"
              size="lg"
              className="w-full gap-2 font-semibold"
              onClick={() => {
                setOpen(false);
                setCartOpen(true);
              }}
            >
              <ShoppingCart aria-hidden="true" className="h-4 w-4" />
              Lanjut ke Keranjang
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground/80">
              Wishlist tersimpan di perangkat ini, maksimal {MAX_WISHLIST_ITEMS} produk.
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
