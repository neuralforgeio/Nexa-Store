import { NextRequest } from "next/server";
import { z } from "zod";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { updateFeature, newId } from "@/lib/site-features/store";
import { sendOwnerReportNotification } from "@/lib/telegram-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Laporan pengguna (v1.6.0) — /reports.
 * POST multipart: type (bug|feature|other), name (opsional), text, dan
 * lampiran media opsional (gambar ≤ 2.5 MB, video ≤ 4 MB — batas body
 * serverless Vercel 4.5 MB). Metadata tersimpan di data store; media
 * diteruskan langsung ke Telegram pemilik.
 */

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

const bodySchema = z.object({
  type: z.enum(["bug", "feature", "other"]),
  name: z.string().trim().max(40).optional(),
  text: z.string().trim().min(10).max(1500),
});

type ReportRecord = {
  id: string;
  type: "bug" | "feature" | "other";
  name: string | null;
  text: string;
  media: { kind: "image" | "video"; mime: string; size: number; fileName: string } | null;
  createdAt: string;
};

// Rate limit sederhana: 3 laporan / 5 menit / IP.
const buckets = new Map<string, number[]>();
function reportAllowed(ip: string): boolean {
  const now = Date.now();
  const window = 5 * 60 * 1000;
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < window);
  if (hits.length >= 3) return false;
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
  if (!reportAllowed(ip)) {
    return jsonError(429, "rate-limited", "Terlalu banyak laporan. Coba lagi beberapa menit.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }

  const parsed = bodySchema.safeParse({
    type: form.get("type") ?? undefined,
    name: form.get("name") ?? undefined,
    text: form.get("text") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, "validation", "Laporan tidak valid (deskripsi minimal 10 karakter).");
  }
  const { type, name, text } = parsed.data;

  // Validasi lampiran
  let media: { blob: Blob; kind: "image" | "video"; fileName: string } | null = null;
  let mediaMeta: ReportRecord["media"] = null;
  const file = form.get("media");
  if (file instanceof File && file.size > 0) {
    const mime = file.type;
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : null;
    if (!kind) {
      return jsonError(400, "validation", "Lampiran harus berupa gambar atau video.");
    }
    const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > limit) {
      return jsonError(
        413,
        "too-large",
        kind === "image" ? "Gambar maksimal 2.5 MB." : "Video maksimal 4 MB (batas serverless)."
      );
    }
    const safeName = (file.name || `lampiran.${kind === "image" ? "png" : "mp4"}`).slice(0, 120);
    media = { blob: file, kind, fileName: safeName };
    mediaMeta = { kind, mime: mime.slice(0, 60), size: file.size, fileName: safeName };
  }

  const record: ReportRecord = {
    id: newId("rep"),
    type,
    name: name?.trim() ? name.trim() : null,
    text,
    media: mediaMeta,
    createdAt: new Date().toISOString(),
  };

  try {
    await updateFeature("reports", "reports: new report", (currentRaw) => {
      const reports = Array.isArray((currentRaw as { reports?: unknown[] })?.reports)
        ? (currentRaw as { reports: ReportRecord[] }).reports
        : [];
      // Terbaru di depan; simpan maksimal 200.
      return { reports: [record, ...reports].slice(0, 200) };
    });
  } catch {
    return jsonError(502, "report.save-failed", "Laporan gagal tersimpan. Coba lagi.");
  }

  // Kirim ke Telegram (best-effort — jangan blokir respons bila gagal).
  void sendOwnerReportNotification(
    { id: record.id, type: record.type, name: record.name, text: record.text, createdAt: record.createdAt },
    formatWib(record.createdAt),
    media
  );

  return jsonOk({ id: record.id, sent: true });
}
