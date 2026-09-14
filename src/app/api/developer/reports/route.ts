import { NextRequest, after } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability } from "@/lib/api/http";
import { readFeature, updateFeature } from "@/lib/site-features/store";
import { deleteReportMedia } from "@/lib/site-features/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Konsol laporan pengguna (v1.6.0, media cleanup v1.8.0) — panel admin/dev.
 * GET                             → daftar laporan (terbaru dulu).
 * POST {action:"delete", id}      → hapus satu laporan (+ file medianya).
 * POST {action:"clearAll"}        → hapus semua laporan (+ semua file media).
 */

type ReportMedia = {
  kind: "image" | "video";
  mime: string;
  size: number;
  fileName: string;
  storedAt?: string;
};

type ReportRecord = {
  id: string;
  type: "bug" | "feature" | "other";
  name: string | null;
  text: string;
  media: ReportMedia | null;
  createdAt: string;
};

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), id: z.string().min(3).max(24) }),
  z.object({ action: z.literal("clearAll") }),
]);

export async function GET(req: NextRequest) {
  const guard = await requireCapability(req, "reports.manage");
  if (guard) return guard;

  const file = (await readFeature("reports")) as { reports: ReportRecord[] };
  return jsonOk({ reports: file.reports });
}

export async function POST(req: NextRequest) {
  const guard = await requireCapability(req, "reports.manage");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Aksi tidak valid.");
  }

  const targetId = parsed.data.action === "delete" ? parsed.data.id : null;
  // Media dari laporan yang dihapus → file-nya dibersihkan SETELAH respons
  // (best-effort via after(); kegagalan cleanup tidak menggagalkan hapus).
  let removed: Array<{ id: string; media: ReportMedia }> = [];
  try {
    await updateFeature("reports", "reports: manage", (currentRaw) => {
      const reports = Array.isArray((currentRaw as { reports?: unknown[] })?.reports)
        ? (currentRaw as { reports: ReportRecord[] }).reports
        : [];
      if (targetId) {
        const target = reports.find((r) => r.id === targetId);
        if (target?.media) removed.push({ id: target.id, media: target.media });
        return { reports: reports.filter((r) => r.id !== targetId) };
      }
      removed = reports
        .filter((r) => r.media !== null)
        .map((r) => ({ id: r.id, media: r.media as ReportMedia }));
      return { reports: [] };
    });
  } catch {
    return jsonError(502, "reports.update-failed", "Gagal memperbarui laporan. Coba lagi.");
  }

  if (removed.length > 0) {
    after(async () => {
      for (const { id, media } of removed) {
        await deleteReportMedia(id, media.fileName, media.mime);
      }
    });
  }

  return jsonOk({ ok: true });
}
