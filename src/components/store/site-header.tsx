"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { ThemeToggle, ThemeToggleCompact } from "@/components/shared/theme-toggle";
import { BarcodeScannerDialog } from "@/components/store/barcode/barcode-scanner";
import { useCartUI } from "@/components/store/cart/cart-ui-context";
import { useCartStore } from "@/lib/cart/store";
import { useCatalog } from "@/lib/queries";
import { useAppRoute, type Route } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { cn } from "@/lib/utils";
import { ChevronRight, Flag, Gamepad2, LifeBuoy, Menu, PackageSearch, ScanBarcode, ShoppingCart, X } from "lucide-react";

/**
 * Storefront navigation with the cart entry point. The cart stays visible on
 * mobile (not buried in the menu drawer). The login page is intentionally
 * unlinked: admin/developer reach it by typing /login directly (D7).
 *
 * Desktop nav carries a framer-motion `layoutId` "active pill" that slides
 * between sections (games + game detail → Game, track, reports, help). Mobile
 * opens a right-side drawer dialog: scrim + slide-in panel, ESC to close,
 * body scroll locked while open, staggered item entrance, theme toggle row
 * in the footer. Portaled to <body> so it layers above the z-50 chat widget.
 */
const NAV_LINKS = [
  { href: "/games", label: "Game", Icon: Gamepad2 },
  { href: "/track", label: "Lacak Pesanan", Icon: PackageSearch },
  { href: "/reports", label: "Laporan", Icon: Flag },
  { href: "/help", label: "Bantuan", Icon: LifeBuoy },
] as const;

/** Section aktif untuk indikator nav — halaman detail game tetap menyorot "Game". */
function activeNavHref(view: Route["view"]): (typeof NAV_LINKS)[number]["href"] | null {
  switch (view) {
    case "games":
    case "game":
      return "/games";
    case "track":
      return "/track";
    case "reports":
      return "/reports";
    case "help":
      return "/help";
    default:
      return null;
  }
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [route] = useAppRoute();
  const activeHref = activeNavHref(route.view);
  const { data } = useCatalog();
  const storeName = data?.store.name ?? "Nexa Store";
  const { setOpen: setCartOpen } = useCartUI();
  const cartCount = useCartStore((s) => s.items.length);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Cart count comes from localStorage — only render after mount so server
  // and client HTML match (useSyncExternalStore: false on server, true on
  // client after hydration, without setState-in-effect). Also gates the
  // drawer portal (createPortal must not run during SSR).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // While the drawer is open: ESC closes, body scroll is locked, the dialog
  // receives focus; on close, focus returns to the hamburger (only if it is
  // still inside the drawer). Crossing up to the desktop breakpoint closes it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onBreakpoint = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 768px)");
    document.addEventListener("keydown", onKeyDown);
    mq.addEventListener("change", onBreakpoint);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mq.removeEventListener("change", onBreakpoint);
      document.body.style.overflow = prevOverflow;
      const focused = document.activeElement;
      if (focused === drawerRef.current || drawerRef.current?.contains(focused)) {
        menuButtonRef.current?.focus();
      }
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <RouteLink
          href="/"
          className="group flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
          aria-label={`${storeName}, kembali ke beranda`}
        >
          <BrandMark
            size={32}
            className="transition-transform duration-200 group-hover:-translate-y-0.5"
          />
          <span className="truncate font-display text-base font-semibold uppercase tracking-tight">
            {storeName}
          </span>
        </RouteLink>

        <nav aria-label="Navigasi utama" className="ml-auto flex items-center gap-1">
          {/* Desktop nav — icon links + sliding active pill (layoutId).
              md (768px)+: with icons the 4 links need ~700px — at sm the
              store name would collapse to nothing, so the drawer serves
              640–767px instead. */}
          <ul className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map(({ href, label, Icon }) => {
              const active = activeHref === href;
              return (
                <li key={href}>
                  <RouteLink
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-all duration-200 lg:px-3",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97]",
                      active
                        ? "text-primary"
                        : "text-foreground/75 hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {active ? (
                      reducedMotion ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full border border-primary/30 bg-primary/12"
                        />
                      ) : (
                        <motion.span
                          layoutId="nav-active-pill"
                          aria-hidden="true"
                          transition={{ type: "spring", stiffness: 480, damping: 38 }}
                          className="absolute inset-0 rounded-full border border-primary/30 bg-primary/12 shadow-[0_0_20px_-8px_var(--primary)]"
                        />
                      )
                    ) : null}
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "relative h-4 w-4 transition-all duration-200",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:scale-110 group-hover:text-primary"
                      )}
                    />
                    <span className="relative">{label}</span>
                  </RouteLink>
                </li>
              );
            })}
          </ul>

          {/* Pindai barcode pesanan — selalu tampil, termasuk ponsel. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScanOpen(true)}
            aria-label="Pindai barcode pesanan"
            className="relative ml-1 h-9 w-9 rounded-full"
          >
            <ScanBarcode aria-hidden="true" className="h-4.5 w-4.5" />
          </Button>

          {/* Cart — always visible, including mobile. data-cart-button is
              targeted by the fly-to-cart animation. */}
          <Button
            variant="ghost"
            size="icon"
            data-cart-button
            onClick={() => setCartOpen(true)}
            aria-label={mounted && cartCount > 0 ? `Buka keranjang, ${cartCount} item` : "Buka keranjang"}
            className="relative ml-1 h-9 w-9 rounded-full"
          >
            <ShoppingCart aria-hidden="true" className="h-4.5 w-4.5" />
            <AnimatePresence>
              {mounted && cartCount > 0 ? (
                <motion.span
                  key={cartCount}
                  initial={reducedMotion ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 26 }}
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold leading-none text-primary-foreground shadow-[var(--glow-primary)]"
                >
                  {cartCount > 9 ? "5+" : cartCount}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </Button>

          <div className="hidden md:block">
            <ThemeToggle className="ml-1" />
          </div>
          <div className="md:hidden">
            <ThemeToggleCompact />
          </div>

          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full md:hidden"
            aria-label={open ? "Tutup menu navigasi" : "Buka menu navigasi"}
            aria-expanded={open}
            aria-controls="mobile-navigasi"
            onClick={() => setOpen((v) => !v)}
          >
            <Menu aria-hidden="true" className="h-4.5 w-4.5" />
          </Button>
        </nav>
      </div>

      {/* Mobile drawer — right-side sidebar, portaled to <body> so it sits
          above the z-50 chat widget instead of inside this z-40 header. */}
      {mounted
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key="nav-drawer-root"
                  initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
                  onClick={() => setOpen(false)}
                  aria-hidden="true"
                  className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden"
                >
                  <motion.aside
                    ref={drawerRef}
                    id="mobile-navigasi"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Menu navigasi"
                    tabIndex={-1}
                    onClick={(e) => e.stopPropagation()}
                    initial={reducedMotion ? { opacity: 0 } : { x: "100%" }}
                    animate={reducedMotion ? { opacity: 1 } : { x: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { x: "100%" }}
                    transition={
                      reducedMotion
                        ? { duration: 0 }
                        : { duration: 0.32, ease: [0.32, 0.72, 0, 1] }
                    }
                    className="absolute inset-y-0 right-0 flex h-full w-[78%] max-w-xs flex-col border-l border-border/80 bg-background/98 shadow-2xl outline-none backdrop-blur-xl"
                  >
                    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/80 px-5">
                      <RouteLink
                        href="/"
                        onClick={() => setOpen(false)}
                        className="group flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-label={`${storeName}, kembali ke beranda`}
                      >
                        <BrandMark
                          size={28}
                          className="transition-transform duration-200 group-hover:-translate-y-0.5"
                        />
                        <span className="truncate font-display text-sm font-semibold uppercase tracking-tight">
                          {storeName}
                        </span>
                      </RouteLink>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setOpen(false)}
                        aria-label="Tutup menu navigasi"
                        className="ml-auto h-9 w-9 shrink-0 rounded-full"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>

                    <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
                      <ul className="flex flex-col gap-1">
                        {NAV_LINKS.map(({ href, label, Icon }, i) => {
                          const active = activeHref === href;
                          return (
                            <motion.li
                              key={href}
                              initial={reducedMotion ? false : { opacity: 0, x: 16 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={
                                reducedMotion
                                  ? { duration: 0 }
                                  : { duration: 0.28, ease: "easeOut", delay: 0.06 + i * 0.03 }
                              }
                            >
                              <RouteLink
                                href={href}
                                onClick={() => setOpen(false)}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                  "group flex items-center gap-3 rounded-xl border-l-2 px-3.5 py-3 text-sm font-medium transition-colors",
                                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                  active
                                    ? "border-primary bg-primary/12 text-primary"
                                    : "border-transparent text-foreground/85 hover:bg-accent hover:text-foreground"
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                                    active
                                      ? "bg-primary/15 text-primary"
                                      : "bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                                  )}
                                >
                                  <Icon aria-hidden="true" className="h-4 w-4" />
                                </span>
                                <span className="flex-1 truncate">{label}</span>
                                <ChevronRight
                                  aria-hidden="true"
                                  className={cn(
                                    "h-4 w-4 shrink-0 transition-all duration-200",
                                    active
                                      ? "text-primary/70"
                                      : "text-muted-foreground/50 group-hover:translate-x-0.5 group-hover:text-foreground/70"
                                  )}
                                />
                              </RouteLink>
                            </motion.li>
                          );
                        })}
                      </ul>

                      <div className="mt-3 border-t border-border/60 pt-3">
                        <p className="px-3.5 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                          Alat
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            setScanOpen(true);
                          }}
                          className="group flex w-full items-center gap-3 rounded-xl border-l-2 border-transparent px-3.5 py-3 text-left text-sm font-medium text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                            <ScanBarcode aria-hidden="true" className="h-4 w-4" />
                          </span>
                          <span className="flex-1 truncate">Pindai Barcode</span>
                          <ChevronRight
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground/70"
                          />
                        </button>
                      </div>
                    </nav>

                    <div className="shrink-0 border-t border-border/80 px-5 py-4">
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Tampilan
                        </span>
                        <ThemeToggle />
                      </div>
                    </div>
                  </motion.aside>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}

      {/* Pemindai barcode pesanan — dialog bersama untuk tombol bilah atas
          dan entri drawer. */}
      <BarcodeScannerDialog open={scanOpen} onOpenChange={setScanOpen} />
    </header>
  );
}
