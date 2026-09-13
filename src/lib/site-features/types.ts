/**
 * Site-features domain types (v1.3.0): promos, banners, schedules, live chat,
 * analytics. Client-safe (no node/next imports) — shared by storefront UI,
 * developer panel, API routes, and the Telegram bot's view of the data.
 */

// ---------------------------------------------------------------------------
// Promo engine
// ---------------------------------------------------------------------------

export type PromoEvent = {
  id: string;
  title: string;
  /** global = semua game; game = satu game (gameId). */
  scope: "global" | "game";
  gameId?: string;
  /** Potongan harga 1–90 persen. */
  percentOff: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string;
};

/** Bentuk promo yang aman untuk pengunjung (tanpa metadata internal). */
export type PublicPromo = {
  id: string;
  title: string;
  scope: "global" | "game";
  gameId: string | null;
  percentOff: number;
  endsAt: string | null;
};

// ---------------------------------------------------------------------------
// Announcement banners
// ---------------------------------------------------------------------------

export type BannerSeverity = "info" | "sukses" | "peringatan" | "penting";

export type BannerRecord = {
  id: string;
  severity: BannerSeverity;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
};

export type PublicBanner = {
  id: string;
  severity: BannerSeverity;
  title: string;
  message: string;
  ctaLabel: string | null;
  ctaHref: string | null;
};

// ---------------------------------------------------------------------------
// Scheduled tasks (executor lives in the Telegram bot service)
// ---------------------------------------------------------------------------

export type ScheduleTaskType =
  | "maintenance-on"
  | "maintenance-off"
  | "lockdown-on"
  | "lockdown-off"
  | "banner-on"
  | "banner-off"
  | "promo-on"
  | "promo-off"
  | "announcement-set"
  | "reminder";

export type ScheduleTaskStatus = "pending" | "done" | "failed" | "cancelled";

export type ScheduleTask = {
  id: string;
  label: string;
  type: ScheduleTaskType;
  /** Argumen per tipe: note/reason (gate), bannerId/promoId, text (reminder/announcement), scope+routes. */
  payload: {
    note?: string;
    bannerId?: string;
    promoId?: string;
    text?: string;
    scope?: "all" | "routes";
    routes?: string[];
  };
  runAt: string;
  status: ScheduleTaskStatus;
  createdAt: string;
  createdBy: string;
  lastResult?: string;
  completedAt?: string;
};

// ---------------------------------------------------------------------------
// Live chat
// ---------------------------------------------------------------------------

export type ChatMessage = {
  id: string;
  from: "user" | "owner";
  text: string;
  at: string;
};

export type ChatConversation = {
  id: string;
  name: string | null;
  createdAt: string;
  messages: ChatMessage[];
  lastMessageAt: string;
  unreadByOwner: number;
  ownerLastReadAt: string | null;
};

/** Ringkasan percakapan untuk daftar di panel/bot. */
export type ConversationSummary = {
  id: string;
  name: string | null;
  createdAt: string;
  lastMessageAt: string;
  unreadByOwner: number;
  messageCount: number;
  lastText: string;
  lastFrom: "user" | "owner" | null;
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type AnalyticsDayStat = {
  views: number;
  uniques: number;
  byPath: Record<string, number>;
  byReferrer: Record<string, number>;
  byDevice: Record<string, number>;
  events: Record<string, number>;
};

export type AnalyticsFile = {
  days: Record<string, AnalyticsDayStat>;
  /** tokenHash → tanggal (WIB) kunjungan terakhir — untuk hitung uniques. */
  visitors: Record<string, string>;
  /** Timestamp pageview terakhir (epoch ms) — dipangkas; untuk pengunjung live. */
  recent: number[];
};

export type AnalyticsSummary = {
  today: AnalyticsDayStat;
  last7: AnalyticsDayStat;
  last30: AnalyticsDayStat;
  series: Array<{ date: string; views: number; uniques: number }>;
  topPages: Array<{ path: string; views: number }>;
  topReferrers: Array<{ referrer: string; views: number }>;
  devices: Array<{ device: string; views: number }>;
  live: number;
  totalViews: number;
};

// ---------------------------------------------------------------------------
// Window helpers (shared client/server)
// ---------------------------------------------------------------------------

/** Apakah event berjendela waktu (promo/banner) sedang berlaku sekarang. */
export function isWithinWindow(now: Date, startsAt: string | null, endsAt: string | null): boolean {
  if (startsAt && now.getTime() < Date.parse(startsAt)) return false;
  if (endsAt && now.getTime() >= Date.parse(endsAt)) return false;
  return true;
}

export function activePromos(promos: PromoEvent[], now: Date = new Date()): PromoEvent[] {
  return promos.filter(
    (p) => p.active && isWithinWindow(now, p.startsAt, p.endsAt)
  );
}

export function activeBanners(banners: BannerRecord[], now: Date = new Date()): BannerRecord[] {
  return banners.filter((b) => b.enabled && isWithinWindow(now, b.startsAt, b.endsAt));
}

export function toPublicPromo(p: PromoEvent): PublicPromo {
  return {
    id: p.id,
    title: p.title,
    scope: p.scope,
    gameId: p.gameId ?? null,
    percentOff: p.percentOff,
    endsAt: p.endsAt,
  };
}

export function toPublicBanner(b: BannerRecord): PublicBanner {
  return {
    id: b.id,
    severity: b.severity,
    title: b.title,
    message: b.message,
    ctaLabel: b.ctaLabel ?? null,
    ctaHref: b.ctaHref ?? null,
  };
}
