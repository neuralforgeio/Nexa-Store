import { NextRequest, after } from "next/server";
import { z } from "zod";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { updateFeature } from "@/lib/site-features/store";
import { generateOrderReference } from "@/lib/cart/message";
import { sendOwnerOrderNotification } from "@/lib/telegram-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pesanan baru (v1.6.0) — dipanggil storefront sebelum membuka WhatsApp.
 * Membuat rekaman terlacak dengan ID NEXA-YYMMDD-XXXX, lalu mem-notifikasi
 * Telegram pemilik lengkap dengan tombol status (ord:<id>:<status>).
 */

const createSchema = z.object({
  reference: z.string().regex(/^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/).optional(),
  source: z.enum(["instant", "cart"]),
  summary: z.string().trim().min(1).max(200),
  customerName: z.string().trim().max(80).optional(),
  items: z
    .array(
      z.object({
        gameName: z.string().trim().min(1).max(80),
        productName: z.string().trim().min(1).max(120),
        price: z.number().int().min(0),
      })
    )
    .min(1)
    .max(20),
  total: z.number().int().min(0),
});

export type OrderRecord = {
  id: string;
  source: "instant" | "cart";
  summary: string;
  customerName: string | null;
  items: Array<{ gameName: string; productName: string; price: number }>;
  total: number;
  status: "pending" | "processing" | "success" | "cancel";
  statusReason: string | null;
  statusUpdatedAt: string | null;
  createdAt: string;
  history: Array<{ status: "pending" | "processing" | "success" | "cancel"; at: string; reason: string | null }>;
};

const buckets = new Map<string, number[]>();
function orderAllowed(ip: string): boolean {
  const now = Date.now();
  const window = 5 * 60 * 1000;
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < window);
  if (hits.length >= 20) return false;
  hits.push(now);
  buckets.set(ip, hits);
  return true;
}

function formatWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!orderAllowed(ip)) {
    return jsonError(429, "rate-limited", "Terlalu banyak permintaan. Tunggu sebentar.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Data pesanan tidak valid.");
  }
  const input = parsed.data;
  const id = input.reference ?? generateOrderReference();
  const now = new Date().toISOString();

  const record: OrderRecord = {
    id,
    source: input.source,
    summary: input.summary,
    customerName: input.customerName?.trim() || null,
    items: input.items,
    total: input.total,
    status: "pending",
    statusReason: null,
    statusUpdatedAt: null,
    createdAt: now,
    history: [{ status: "pending", at: now, reason: null }],
  };

  try {
    await updateFeature("orders", "orders: new order", (currentRaw) => {
      const orders = Array.isArray((currentRaw as { orders?: unknown[] })?.orders)
        ? (currentRaw as { orders: OrderRecord[] }).orders
        : [];
      // Klien biasa me-refresh pesanan yang sama (mis. popup terblokir) —
      // bila ID sama sudah ada, jangan dobel.
      if (orders.some((o) => o.id === id)) return { orders };
      return { orders: [record, ...orders].slice(0, 300) };
    });
  } catch {
    return jsonError(502, "order.save-failed", "Pesanan gagal tersimpan. Coba lagi.");
  }

  // v1.8.0: after() menjamin notifikasi dieksekusi setelah respons —
  // `void` biasa bisa ter-freeze runtime serverless sebelum terkirim.
  after(() =>
    sendOwnerOrderNotification(
      {
        id: record.id,
        source: record.source,
        summary: record.summary,
        customerName: record.customerName,
        items: record.items,
        total: record.total,
        createdAt: record.createdAt,
      },
      formatWib(record.createdAt)
    )
  );

  return jsonOk({ id: record.id, status: record.status });
}
