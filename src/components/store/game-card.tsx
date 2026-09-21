"use client";

import { motion } from "framer-motion";
import { useReducedMotion } from "framer-motion";
import { GameMark } from "@/components/shared/game-mark";
import { RouteLink } from "@/components/shared/route-link";
import type { PublicCatalog } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

type PublicGame = PublicCatalog["games"][number];

/**
 * Game navigation cards.
 * - "tile": vertical card for the horizontal featured scroller.
 * - "row": full card for the catalog grid.
 */
export function GameCard({
  game,
  variant = "row",
  index = 0,
  className,
}: {
  game: PublicGame;
  variant?: "tile" | "row";
  index?: number;
  className?: string;
}) {
  const count = `${game.productCount} nominal`;
  const reducedMotion = useReducedMotion();

  if (variant === "tile") {
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-16px" }}
        transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.3), ease: "easeOut" }}
        className={cn("h-full shrink-0 snap-start", className)}
      >
        <RouteLink
          href={`/games/${game.slug}`}
          className="group flex h-full w-32 flex-col items-center gap-2.5 rounded-xl border bg-card px-3 py-4 text-center shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-primary/45 hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-36"
          aria-label={`Lihat nominal ${game.name}, ${count}`}
        >
          <GameMark
            name={game.name}
            image={game.image}
            size="lg"
            className="transition-transform duration-200 group-hover:scale-105"
          />
          {/* min-w-0 + w-full lets the clamp bite — without it, long names
              overflow the fixed-width tile instead of wrapping/clamping. */}
          <span className="flex w-full min-w-0 flex-1 flex-col items-center">
            <span className="line-clamp-2 w-full font-display text-sm font-semibold leading-tight">
              {game.name}
            </span>
            <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">{count}</span>
          </span>
        </RouteLink>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-24px" }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.06, 0.4), ease: "easeOut" }}
      className={className}
    >
      <RouteLink
        href={`/games/${game.slug}`}
        className="group flex h-full items-center gap-4 rounded-xl border bg-card p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5"
        aria-label={`Lihat nominal ${game.name}, ${count}`}
      >
        <GameMark
          name={game.name}
          image={game.image}
          size="lg"
          className="transition-transform duration-200 group-hover:scale-105"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-base font-semibold leading-tight">
              {game.name}
            </span>
          </span>
          {game.description ? (
            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
              {game.description}
            </span>
          ) : null}
          <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
            {count}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </RouteLink>
    </motion.div>
  );
}
