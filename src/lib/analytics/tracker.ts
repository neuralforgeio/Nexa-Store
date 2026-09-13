"use client";

/**
 * Client analytics tracker (v1.3.0) — first-party, privacy-light.
 *
 * - Visitor token: random 32-hex generated once per browser (localStorage).
 *   The server stores only a salted hash — no fingerprinting, no PII.
 * - Page views are batched per tick and sent with keepalive; a visibility
 *   change flushes the queue via sendBeacon so the last views survive.
 * - `track()` is exported for interaction events (chat open, WA handoff).
 */

const TOKEN_KEY = "nexa.analytics.token";
const QUEUE_FLUSH_MS = 2500;

export type TrackType = "view" | "chat_open" | "order_click" | "wa_handoff";
type QueuedEvent = { type: TrackType; path: string; referrer?: string; device?: "mobile" | "desktop" };

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function analyticsVisitorToken(): string {
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    return "00000000000000000000000000000000";
  }
}

function deviceKind(): "mobile" | "desktop" {
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}

function flush(): void {
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  const body = JSON.stringify({ events, visitor: analyticsVisitorToken() });
  // sendBeacon survives navigation; fall back to keepalive fetch.
  if (typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/analytics/track", blob)) return;
  }
  void fetch("/api/analytics/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, QUEUE_FLUSH_MS);
}

export function track(type: TrackType, path?: string): void {
  if (typeof window === "undefined") return;
  queue.push({
    type,
    path: (path ?? window.location.pathname).slice(0, 120),
    ...(type === "view" ? { referrer: document.referrer || undefined, device: deviceKind() } : {}),
  });
  schedule();
}

/** Install the visibility flush — called once from the storefront shell. */
export function installAnalyticsFlush(): () => void {
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    document.removeEventListener("visibilitychange", onHide);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
  };
}
