import { z } from "zod";
import type { AnalyticsFile, AnalyticsDayStat } from "./types";

/**
 * Zod schemas for the site-features data files. Every read from persistence
 * passes through here; unknown/absent files bootstrap to safe defaults.
 */

export const promoEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(3).max(60),
  scope: z.enum(["global", "game"]),
  gameId: z.string().min(1).optional(),
  percentOff: z.number().int().min(1).max(90),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
});

export const bannerRecordSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "sukses", "peringatan", "penting"]),
  title: z.string().min(3).max(80),
  message: z.string().min(3).max(300),
  ctaLabel: z.string().min(2).max(30).optional(),
  ctaHref: z.string().min(1).max(300).optional(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
});

export const scheduleTaskSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(3).max(80),
  type: z.enum([
    "maintenance-on",
    "maintenance-off",
    "lockdown-on",
    "lockdown-off",
    "banner-on",
    "banner-off",
    "promo-on",
    "promo-off",
    "announcement-set",
    "reminder",
  ]),
  payload: z.object({
    note: z.string().max(300).optional(),
    bannerId: z.string().min(1).optional(),
    promoId: z.string().min(1).optional(),
    text: z.string().max(500).optional(),
    scope: z.enum(["all", "routes"]).optional(),
    routes: z.array(z.string()).max(12).optional(),
  }),
  runAt: z.string().datetime(),
  status: z.enum(["pending", "done", "failed", "cancelled"]),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  lastResult: z.string().max(500).optional(),
  completedAt: z.string().datetime().optional(),
});

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  from: z.enum(["user", "owner"]),
  text: z.string().min(1).max(800),
  at: z.string().datetime(),
});

export const chatConversationSchema = z.object({
  id: z.string().min(6).max(64),
  name: z.string().min(1).max(40).nullable(),
  createdAt: z.string().datetime(),
  messages: z.array(chatMessageSchema).max(400),
  lastMessageAt: z.string().datetime(),
  unreadByOwner: z.number().int().min(0),
  ownerLastReadAt: z.string().datetime().nullable(),
});

const dayStatSchema = z.object({
  views: z.number().int().min(0),
  uniques: z.number().int().min(0),
  byPath: z.record(z.string(), z.number().int().min(0)),
  byReferrer: z.record(z.string(), z.number().int().min(0)),
  byDevice: z.record(z.string(), z.number().int().min(0)),
  events: z.record(z.string(), z.number().int().min(0)),
});

export const analyticsFileSchema = z.object({
  days: z.record(z.string(), dayStatSchema),
  visitors: z.record(z.string(), z.string()),
  recent: z.array(z.number().int().min(0)),
});

export const promosFileSchema = z.object({ promos: z.array(promoEventSchema) });
export const bannersFileSchema = z.object({ banners: z.array(bannerRecordSchema) });
export const schedulesFileSchema = z.object({ tasks: z.array(scheduleTaskSchema) });
export const chatFileSchema = z.object({ conversations: z.array(chatConversationSchema).max(50) });

/**
 * State bot Telegram (v1.4.0) — dipakai runtime webhook serverless untuk
 * menyimpan pairing pemilik secara permanen (write-through GitHub di produksi).
 * TIDAK ikut bundle publik /api/site-features — hanya dibaca route webhook.
 */
export const botStateFileSchema = z.object({
  owner: z
    .object({
      userId: z.number().int(),
      chatId: z.number().int(),
      pairedAt: z.string().datetime(),
    })
    .nullable(),
});

export type PromosFile = z.infer<typeof promosFileSchema>;
export type BannersFile = z.infer<typeof bannersFileSchema>;
export type SchedulesFile = z.infer<typeof schedulesFileSchema>;
export type ChatFile = z.infer<typeof chatFileSchema>;
export type BotStateFile = z.infer<typeof botStateFileSchema>;
export type ReportsFile = z.infer<typeof reportsFileSchema>;
export type OrdersFile = z.infer<typeof ordersFileSchema>;
export type PushSubsFile = z.infer<typeof pushSubsFileSchema>;

/**
 * Laporan pengguna (v1.6.0) — bug / saran fitur / lainnya. Metadata saja;
 * lampiran media (gambar/video) diteruskan langsung ke Telegram pemilik.
 */
export const reportRecordSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["bug", "feature", "other"]),
  name: z.string().min(1).max(40).nullable(),
  text: z.string().min(1).max(1500),
  media: z
    .object({
      kind: z.enum(["image", "video"]),
      mime: z.string().min(3).max(60),
      size: z.number().int().min(1),
      fileName: z.string().min(1).max(120),
    })
    .nullable(),
  createdAt: z.string().datetime(),
});

/**
 * Pesanan terlacak (v1.6.0) — dibuat saat checkout (instan/keranjang),
 * status diperbarui admin/developer dari bot Telegram (/lacak-order).
 */
export const orderItemSchema = z.object({
  gameName: z.string().min(1).max(80),
  productName: z.string().min(1).max(120),
  price: z.number().int().min(0),
});

export const orderHistorySchema = z.object({
  status: z.enum(["pending", "processing", "success", "cancel"]),
  at: z.string().datetime(),
  reason: z.string().max(500).nullable(),
});

export const orderRecordSchema = z.object({
  id: z.string().regex(/^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/),
  source: z.enum(["instant", "cart"]),
  summary: z.string().min(1).max(200),
  customerName: z.string().min(1).max(80).nullable(),
  items: z.array(orderItemSchema).max(20),
  total: z.number().int().min(0),
  status: z.enum(["pending", "processing", "success", "cancel"]),
  statusReason: z.string().max(500).nullable(),
  statusUpdatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  history: z.array(orderHistorySchema).max(30),
});

/** Langganan push notification per percakapan chat (v1.6.0). */
export const pushSubSchema = z.object({
  endpoint: z.string().url().max(500),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(200),
  name: z.string().max(40).nullable(),
  at: z.string().datetime(),
});

export const reportsFileSchema = z.object({ reports: z.array(reportRecordSchema).max(200) });
export const ordersFileSchema = z.object({ orders: z.array(orderRecordSchema).max(300) });
export const pushSubsFileSchema = z.object({ subs: z.record(z.string(), pushSubSchema) });

// ---------------------------------------------------------------------------
// Defaults + safe parsers (bad data degrades to empty, never 500s the store)
// ---------------------------------------------------------------------------

export const EMPTY_PROMOS: PromosFile = { promos: [] };
export const EMPTY_BANNERS: BannersFile = { banners: [] };
export const EMPTY_SCHEDULES: SchedulesFile = { tasks: [] };
export const EMPTY_CHAT: ChatFile = { conversations: [] };
export const EMPTY_ANALYTICS: AnalyticsFile = { days: {}, visitors: {}, recent: [] };
export const EMPTY_BOT_STATE: BotStateFile = { owner: null };
export const EMPTY_REPORTS: ReportsFile = { reports: [] };
export const EMPTY_ORDERS: OrdersFile = { orders: [] };
export const EMPTY_PUSH_SUBS: PushSubsFile = { subs: {} };

export function parsePromos(raw: unknown): PromosFile {
  const parsed = promosFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_PROMOS;
}
export function parseBanners(raw: unknown): BannersFile {
  const parsed = bannersFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_BANNERS;
}
export function parseSchedules(raw: unknown): SchedulesFile {
  const parsed = schedulesFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_SCHEDULES;
}
export function parseChat(raw: unknown): ChatFile {
  const parsed = chatFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_CHAT;
}
export function parseAnalytics(raw: unknown): AnalyticsFile {
  const parsed = analyticsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_ANALYTICS;
}
export function parseReports(raw: unknown): ReportsFile {
  const parsed = reportsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_REPORTS;
}
export function parseOrders(raw: unknown): OrdersFile {
  const parsed = ordersFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_ORDERS;
}
export function parsePushSubs(raw: unknown): PushSubsFile {
  const parsed = pushSubsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_PUSH_SUBS;
}

export function emptyDayStat(): AnalyticsDayStat {
  return { views: 0, uniques: 0, byPath: {}, byReferrer: {}, byDevice: {}, events: {} };
}
