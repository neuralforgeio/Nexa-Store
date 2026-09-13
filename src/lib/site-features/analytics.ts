import { updateFeature, readFeature } from "./store";
import { emptyDayStat, parseAnalytics } from "./schema";
import type { AnalyticsDayStat, AnalyticsFile, AnalyticsSummary } from "./types";

/**
 * Analytics engine (v1.3.0) — first-party, cookie-light visitor tracking.
 *
 * Events are buffered in memory and flushed in batches so a page view never
 * costs a GitHub call. Buckets use WIB (Asia/Jakarta) days because the store
 * owner reads the numbers in their own timezone.
 */

const FLUSH_BATCH = 30;
const FLUSH_AGE_MS = 8000;
const LIVE_WINDOW_MS = 5 * 60_000;
const KEEP_DAYS = 45;
const VISITOR_CAP = 20000;
const RECENT_CAP = 400;

export type TrackEvent = {
  type: "view" | "chat_open" | "order_click" | "wa_handoff";
  path: string;
  referrer?: string;
  device?: "mobile" | "desktop";
  tokenHash: string;
};

/** WIB day key (Asia/Jakarta = UTC+7 fixed, no DST). */
export function wibDayKey(date: Date = new Date()): string {
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

function wibDaysAgo(n: number): string[] {
  const out: string[] = [];
  const today = wibDayKey();
  const [y, m, d] = today.split("-").map(Number);
  for (let i = n; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - i);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

const pending: TrackEvent[] = [];
let firstPendingAt = 0;
let flushing = false;

export function trackEvent(event: TrackEvent): void {
  pending.push(event);
  if (firstPendingAt === 0) firstPendingAt = Date.now();
  // Opportunistic flush — serverless functions may freeze at any moment, so
  // the timer below is a best effort, never the only path.
  if (pending.length >= FLUSH_BATCH || Date.now() - firstPendingAt >= FLUSH_AGE_MS) {
    void flushAnalytics().catch(() => undefined);
  }
}

export async function flushAnalytics(force = false): Promise<number> {
  if (flushing) return 0;
  if (pending.length === 0 && !force) return 0;
  flushing = true;
  const batch = pending.splice(0, pending.length);
  firstPendingAt = 0;
  try {
    await applyEvents(batch);
    return batch.length;
  } finally {
    flushing = false;
  }
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function referrerKey(raw: string | undefined): string {
  if (!raw) return "langsung";
  try {
    const url = new URL(raw);
    return url.hostname.replace(/^www\./, "") || "langsung";
  } catch {
    return "lainnya";
  }
}

async function applyEvents(batch: TrackEvent[]): Promise<void> {
  if (batch.length === 0) return;
  await updateFeature(
    "analytics",
    "analytics: track events",
    (currentRaw) => {
      const file = parseAnalytics(currentRaw);
      const days = { ...file.days };
      const visitors = { ...file.visitors };
      const recent = [...file.recent];

      for (const e of batch) {
        if (!e.type || typeof e.path !== "string") continue;
        const day = wibDayKey();
        const stat: AnalyticsDayStat = days[day] ?? emptyDayStat();
        if (e.type === "view") {
          stat.views += 1;
          bump(stat.byPath, e.path.slice(0, 80));
          bump(stat.byReferrer, referrerKey(e.referrer));
          bump(stat.byDevice, e.device === "desktop" ? "desktop" : "mobile");
          if (visitors[e.tokenHash] !== day) {
            stat.uniques += 1;
            visitors[e.tokenHash] = day;
          }
          recent.push(Date.now());
        } else {
          bump(stat.events, e.type);
        }
        days[day] = stat;
      }

      // Prune: old days, visitor map, live window.
      const cutoff = wibDaysAgo(KEEP_DAYS)[0];
      for (const key of Object.keys(days)) {
        if (key < cutoff) delete days[key];
      }
      let visitorKeys = Object.keys(visitors);
      if (visitorKeys.length > VISITOR_CAP) {
        const sorted = visitorKeys.sort((a, b) => (visitors[a] < visitors[b] ? -1 : 1));
        for (const key of sorted.slice(0, visitorKeys.length - VISITOR_CAP)) delete visitors[key];
        visitorKeys = Object.keys(visitors);
      }

      const next: AnalyticsFile = {
        days,
        visitors,
        recent: recent.slice(-RECENT_CAP),
      };
      return next;
    },
    true
  );
}

// ---------------------------------------------------------------------------
// Summary (developer dashboard + bot digest)
// ---------------------------------------------------------------------------

function sumStats(stats: AnalyticsDayStat[]): AnalyticsDayStat {
  const out = emptyDayStat();
  for (const s of stats) {
    out.views += s.views;
    out.uniques += s.uniques;
    for (const [k, v] of Object.entries(s.byPath)) bump(out.byPath, k, v);
    for (const [k, v] of Object.entries(s.byReferrer)) bump(out.byReferrer, k, v);
    for (const [k, v] of Object.entries(s.byDevice)) bump(out.byDevice, k, v);
    for (const [k, v] of Object.entries(s.events)) bump(out.events, k, v);
  }
  return out;
}

export async function analyticsSummary(): Promise<AnalyticsSummary> {
  await flushAnalytics(true).catch(() => undefined);
  const raw = await readFeature("analytics");
  const file = parseAnalytics(raw);
  const dayList = wibDaysAgo(29); // 30 hari termasuk hari ini

  const series = dayList.map((date) => ({
    date,
    views: file.days[date]?.views ?? 0,
    uniques: file.days[date]?.uniques ?? 0,
  }));

  const pick = (dates: string[]) => sumStats(dates.map((d) => file.days[d] ?? emptyDayStat()));
  const todayKey = wibDayKey();
  const last7Stats = pick(wibDaysAgo(6));
  const last30Stats = pick(wibDaysAgo(29));

  const top = (map: Record<string, number>) =>
    Object.entries(map)
      .map(([key, views]) => ({ key, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 8);

  return {
    today: pick([todayKey]),
    last7: last7Stats,
    last30: last30Stats,
    series,
    topPages: top(last30Stats.byPath).map(({ key, views }) => ({ path: key, views })),
    topReferrers: top(last30Stats.byReferrer).map(({ key, views }) => ({ referrer: key, views })),
    devices: top(last30Stats.byDevice).map(({ key, views }) => ({ device: key, views })),
    live: file.recent.filter((ts) => Date.now() - ts < LIVE_WINDOW_MS).length,
    totalViews: last30Stats.views,
  };
}
