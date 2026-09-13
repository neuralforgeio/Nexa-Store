"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GameCard } from "./game-card";
import { LoadingState, EmptyState, ErrorState } from "@/components/shared/state-views";
import { useCatalog } from "@/lib/queries";
import { Gamepad2, Search, SearchX } from "lucide-react";

/** /games — the full catalog. */
export function GamesView() {
  const { data, isPending, isError, refetch } = useCatalog();
  const [query, setQuery] = useState("");
  const reducedMotion = useReducedMotion();

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const games = [...data.games].sort((a, b) => a.sortOrder - b.sortOrder);
    if (!q) return games;
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description ?? "").toLowerCase().includes(q)
    );
  }, [data, query]);

  if (isPending) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <LoadingState label="Memuat game…" className="min-h-[60vh]" />
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

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <motion.header
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="max-w-xl"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Katalog</p>
        <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
          Semua game
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.games.length} game, {data.products.length} nominal tersedia.
        </p>
      </motion.header>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.06, ease: "easeOut" }}
        className="relative mt-6 max-w-md"
      >
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari game…"
          aria-label="Cari game"
          aria-description={`${filtered.length} dari ${data.games.length} game`}
          className="h-11 rounded-full border bg-card pl-9 pr-4 shadow-card transition-shadow duration-200 focus-visible:shadow-card-hover"
        />
        {query ? (
          <button
            type="button"
            aria-label="Hapus pencarian"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <SearchX aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </motion.div>

      {filtered.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<Gamepad2 className="h-8 w-8" />}
          title={query ? "Tidak ada hasil" : "Belum ada game"}
          description={
            query
              ? `Tidak ada game yang cocok dengan "${query}". Coba kata kunci lain.`
              : "Game yang tersedia akan muncul di sini."
          }
          action={
            query ? (
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                <SearchX aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                Hapus pencarian
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div role="list" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((game, i) => (
            <div role="listitem" key={game.id}>
              <GameCard game={game} index={i} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
