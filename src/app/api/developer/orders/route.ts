import { NextRequest, after } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability } from "@/lib/api/http";
import { readFeature, updateFeature } from "@/lib/site-features/store";
import { sendOrderStatusPush } from "@/lib/push-notify";
import type { OrderRecord } from "../../orders/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Kelola pesanan (v1.6.0) — dipakai bot Telegram (/lacak-order).
 * GET  (tanpa ?id=) → daftar pesanan terbaru, maks. 100 (panel Admin →
 *        Pesanan; perlu capability orders.manage).
 * GET  ?id=          → detail satu pesanan (perlu sesi admin/developer).
 * PATCH {id, status, reason} → ubah status + keterangan (user membaca
 *        keterangan ini dari halaman Lacak Pesanan).
 */

const STATUS_LABEL: Record<OrderRecord["status"], string> = {
  pending: "Menunggu pembayaran/konfirmasi",
  processing: "Sedang diproses",
  success: "Selesai",
  cancel: "Dibatalkan",
};

const patchSchema = z.object({
  id: z.string().regex(/^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/),
  status: z.enum(["pending", "processing", "success", "cancel"]),
  reason: z.string().trim().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const guard = await requireCapability(req, "orders.manage");
  if (guard) return guard;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const file = (await readFeature("orders")) as { orders: OrderRecord[] };

  // Tanpa ?id= → daftar pesanan terbaru (terbaru dulu, maks. 100) untuk
  // panel Admin → Pesanan. Disimpan sudah terbaru-dulu, tapi sort eksplisit
  // tetap dipakai supaya urutan dijamin stabil.
  if (!id) {
    const orders = [...file.orders]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100);
    return jsonOk({ orders, statusLabel: STATUS_LABEL });
  }

  const order = file.orders.find((o) => o.id === id);
  if (!order) return jsonError(404, "not-found", "Pesanan tidak ditemukan.");
  return jsonOk({ order, statusLabel: STATUS_LABEL });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireCapability(req, "orders.manage");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Data perubahan status tidak valid.");
  }
  const { id, status, reason } = parsed.data;

  let updated: OrderRecord | null = null;
  try {
    await updateFeature("orders", "orders: status update", (currentRaw) => {
      const orders = Array.isArray((currentRaw as { orders?: unknown[] })?.orders)
        ? (currentRaw as { orders: OrderRecord[] }).orders
        : [];
      const idx = orders.findIndex((o) => o.id === id);
      if (idx === -1) throw "not-found";
      const prev = orders[idx];
      const now = new Date().toISOString();
      const next: OrderRecord = {
        ...prev,
        status,
        statusReason: reason?.trim() ? reason.trim() : null,
        statusUpdatedAt: now,
        history: [...prev.history, { status, at: now, reason: reason?.trim() ? reason.trim() : null }].slice(-30),
      };
      orders[idx] = next;
      updated = next;
      return { orders };
    });
  } catch (e) {
    if (e === "not-found") return jsonError(404, "not-found", "Pesanan tidak ditemukan.");
    return jsonError(502, "order.update-failed", "Gagal memperbarui status. Coba lagi.");
  }

  // v1.21.0: status berubah → push notification ke perangkat pembeli
  // (best-effort; pesanan tanpa conversationId dilewati diam-diam).
  // Berlaku untuk admin panel, developer, dan tombol status Telegram bot
  // (semua lewat endpoint ini).
  const updatedOrder = updated as OrderRecord | null;
  if (updatedOrder?.conversationId) {
    const conversationId = updatedOrder.conversationId;
    const pushPayload = {
      id: updatedOrder.id,
      status: updatedOrder.status,
      reason: updatedOrder.statusReason,
    };
    after(() => sendOrderStatusPush(conversationId, pushPayload));
  }

  return jsonOk({ order: updated });
}
