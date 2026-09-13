"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X, Zap, Megaphone, TriangleAlert, OctagonAlert, BadgeCheck, Info, ArrowRight } from "lucide-react";
import { useSiteFeatures } from "@/lib/queries";
import { bestGlobalPromo, countdownParts } from "@/lib/promo/pricing";
import { RouteLink } from "@/components/shared/route-link";
import type { BannerSeverity } from "@/lib/site-features/types";
import { cn } from "@/lib/utils";

/**
 * Site-features bar (v1.3.0) — renders right under the storefront header:
 * 1. Active promo strip (countdown when the promo has an end time).
 * 2. Announcement banners, severity-styled, dismissible for the day.
 * Data comes from the 30-second /api/site-features poll — publishing from the
 * developer panel or Telegram lands on every open storefront automatically.
 */

const DISMISS_KEY = "nexa.banner.dismissed";

function dismissedToday(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, string>;
    const day = new Date().toISOString().slice(0, 10);
    return map[id] === day;
  } catch {
    return false;
  }
}

function markDismissed(id: string): void {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[id] = new Date().toISOString().slice(0, 10);
    // Keep the map bounded.
    const keys = Object.keys(map);
    for (const key of keys.slice(0, Math.max(0, keys.length - 20))) delete map[key];
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

const SEVERITY_META: Record<
  BannerSeverity,
  { icon: typeof Info; box: string; iconColor: string; chip: string }
> = {
  info: {
    icon: Info,
    box: "border-primary/30 bg-primary/10",
    iconColor: "text-primary",
    chip: "bg-primary/15 text-primary",
  },
  sukses: {
    icon: BadgeCheck,
    box: "border-emerald-500/30 bg-emerald-500/10",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  peringatan: {
    icon: TriangleAlert,
    box: "border-amber-500/40 bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  penting: {
    icon: OctagonAlert,
    box: "border-destructive/40 bg-destructive/10",
    iconColor: "text-destructive",
    chip: "bg-destructive/15 text-destructive",
  },
};

export function SiteFeaturesBar() {
  const { data } = useSiteFeatures();
  // Client-only flag without a setState-in-effect: distinct snapshots for
  // server (false) and browser (true) keep SSR markup stable.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const promo = useMemo(() => bestGlobalPromo(data?.promos), [data?.promos]);
  const banners = useMemo(
    () => (mounted ? (data?.banners ?? []).filter((b) => !dismissedToday(b.id)) : []),
    [data?.banners, mounted]
  );

  if (!promo && banners.length === 0) return null;

  return (
    <div aria-label="Informasi situs" className="flex flex-col gap-0">
      {promo ? <PromoStrip key={promo.id} title={promo.title} percentOff={promo.percentOff} endsAt={promo.endsAt} /> : null}
      <AnimatePresence initial={false}>
        {banners.map((b) => (
          <BannerRow key={b.id} banner={b} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function PromoStrip({
  title,
  percentOff,
  endsAt,
}: {
  title: string;
  percentOff: number;
  endsAt: string | null;
}) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  const cd = countdownParts(endsAt, now);
  const showCountdown = Boolean(endsAt) && cd.total > 0 && cd.total < 48 * 3600_000;

  return (
    <div
      role="status"
      className="relative overflow-hidden border-b border-primary/30 bg-gradient-to-r from-primary/15 via-primary/10 to-primary/5"
    >
      {!reduced ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
          animate={{ x: ["0%", "450%"] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: "linear" }}
        />
      ) : null}
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <span className="flex items-center gap-1.5 font-display text-sm font-semibold text-primary">
          <Zap aria-hidden="true" className="h-4 w-4" />
          {title}
        </span>
        <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-xs font-bold tabular text-primary-foreground">
          -{percentOff}%
        </span>
        <span className="text-xs text-muted-foreground">berlaku semua game</span>
        {showCountdown ? (
          <span className="ml-auto flex items-center gap-1 font-mono text-xs font-semibold tabular text-foreground/85">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="sr-only">Berakhir dalam</span>
            {cd.days > 0 ? `${cd.days}h ` : ""}
            {String(cd.hours).padStart(2, "0")}:{String(cd.minutes).padStart(2, "0")}:
            {String(cd.seconds).padStart(2, "0")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BannerRow({ banner }: { banner: { id: string; severity: BannerSeverity; title: string; message: string; ctaLabel: string | null; ctaHref: string | null } }) {
  const meta = SEVERITY_META[banner.severity];
  const Icon = meta.icon;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="overflow-hidden border-b border-border/70"
    >
      <div className={cn("flex items-start gap-2.5 sm:items-center", meta.box)}>
        <div className="mx-auto flex w-full max-w-6xl items-start gap-2.5 px-4 py-2.5 sm:items-center sm:px-6">
          <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0 sm:mt-0", meta.iconColor)} />
          <p className="min-w-0 flex-1 text-sm leading-snug">
            <span className="font-semibold">{banner.title}</span>
            <span className="text-muted-foreground"> — {banner.message}</span>
          </p>
          {banner.ctaLabel && banner.ctaHref ? (
            banner.ctaHref.startsWith("/") ? (
              <RouteLink
                href={banner.ctaHref}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs font-semibold transition-colors hover:border-primary/50 hover:text-primary"
              >
                {banner.ctaLabel}
                <ArrowRight aria-hidden="true" className="h-3 w-3" />
              </RouteLink>
            ) : (
              <a
                href={banner.ctaHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs font-semibold transition-colors hover:border-primary/50 hover:text-primary"
              >
                {banner.ctaLabel}
                <ArrowRight aria-hidden="true" className="h-3 w-3" />
              </a>
            )
          ) : null}
          <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline-flex", meta.chip)}>
            <Megaphone aria-hidden="true" className="mr-1 h-3 w-3" />
            {banner.severity}
          </span>
          <button
            type="button"
            aria-label="Tutup pengumuman"
            onClick={() => markDismissed(banner.id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
