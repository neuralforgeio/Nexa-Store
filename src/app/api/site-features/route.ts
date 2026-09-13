import { NextRequest } from "next/server";
import { jsonOk } from "@/lib/api/http";
import { readFeatures } from "@/lib/site-features/store";
import { parseAnalytics } from "@/lib/site-features/schema";
import { activeBanners, activePromos, toPublicBanner, toPublicPromo } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Public site-features probe (v1.3.0): active announcement banners + active
 * promo summary + live visitor count. Polled by the storefront shell so
 * banners and pricing stay fresh without a rebuild.
 *
 * A 10-second in-process cache absorbs bursts (many visitors, one warm
 * serverless instance) — data is still runtime-fresh for a storefront whose
 * UI re-polls every 30 seconds. The live count reads analytics directly
 * WITHOUT flushing the event buffer: the public route must stay read-only.
 */

const LIVE_WINDOW_MS = 5 * 60_000;
const CACHE_TTL_MS = 10_000;

type CachedResponse = { at: number; body: Record<string, unknown> };
let cached: CachedResponse | null = null;

function liveCount(recent: number[]): number {
  const now = Date.now();
  return recent.filter((ts) => now - ts < LIVE_WINDOW_MS).length;
}

export async function GET(_req: NextRequest) {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return jsonOk(cached.body);
  }
  try {
    const now = new Date();
    const features = await readFeatures();
    const analytics = parseAnalytics(features.analytics);
    const body = {
      banners: activeBanners(features.banners.banners, now)
        .slice(0, 3)
        .map(toPublicBanner),
      promos: activePromos(features.promos.promos, now).map(toPublicPromo),
      liveVisitors: liveCount(analytics.recent),
    };
    cached = { at: Date.now(), body };
    return jsonOk(body);
  } catch {
    // Never break the storefront over an analytics hiccup.
    const body = { banners: [], promos: [], liveVisitors: 0 };
    return jsonOk(body);
  }
}
