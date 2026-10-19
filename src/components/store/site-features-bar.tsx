"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Zap, Megaphone, TriangleAlert, OctagonAlert, BadgeCheck, Info, ArrowRight } from "lucide-react";
import { useSiteFeatures } from "@/lib/queries";
import { bestGlobalPromo, countdownParts } from "@/lib/promo/pricing";
import { RouteLink } from "@/components/shared/route-link";
import type { BannerSeverity } from "@/lib/site-features/types";
import { cn } from "@/lib/utils";

/**
 * Site-features toasts (v1.16.0) — promo aktif + pengumuman tampil sebagai
 * toast lebar yang MELAYANG di tengah-atas: menimpa konten, bukan menggeser
 * halaman ke bawah. Teks yang kepanjangan otomatis menggulir ke kiri
 * (marquee) supaya seluruhnya terbaca, dan setiap toast bisa ditutup —
 * langsung lenyap saat tombol X ditekan (bug lama: penutupan hanya menulis
 * localStorage tanpa memicu render, jadi toast tampak tak bisa ditutup).
 * Data tetap datang dari polling /api/site-features tiap 30 detik.
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
  { icon: typeof Info; ring: string; iconColor: string; chip: string }
> = {
  info: {
    icon: Info,
    ring: "border-primary/35",
    iconColor: "text-primary",
    chip: "bg-primary/15 text-primary",
  },
  sukses: {
    icon: BadgeCheck,
    ring: "border-emerald-500/35",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  peringatan: {
    icon: TriangleAlert,
    ring: "border-amber-500/45",
    iconColor: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  penting: {
    icon: OctagonAlert,
    ring: "border-destructive/45",
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
  // Penutupan instan: state lokal + catatan localStorage (per hari).
  const [hidden, setHidden] = useState<Record<string, true>>({});

  const promo = useMemo(() => bestGlobalPromo(data?.promos), [data?.promos]);
  const promoKey = promo ? `promo:${promo.id}` : null;
  const promoVisible =
    mounted &&
    Boolean(promo && promoKey && !hidden[promoKey] && !dismissedToday(promoKey));
  const banners = useMemo(
    () =>
      mounted
        ? (data?.banners ?? []).filter((b) => !dismissedToday(b.id) && !hidden[b.id])
        : [],
    [data?.banners, mounted, hidden]
  );

  if (!mounted || (!promoVisible && banners.length === 0)) return null;

  const dismiss = (key: string) => {
    markDismissed(key);
    setHidden((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  return createPortal(
    <div
      aria-label="Informasi situs"
      className="pointer-events-none fixed inset-x-0 top-[4.6rem] z-40 flex flex-col items-center gap-2 px-3"
    >
      <AnimatePresence initial={false}>
        {promoVisible && promo && promoKey ? (
          <PromoToast
            key={promoKey}
            title={promo.title}
            percentOff={promo.percentOff}
            endsAt={promo.endsAt}
            onDismiss={() => dismiss(promoKey)}
          />
        ) : null}
        {banners.map((b) => (
          <BannerToast key={b.id} banner={b} onDismiss={() => dismiss(b.id)} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}

/* ── kerangka toast ────────────────────────────────────────────────── */

function ToastShell({
  onDismiss,
  dismissLabel,
  className,
  children,
}: {
  onDismiss: () => void;
  dismissLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      role="status"
      layout
      initial={{ opacity: 0, y: -18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        "pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border bg-card/95 py-2.5 pl-3.5 pr-2 shadow-xl backdrop-blur-md",
        className
      )}
    >
      {children}
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

/* ── marquee: teks menggulir ke kiri saat meluber ───────────────────── */

function Marquee({ text, className }: { text: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLSpanElement>(null);

  // Deteksi luber dilakukan langsung ke DOM (classList) — tanpa state React,
  // jadi tidak ada render ulang dan tidak ada setState-dalam-effect.
  useEffect(() => {
    const wrap = wrapRef.current;
    const main = mainRef.current;
    if (!wrap || !main) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const overflow = main.scrollWidth > wrap.clientWidth + 1;
      const run = overflow && !mq.matches;
      wrap.classList.toggle("run", run);
      if (run) {
        // Kecepatan ~42px/detik, minimal 11 detik sekali putaran.
        const duration = Math.max(11, Math.round(main.scrollWidth / 42));
        wrap.style.setProperty("--marquee-duration", `${duration}s`);
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    ro.observe(main);
    mq.addEventListener("change", sync);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, [text]);

  return (
    <div ref={wrapRef} title={text} className={cn("marquee min-w-0 flex-1", className)}>
      <div className="marquee-track">
        <span ref={mainRef} className="marquee-item marquee-main text-sm leading-snug">
          {text}
        </span>
        <span aria-hidden="true" className="marquee-item marquee-copy text-sm leading-snug">
          {text}
        </span>
      </div>
    </div>
  );
}

/* ── toast promo ───────────────────────────────────────────────────── */

function PromoToast({
  title,
  percentOff,
  endsAt,
  onDismiss,
}: {
  title: string;
  percentOff: number;
  endsAt: string | null;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  const cd = countdownParts(endsAt, now);
  const showCountdown = Boolean(endsAt) && cd.total > 0 && cd.total < 48 * 3600_000;

  return (
    <ToastShell
      onDismiss={onDismiss}
      dismissLabel="Tutup info promo"
      className="border-primary/35 bg-primary/[0.09]"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/15 text-primary"
      >
        <Zap className="h-4 w-4" />
      </span>
      <Marquee text={`${title} — diskon ${percentOff}% berlaku semua game`} />
      {showCountdown ? (
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs font-semibold tabular text-foreground/85">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          <span className="sr-only">Berakhir dalam</span>
          {cd.days > 0 ? `${cd.days}h ` : ""}
          {String(cd.hours).padStart(2, "0")}:{String(cd.minutes).padStart(2, "0")}:
          {String(cd.seconds).padStart(2, "0")}
        </span>
      ) : null}
      <span className="hidden shrink-0 rounded-full bg-primary px-2 py-0.5 font-mono text-xs font-bold tabular text-primary-foreground sm:inline-flex">
        -{percentOff}%
      </span>
    </ToastShell>
  );
}

/* ── toast pengumuman ──────────────────────────────────────────────── */

function BannerToast({
  banner,
  onDismiss,
}: {
  banner: {
    id: string;
    severity: BannerSeverity;
    title: string;
    message: string;
    ctaLabel: string | null;
    ctaHref: string | null;
  };
  onDismiss: () => void;
}) {
  const meta = SEVERITY_META[banner.severity];
  const Icon = meta.icon;
  const cta =
    banner.ctaLabel && banner.ctaHref
      ? banner.ctaHref.startsWith("/")
        ? (
            <RouteLink
              href={banner.ctaHref}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs font-semibold transition-colors hover:border-primary/50 hover:text-primary"
            >
              {banner.ctaLabel}
              <ArrowRight aria-hidden="true" className="h-3 w-3" />
            </RouteLink>
          )
        : (
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
      : null;

  return (
    <ToastShell
      onDismiss={onDismiss}
      dismissLabel="Tutup pengumuman"
      className={meta.ring}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50",
          meta.iconColor
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <Marquee text={`${banner.title} — ${banner.message}`} />
      {cta}
      <span
        className={cn(
          "hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide lg:inline-flex",
          meta.chip
        )}
      >
        <Megaphone aria-hidden="true" className="h-3 w-3" />
        {banner.severity}
      </span>
    </ToastShell>
  );
}
