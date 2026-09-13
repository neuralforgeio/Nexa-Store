import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/http";
import { readFeature } from "@/lib/site-features/store";
import type { OrderRecord } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lacak pesanan (v1.6.0) — GET /api/orders/track?id=NEXA-YYMMDD-XXXX.
 * Publik dan aman: hanya mengembalikan ringkasan + status + riwayat,
 * tanpa data pribadi.
 */

const querySchema = z.object({
  id: z.string().regex(/^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/),
});

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const parsed = querySchema.safeParse({ id });
  if (!parsed.success) {
    return jsonError(400, "validation", "Format ID Order tidak valid.");
  }

  const file = (await readFeature("orders")) as { orders: OrderRecord[] };
  const order = file.orders.find((o) => o.id === parsed.data.id);
  if (!order) {
    return jsonError(404, "not-found", "Pesanan tidak ditemukan. Periksa kembali ID Order kamu.");
  }

  return jsonOk({
    id: order.id,
    summary: order.summary,
    source: order.source,
    items: order.items,
    total: order.total,
    status: order.status,
    statusReason: order.statusReason,
    statusUpdatedAt: order.statusUpdatedAt,
    createdAt: order.createdAt,
    history: order.history,
  });
}
