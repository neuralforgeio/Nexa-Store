import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability } from "@/lib/api/http";
import { readFeature, updateFeature } from "@/lib/site-features/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Konsol laporan pengguna (v1.6.0) — panel admin/developer.
 * GET                → daftar laporan (terbaru dulu).
 * POST {action:"delete", id}    → hapus satu laporan.
 * POST {action:"clearAll"}      → hapus semua laporan.
 */

type ReportRecord = {
  id: string;
  type: "bug" | "feature" | "other";
  name: string | null;
  text: string;
  media: { kind: "image" | "video"; mime: string; size: number; fileName: string } | null;
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
  try {
    await updateFeature("reports", "reports: manage", (currentRaw) => {
      const reports = Array.isArray((currentRaw as { reports?: unknown[] })?.reports)
        ? (currentRaw as { reports: ReportRecord[] }).reports
        : [];
      if (targetId) {
        return { reports: reports.filter((r) => r.id !== targetId) };
      }
      return { reports: [] };
    });
  } catch {
    return jsonError(502, "reports.update-failed", "Gagal memperbarui laporan. Coba lagi.");
  }

  return jsonOk({ ok: true });
}
