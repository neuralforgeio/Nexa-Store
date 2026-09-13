"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal snap scroller with a scroll-aware edge fade.
 *
 * The fade only covers the side(s) where more content exists: once the user
 * reaches the end, that side's fade (and its darkening effect on cards and
 * their shadows) is fully removed — the last card renders at full strength.
 */
export function EdgeFadeScroller({
  className,
  children,
  ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 2) {
      // Content fits — no fades on either side.
      setAtStart(true);
      setAtEnd(true);
      return;
    }
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft >= max - 2);
  }, [ref]);

  useEffect(() => {
    // rAF defers the first measurement to after layout, off the effect body.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Re-measure when content changes (icons/data arriving shifts scrollWidth).
  useEffect(() => {
    if (!ref || typeof ResizeObserver === "undefined") return;
    const inner = ref.firstElementChild;
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [ref, measure]);

  const fadeLeft = !atStart;
  const fadeRight = !atEnd;

  const mask =
    fadeLeft && fadeRight
      ? "linear-gradient(to right, transparent 0, black 28px, black calc(100% - 28px), transparent 100%)"
      : fadeLeft
        ? "linear-gradient(to right, transparent 0, black 28px, black 100%)"
        : fadeRight
          ? "linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%)"
          : "none";

  return (
    <div
      ref={setRef}
      onScroll={measure}
      role={ariaLabel ? "list" : undefined}
      aria-label={ariaLabel}
      className={cn("no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2", className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  );
}
