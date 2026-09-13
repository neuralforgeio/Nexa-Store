"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/** Hydration-safe mounted check: false during SSR, true on the client. */
const subscribeNoop = () => () => {};
function useMounted() {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/**
 * Segmented theme control: light / system / dark.
 * Switching rides the View Transitions crossfade when the browser supports it.
 */
const OPTIONS = [
  { value: "light", label: "Tema terang", Icon: Sun },
  { value: "system", label: "Ikuti sistem", Icon: Monitor },
  { value: "dark", label: "Tema gelap", Icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const reducedMotion = useReducedMotion();

  const apply = (next: string) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (!reducedMotion && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => setTheme(next));
    } else {
      setTheme(next);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Pilihan tema"
      className={cn("flex items-center gap-0.5 rounded-full border bg-card/70 p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => apply(value)}
            className="relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {active ? (
              <motion.span
                layoutId={mounted ? "theme-pill" : undefined}
                className="absolute inset-0 rounded-full bg-primary/15"
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 500, damping: 38 }
                }
              />
            ) : null}
            <motion.span
              animate={active ? { scale: 1, rotate: 0 } : { scale: 0.86 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
              className="relative"
            >
              <Icon
                aria-hidden="true"
                className={cn("h-3.5 w-3.5 transition-colors", active && "text-primary")}
              />
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}

/** Compact icon-only variant for the mobile header. */
export function ThemeToggleCompact() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const reducedMotion = useReducedMotion();

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Ganti ke tema terang" : "Ganti ke tema gelap"}
      className="h-8 w-8 rounded-full"
      onClick={() => {
        const next = isDark ? "light" : "dark";
        const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
        if (!reducedMotion && typeof doc.startViewTransition === "function") {
          doc.startViewTransition(() => setTheme(next));
        } else {
          setTheme(next);
        }
      }}
    >
      <motion.span
        key={isDark ? "moon" : "sun"}
        initial={reducedMotion ? false : { rotate: -70, opacity: 0, scale: 0.7 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="flex"
      >
        {isDark ? <Moon aria-hidden="true" className="h-4 w-4" /> : <Sun aria-hidden="true" className="h-4 w-4" />}
      </motion.span>
    </Button>
  );
}
