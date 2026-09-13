"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * History-based SPA router (D1 rev.2). Clean paths: /games, /games/valorant,
 * /login, /admin/products, /dev/git … served by the single storefront route
 * via next.config rewrites. No hash fragments.
 */

export type Route =
  | { view: "home" }
  | { view: "games" }
  | { view: "game"; slug: string }
  | { view: "help" }
  | { view: "login" }
  | { view: "admin"; section: AdminSection }
  | { view: "developer"; section: DeveloperSection }
  | { view: "not-found"; path: string };

export type AdminSection =
  | "dashboard"
  | "games"
  | "categories"
  | "products"
  | "settings"
  | "checkout";

export type DeveloperSection =
  | "dashboard"
  | "access"
  | "control"
  | "git"
  | "data"
  | "diagnostics"
  | "deployment";

const ADMIN_SECTIONS: AdminSection[] = ["dashboard", "games", "categories", "products", "settings", "checkout"];
const DEVELOPER_SECTIONS: DeveloperSection[] = [
  "dashboard",
  "access",
  "control",
  "git",
  "data",
  "diagnostics",
  "deployment",
];

export function parsePath(rawPath: string): Route {
  const clean = rawPath.split("?")[0].replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) return { view: "home" };

  switch (parts[0]) {
    case "games":
      if (parts[1]) return { view: "game", slug: parts[1] };
      return { view: "games" };
    case "help":
      return { view: "help" };
    case "login":
      return { view: "login" };
    case "admin": {
      const section = (parts[1] ?? "dashboard") as AdminSection;
      return { view: "admin", section: ADMIN_SECTIONS.includes(section) ? section : "dashboard" };
    }
    case "dev":
    case "developer": {
      const section = (parts[1] ?? "dashboard") as DeveloperSection;
      return {
        view: "developer",
        section: DEVELOPER_SECTIONS.includes(section) ? section : "dashboard",
      };
    }
    default:
      return { view: "not-found", path: clean };
  }
}

export function routeToPath(route: Route): string {
  switch (route.view) {
    case "home":
      return "/";
    case "games":
      return "/games";
    case "game":
      return `/games/${encodeURIComponent(route.slug)}`;
    case "help":
      return "/help";
    case "login":
      return "/login";
    case "admin":
      return `/admin/${route.section}`;
    case "developer":
      return `/dev/${route.section}`;
    case "not-found":
      return route.path || "/";
  }
}

const NAV_EVENT = "nexa:navigate";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

/** Programmatic navigation (pushState + notify). */
export function navigateTo(path: string, opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return;
  if (opts?.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useAppRoute(): [Route, (to: Route | string, opts?: { replace?: boolean }) => void] {
  // SSR renders the home view; hydration snaps to the real path atomically.
  const path = useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/"
  );
  const route = useMemo(() => parsePath(path), [path]);

  const navigate = useCallback((to: Route | string, opts?: { replace?: boolean }) => {
    navigateTo(typeof to === "string" ? to : routeToPath(to), opts);
  }, []);

  return [route, navigate];
}
