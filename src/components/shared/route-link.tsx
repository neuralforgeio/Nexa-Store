"use client";

import { forwardRef } from "react";
import { navigateTo } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Anchor-based SPA navigation: real href (middle-click, copy link, SEO),
 * intercepted left-click for pushState transitions.
 */
export const RouteLink = forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & { replace?: boolean }
>(function RouteLink({ href, replace, onClick, className, ...props }, ref) {
  return (
    <a
      ref={ref}
      href={href}
      className={cn(className)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !href) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigateTo(href, { replace });
      }}
      {...props}
    />
  );
});
