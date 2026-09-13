"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteLink } from "@/components/shared/route-link";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import { BlockedAdminDialog } from "@/components/shared/blocked-admin-dialog";
import { api, ApiError } from "@/lib/api-client";
import { useCatalog } from "@/lib/queries";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/lib/catalog/types";
import { ArrowLeft, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Management login (hidden route: /login is deliberately unlinked, D7).
 * Standalone page: no storefront header or footer.
 *
 * The brand panel renders the store itself as tilted, dark-lit artwork:
 * a miniature of the storefront plus floating product cards from the live
 * catalog, so the panel always feels like the site, not a stock illustration.
 */

type ShowcaseItem = {
  key: string;
  name: string;
  image?: string | null;
  denomination: string;
  priceIdr: number;
};

/**
 * Login layout is pinned to the viewport: the page itself never scrolls
 * (h-dvh + overflow-hidden). Only the form column may scroll internally on
 * very short screens (e.g. with a mobile keyboard up) — the page stays put.
 * Brand-panel sections adapt their height via clamp() so nothing clips on
 * laptop viewports (~660px usable height).
 */


const FALLBACK_SHOWCASE: ShowcaseItem[] = [
  { key: "f-1", name: "Valorant", denomination: "2050 Points", priceIdr: 220000 },
  { key: "f-2", name: "PUBG Mobile", denomination: "660 UC", priceIdr: 161000 },
  { key: "f-3", name: "Genshin Impact", denomination: "980 Genesis Crystals", priceIdr: 270000 },
];

export function LoginView({ onAuthenticated }: { onAuthenticated: (role: Role) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ reason: string | null } | null>(null);
  const qc = useQueryClient();
  const reducedMotion = useReducedMotion();
  const { data: catalog } = useCatalog();

  // Real products for the tilted showcase cards (fallback keeps the panel
  // composed even before the catalog resolves).
  const showcase = useMemo<ShowcaseItem[]>(() => {
    if (!catalog || catalog.games.length === 0) return FALLBACK_SHOWCASE;
    const games = [...catalog.games].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 3);
    const items: ShowcaseItem[] = [];
    for (const game of games) {
      const products = catalog.products
        .filter((p) => p.gameId === game.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const pick = products[Math.min(2, products.length - 1)];
      if (!pick) continue;
      items.push({
        key: pick.id,
        name: game.name,
        image: game.image,
        denomination: `${pick.denomination} ${pick.name}`,
        priceIdr: pick.priceIdr,
      });
    }
    return items.length >= 1 ? items : FALLBACK_SHOWCASE;
  }, [catalog]);

  const login = useMutation({
    mutationFn: () => api.post<{ role: Role; email: string }>("/api/auth/login", { email, password }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["session"] });
      toast.success("Berhasil masuk", {
        description: "Dashboard siap digunakan.",
      });
      onAuthenticated(data.role);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "admin-blocked") {
        // Blocked Admins get the full-screen blocking modal, not an inline
        // error line — the Developer's reason is shown inside it (D8).
        const reason = typeof e.extra?.reason === "string" ? (e.extra.reason as string) : null;
        setBlocked({ reason });
        setError(null);
        return;
      }
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Tidak dapat masuk saat ini. Coba lagi.");
      }
    },
  });

  const [floatMain, floatA, floatB] = [showcase[0] ?? FALLBACK_SHOWCASE[0], showcase[1] ?? FALLBACK_SHOWCASE[1], showcase[2] ?? FALLBACK_SHOWCASE[2]];

  return (
    <main id="main" className="grid h-dvh grid-cols-1 overflow-hidden lg:grid-cols-2">
      {/* Blocked-Admin modal (skull + block, with the Developer's reason). */}
      <BlockedAdminDialog
        open={blocked !== null}
        onOpenChange={(open) => {
          if (!open) setBlocked(null);
        }}
        reason={blocked?.reason ?? null}
      />

      {/* Brand panel — the store rendered as tilted, dark-lit artwork. */}
      <section
        aria-hidden="true"
        className="bg-atmosphere relative hidden flex-col overflow-hidden border-r border-border/70 p-8 xl:p-10 lg:flex"
      >
        {/* Dark-lighting layers */}
        <div className="bg-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(75%_75%_at_30%_25%,black,transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_22%_18%,oklch(0.83_0.152_82_/_0.10),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_130%_at_50%_45%,transparent_38%,oklch(0.14_0.01_260_/_0.86)_100%)]" />
        {/* Giant tilted watermark */}
        <span className="absolute -right-10 top-16 rotate-[14deg] select-none font-display text-[19rem] font-bold leading-none tracking-tighter text-foreground/[0.035]">
          N
        </span>

        <div className="relative flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 font-display text-base font-bold text-primary-foreground shadow-[var(--glow-primary)]">
            N
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-tight">Nexa Store</span>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col justify-center py-5">
          {/* Headline */}
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <div className="mb-5 flex h-13 w-13 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-card">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <p className="font-display text-balance text-2xl font-bold leading-tight tracking-tight xl:text-3xl">
              Panel kelola katalog dan pengaturan store.
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Harga, game, dan template pesanan dikelola dari satu tempat.
              Setiap perubahan tercatat dan bisa ditinjau ulang.
            </p>
          </motion.div>

          {/* Tilting store showcase — height adapts to the viewport so the
              panel never overflows (login page is pinned, no page scroll). */}
          <div className="relative mt-8 h-[clamp(10.5rem,25vh,16rem)]">
            {/* Mini storefront window — tilted, dark-lit */}
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 24, rotate: -9 }}
              animate={{ opacity: 1, y: 0, rotate: -4.5 }}
              transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
              className="absolute left-0 top-3 w-[78%]"
            >
              <motion.div
                animate={reducedMotion ? undefined : { y: [0, -7, 0] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                className="overflow-hidden rounded-xl border border-border/80 bg-card/95 shadow-pop backdrop-blur"
              >
                {/* browser chrome */}
                <div className="flex items-center gap-2 border-b border-border/70 bg-surface-2/80 px-3 py-2">
                  <span className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-foreground/15" />
                    <span className="h-2 w-2 rounded-full bg-foreground/15" />
                    <span className="h-2 w-2 rounded-full bg-foreground/15" />
                  </span>
                  <span className="ml-1 flex-1 truncate rounded-full border border-border/70 bg-background/60 px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    nexastoregame.vercel.app
                  </span>
                </div>
                {/* mini hero */}
                <div className="relative p-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <span className="h-1 w-1 rounded-full bg-primary" />
                    Store aktif
                  </span>
                  <p className="mt-2 font-display text-sm font-bold leading-snug">
                    Top up game, langsung lewat WhatsApp.
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">
                      Lihat game
                    </span>
                    <span className="rounded-md border border-border/80 px-2 py-1 text-[10px] text-muted-foreground">
                      Cara pesan
                    </span>
                  </div>
                  <div className="mt-3.5 flex items-center gap-2.5 border-t border-border/60 pt-3">
                    {showcase.map((item) => (
                      <GameMark key={item.key} name={item.name} image={item.image} size="sm" />
                    ))}
                  </div>
                  {/* slow sheen sweep */}
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
                    initial={false}
                    animate={reducedMotion ? undefined : { x: [-140, 420] }}
                    transition={{ duration: 4.2, repeat: Infinity, repeatDelay: 3.4, ease: "easeInOut" }}
                  />
                </div>
              </motion.div>
            </motion.div>

            {/* Floating tilted product cards */}
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 30, rotate: 12 }}
              animate={{ opacity: 1, y: 0, rotate: 6 }}
              transition={{ duration: 0.45, delay: 0.38, ease: "easeOut" }}
              className="absolute right-0 top-0 w-[46%]"
            >
              <motion.div
                animate={reducedMotion ? undefined : { y: [0, -9, 0] }}
                transition={{ duration: 5.6, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                className="rounded-xl border border-border/80 bg-card/95 p-3 shadow-pop backdrop-blur"
              >
                <div className="flex items-center gap-2">
                  <GameMark name={floatA.name} image={floatA.image} size="sm" />
                  <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {floatA.name}
                  </span>
                </div>
                <p className="mt-1.5 truncate font-display text-xs font-semibold leading-tight">
                  {floatA.denomination}
                </p>
                <PriceTag value={floatA.priceIdr} size="sm" />
              </motion.div>
            </motion.div>

            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 30, rotate: -14 }}
              animate={{ opacity: 1, y: 0, rotate: -8 }}
              transition={{ duration: 0.45, delay: 0.55, ease: "easeOut" }}
              className="absolute bottom-0 left-[26%] w-[47%]"
            >
              <motion.div
                animate={reducedMotion ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 6.4, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
                className="rounded-xl border border-border/80 bg-card/95 p-3 shadow-pop backdrop-blur"
              >
                <div className="flex items-center gap-2">
                  <GameMark name={floatB.name} image={floatB.image} size="sm" />
                  <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {floatB.name}
                  </span>
                </div>
                <p className="mt-1.5 truncate font-display text-xs font-semibold leading-tight">
                  {floatB.denomination}
                </p>
                <PriceTag value={floatB.priceIdr} size="sm" />
              </motion.div>
            </motion.div>
          </div>

          {/* Feature bullets — hidden on short viewports so the pinned
              panel keeps breathing room. */}
          <ul className="mt-8 hidden space-y-3 [@media(min-height:46rem)]:block">
            {[
              "Perubahan katalog tersimpan sebagai riwayat",
              "Harga dan nominal diedit langsung dari panel",
              "Template pesanan WhatsApp bisa disesuaikan",
            ].map((item, i) => (
              <motion.li
                key={item}
                initial={reducedMotion ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.65 + i * 0.09, ease: "easeOut" }}
                className="flex items-start gap-2.5 text-sm text-foreground/80"
              >
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {item}
              </motion.li>
            ))}
          </ul>
        </div>

        {/* Security note — same type scale and icon alignment as the feature
            bullets above, framed as a deliberate footer strip. */}
        <div className="relative shrink-0">
          <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-surface-2/40 px-3 py-2">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm text-foreground/75">Sesi terlindungi cookie bertanda tangan server.</p>
          </div>
        </div>
      </section>

      {/* Form panel — the only column that may scroll (internally, e.g. with
          a mobile keyboard up). The page itself never moves. */}
      <section className="relative flex items-center justify-center overflow-y-auto overscroll-contain p-6 sm:p-10">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/80 font-display text-base font-bold text-primary-foreground shadow-[var(--glow-primary)]">
              N
            </span>
            <span className="font-display text-base font-semibold uppercase tracking-tight">Nexa Store</span>
          </div>

          <h1 className="font-display text-2xl font-bold tracking-tight">Masuk ke dashboard</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Halaman khusus pengelola Nexa Store.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              login.mutate();
            }}
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="nama@store.id"
                className="h-11"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Password akun dashboard"
                  className="h-11 pr-11"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan password" : "Lihat password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <Eye aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p aria-hidden="true" className="text-[11px] text-muted-foreground/60">
                Cek kembali password sebelum masuk — mata di kanan kolom membantu lihat typo.
              </p>
            </div>

            {error ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                id="login-error"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                {error}
              </motion.p>
            ) : null}

            <Button type="submit" size="lg" className="w-full font-semibold" disabled={login.isPending}>
              {login.isPending ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Masuk
            </Button>
          </form>

          <RouteLink
            href="/"
            className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Kembali ke store
          </RouteLink>
        </motion.div>
      </section>
    </main>
  );
}
