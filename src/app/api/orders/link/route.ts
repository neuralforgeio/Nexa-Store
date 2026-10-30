import { NextRequest } from "next/server";
import { z } from "zod";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { conversationIdForToken, updateFeature } from "@/lib/site-features/store";
import type { OrderRecord } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tautkan pesanan → percakapan push (v1.21.0).
 *
 * Dipanggil halaman Lacak setelah pengunjung menyetujui notifikasi: device
 * tersebut berlangganan push lalu pesanan lama (dibuat sebelum fitur ini)
 * dikaitkan agar perubahan status terkirim sebagai notifikasi browser.
 *
 * First-claim-wins: conversationId hanya diisi bila kosong atau sudah sama —
 * perangkat lain tidak bisa membajak notifikasi pesanan yang sudah tertaut.
 * Pesanan baru (dibuat klien v1.21.0+) sudah membawa conversationId sendiri.
 */

const TOKEN_RE = /^[a-f0-9]{32}$/;

const linkSchema = z.object({
  id: z.string().regex(/^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/),
  chatToken: z.string().regex(TOKEN_RE),
});

const WINDOW_MS = 5 * 60_000;
const MAX_LINKS = 20;
const buckets = new Map<string, number[]>();

function linkAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_LINKS) return false;
  hits.push(now);
  buckets.set(ip, hits);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!linkAllowed(ip)) {
    return jsonError(429, "rate-limited", "Terlalu banyak permintaan. Tunggu sebentar.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Data tautan pesanan tidak valid.");
  }
  const conversationId = conversationIdForToken(parsed.data.chatToken);

  try {
    await updateFeature("orders", "orders: link push conversation", (currentRaw) => {
      const orders = Array.isArray((currentRaw as { orders?: unknown[] })?.orders)
        ? (currentRaw as { orders: OrderRecord[] }).orders
        : [];
      const idx = orders.findIndex((o) => o.id === parsed.data.id);
      if (idx === -1) throw "not-found";
      const prev = orders[idx];
      // First-claim-wins: hanya isi bila kosong atau milik device yang sama.
      if (prev.conversationId && prev.conversationId !== conversationId) throw "taken";
      if (prev.conversationId === conversationId) return { orders };
      orders[idx] = { ...prev, conversationId };
      return { orders };
    });
  } catch (e) {
    if (e === "not-found") return jsonError(404, "not-found", "Pesanan tidak ditemukan.");
    if (e === "taken") {
      return jsonError(409, "order.linked", "Pesanan ini sudah tertaut ke perangkat lain.");
    }
    return jsonError(502, "order.link-failed", "Gagal menautkan notifikasi. Coba lagi.");
  }

  return jsonOk({ linked: true });
}
