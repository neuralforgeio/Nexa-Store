"use client";

import { useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { ThemeToggle, ThemeToggleCompact } from "@/components/shared/theme-toggle";
import { useCartUI } from "@/components/store/cart/cart-ui-context";
import { useCartStore } from "@/lib/cart/store";
import { useCatalog } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/shared/brand-mark";
import { Flag, Gamepad2, LifeBuoy, Menu, PackageSearch, ShoppingCart, X } from "lucide-react";

/**
 * Storefront navigation with the cart entry point. The cart stays visible on
 * mobile (not buried in the menu). The login page is intentionally unlinked:
 * admin/developer reach it by typing /login directly (D7).
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const { data } = useCatalog();
  const storeName = data?.store.name ?? "Nexa Store";
  const { setOpen: setCartOpen } = useCartUI();
  const cartCount = useCartStore((s) => s.items.length);
  // Cart count comes from localStorage — only render after mount so server
  // and client HTML match (useSyncExternalStore: false on server, true on
  // client after hydration, without setState-in-effect).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const links = [
    { href: "/games", label: "Game", Icon: Gamepad2 },
    { href: "/track", label: "Lacak Pesanan", Icon: PackageSearch },
    { href: "/reports", label: "Laporan", Icon: Flag },
    { href: "/help", label: "Bantuan", Icon: LifeBuoy },
  ];

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
          <div className="hidden items-center gap-1 sm:flex">
            {links.map(({ href, label }) => (
              <Button key={href} variant="ghost" size="sm" className="gap-1.5" asChild>
                <RouteLink href={href}>{label}</RouteLink>
              </Button>
            ))}
          </div>

          {/* Cart — always visible, including mobile. */}
          <Button
            variant="ghost"
            size="icon"
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

          <div className="hidden sm:block">
            <ThemeToggle className="ml-1" />
          </div>
          <div className="sm:hidden">
            <ThemeToggleCompact />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full sm:hidden"
            aria-label={open ? "Tutup menu" : "Buka menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" className="h-4 w-4" /> : <Menu aria-hidden="true" className="h-4 w-4" />}
          </Button>
        </nav>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.nav
            key="mobile-nav"
            initial={reducedMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            aria-label="Navigasi utama"
            className="overflow-hidden border-t border-border/80 bg-background/95 backdrop-blur-md sm:hidden"
          >
            <ul className="space-y-1 px-4 py-3">
              {links.map(({ href, label, Icon }) => (
                <li key={href}>
                  <RouteLink
                    href={href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                    {label}
                  </RouteLink>
                </li>
              ))}
            </ul>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
