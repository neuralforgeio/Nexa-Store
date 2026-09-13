"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductCard } from "./product-card";
import { OrderSheet } from "./order-sheet";
import { GameMark } from "@/components/shared/game-mark";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/state-views";
import { useCatalog, type PublicCatalog } from "@/lib/queries";
import type { Product } from "@/lib/catalog/types";
import { ArrowLeft, ArrowRight, Coins, Search, SearchX } from "lucide-react";
import { toast } from "sonner";

type OrderTarget = { product: Product; game: PublicCatalog["games"][number] } | null;
type SortMode = "default" | "asc" | "desc";

const SORT_LABEL: Record<SortMode, string> = {
  default: "Urutan standar",
  asc: "Harga terendah",
  desc: "Harga tertinggi",
};

/** /games/[slug] — denomination selection for one game. */
export function GameDetailView({ slug }: { slug: string }) {
  const { data, isPending, isError, refetch } = useCatalog();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("default");
  const [orderTarget, setOrderTarget] = useState<OrderTarget>(null);
  const reducedMotion = useReducedMotion();

  const game = useMemo(() => data?.games.find((g) => g.slug === slug) ?? null, [data, slug]);

  const products = useMemo(() => {
    if (!data || !game) return [];
    const q = query.trim().toLowerCase();
    let list = data.products.filter((p) => p.gameId === game.id);
    if (q) {
      list = list.filter(
        (p) =>
          p.denomination.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.bonus ?? "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    if (sort === "asc") list.sort((a, b) => a.priceIdr - b.priceIdr);
    if (sort === "desc") list.sort((a, b) => b.priceIdr - a.priceIdr);
    return list;
  }, [data, game, query, sort]);

  if (isPending) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <LoadingState label="Memuat produk…" className="min-h-[60vh]" />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <ErrorState
          title="Katalog tidak dapat dimuat"
          description="Periksa koneksi kamu, lalu coba lagi."
          className="min-h-[60vh]"
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Coba lagi
            </Button>
          }
        />
      </main>
    );
  }

  if (!game) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-16 sm:px-6">
        <EmptyState
          className="min-h-[40vh]"
          icon={<Coins className="h-8 w-8" />}
          title="Game tidak ditemukan"
          description="Mungkin sudah dihapus atau alamatnya salah."
          action={
            <Button variant="outline" size="sm" asChild>
              <RouteLink href="/games" className="gap-1.5">
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
                Kembali ke katalog
              </RouteLink>
            </Button>
          }
        />
      </main>
    );
  }

  const maintenance = data.store.maintenanceMode;

  return (
    <main id="main">
      {/* Game header */}
      <section
        aria-labelledby="game-heading"
        className="bg-atmosphere relative overflow-hidden border-b border-border/60"
      >
        <div aria-hidden="true" className="bg-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(65%_70%_at_30%_20%,black,transparent)]" />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <RouteLink
              href="/games"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
              Semua game
            </RouteLink>
          </motion.div>

          <div className="mt-5 flex flex-wrap items-center gap-4 sm:flex-nowrap sm:gap-5">
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <GameMark name={game.name} image={game.image} size="xl" className="shadow-card" />
            </motion.div>
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
              className="min-w-0"
            >
              <h1 id="game-heading" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {game.name}
              </h1>
              {game.description ? (
                <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                  {game.description}
                </p>
              ) : null}
              <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {game.productCount} nominal tersedia
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {/* Search + sort */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.1, ease: "easeOut" }}
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <div className="relative w-full sm:max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nominal…"
              aria-label="Cari nominal"
              className="h-10 rounded-full border bg-card pl-9 pr-9 shadow-card transition-shadow duration-200 focus-visible:shadow-card-hover"
            />
            {query ? (
              <button
                type="button"
                aria-label="Hapus pencarian"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <SearchX aria-hidden="true" className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-xs text-muted-foreground" role="status">
              {products.length} nominal
            </span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger aria-label="Urutkan nominal" className="h-10 w-44 rounded-full border bg-card shadow-card">
                <SelectValue>{SORT_LABEL[sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Urutan standar</SelectItem>
                <SelectItem value="asc">Harga terendah</SelectItem>
                <SelectItem value="desc">Harga tertinggi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* Denominations */}
        {products.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={<Coins className="h-8 w-8" />}
            title={query ? "Tidak ada hasil" : "Belum ada nominal"}
            description={
              query
                ? `Tidak ada nominal yang cocok dengan "${query}".`
                : "Nominal yang tersedia akan muncul di sini."
            }
            action={
              query ? (
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  <SearchX aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                  Hapus pencarian
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <RouteLink href="/games" className="gap-1.5">
                    Lihat game lain
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </RouteLink>
                </Button>
              )
            }
          />
        ) : (
          <div key={`${query}:${sort}`} className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product, i) => (
              <ProductCard
                key={product.id}
                product={product}
                gameId={game.id}
                index={i}
                gameName={game.name}
                gameImage={game.image}
                showGame={false}
                disabled={maintenance}
                onOrder={(p) => {
                  if (maintenance) {
                    toast.info("Pemesanan sedang ditutup", {
                      description: data.store.maintenanceMessage || "Store dalam mode perbaikan.",
                    });
                    return;
                  }
                  setOrderTarget({ product: p, game });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <OrderSheet
        product={orderTarget?.product ?? null}
        game={orderTarget?.game ?? null}
        store={data.store}
        template={data.checkoutTemplate}
        open={orderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOrderTarget(null);
        }}
      />
    </main>
  );
}
