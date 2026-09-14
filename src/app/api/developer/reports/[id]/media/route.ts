import { NextRequest } from "next/server";
import { jsonError, requireCapability } from "@/lib/api/http";
import { readFeature } from "@/lib/site-features/store";
import { readReportMedia } from "@/lib/site-features/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Media laporan (v1.8.0) — GET /api/developer/reports/<id>/media.
 * Mengembalikan byte media (gambar/video) laporan untuk preview di konsol.
 * Hanya untuk admin/developer (capability reports.manage) — cookie sesi
 * dikirim otomatis oleh fetch dari panel.
 */

type ReportRecord = {
  id: string;
  media: { kind: "image" | "video"; mime: string; size: number; fileName: string; storedAt?: string } | null;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireCapability(req, "reports.manage");
  if (guard) return guard;

  const { id } = await ctx.params;
  if (!/^[a-z0-9_:-]{3,40}$/i.test(id)) {
    return jsonError(400, "bad-request", "ID laporan tidak valid.");
  }

  const file = (await readFeature("reports")) as { reports: ReportRecord[] };
  const record = file.reports.find((r) => r.id === id);
  if (!record) {
    return jsonError(404, "not-found", "Laporan tidak ditemukan.");
  }
  if (!record.media) {
    return jsonError(404, "no-media", "Laporan ini tidak memiliki lampiran media.");
  }

  const bytes = await readReportMedia(id, record.media.fileName, record.media.mime);
  if (!bytes || bytes.length === 0) {
    // Media lama pra-v1.8.0 (bytes tidak pernah disimpan) atau baca gagal.
    return jsonError(404, "media-missing", "File media tidak tersedia.");
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": record.media.mime,
      "content-length": String(bytes.length),
      // privat (butuh sesi) — boleh di-cache sebentar di memori browser
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename="${record.media.fileName.replace(/[^\w.\- ]+/g, "_")}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
