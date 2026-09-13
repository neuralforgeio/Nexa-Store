import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { newId, readFeature, updateFeature } from "@/lib/site-features/store";
import { parseBanners } from "@/lib/site-features/schema";
import type { BannerRecord } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Announcement banner CRUD (v1.3.0) — developer only.
 * Banners render from the site-features poll: publishing is instant, no deploy.
 */

const isoOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const ctaHref = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v.startsWith("/") || /^https?:\/\//i.test(v), {
    message: "Tautan harus /jalur-relatif atau URL http(s).",
  })
  .optional();

const createSchema = z.object({
  severity: z.enum(["info", "sukses", "peringatan", "penting"]),
  title: z.string().trim().min(3).max(80),
  message: z.string().trim().min(3).max(300),
  ctaLabel: z.string().trim().min(2).max(30).optional(),
  ctaHref,
  startsAt: isoOrNull,
  endsAt: isoOrNull,
});

const patchSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  severity: z.enum(["info", "sukses", "peringatan", "penting"]).optional(),
  title: z.string().trim().min(3).max(80).optional(),
  message: z.string().trim().min(3).max(300).optional(),
  ctaLabel: z.string().trim().min(2).max(30).nullable().optional(),
  ctaHref: ctaHref.nullable().optional(),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
});

function validateWindow(startsAt: string | null, endsAt: string | null): string | null {
  if (startsAt && Number.isNaN(Date.parse(startsAt))) return "Waktu mulai tidak valid.";
  if (endsAt && Number.isNaN(Date.parse(endsAt))) return "Waktu selesai tidak valid.";
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return "Waktu selesai harus setelah waktu mulai.";
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "banners.manage");
  if (denied) return denied;
  const raw = await readFeature("banners");
  const file = parseBanners(raw);
  return jsonOk({
    banners: [...file.banners].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    ),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "banners.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", parsed.error.issues[0]?.message ?? "Data banner tidak valid.");
  }
  const input = parsed.data;
  if (input.ctaLabel && !input.ctaHref) {
    return jsonError(400, "validation", "Tombol CTA butuh tautan tujuan.");
  }
  const windowError = validateWindow(input.startsAt, input.endsAt);
  if (windowError) return jsonError(400, "validation", windowError);

  const MAX_BANNERS = 10;
  try {
    let created: BannerRecord | null = null;
    await updateFeature("banners", "store: create banner", (currentRaw) => {
      const file = parseBanners(currentRaw);
      if (file.banners.length >= MAX_BANNERS) throw new Error("limit");
      const banner: BannerRecord = {
        id: newId("bnn"),
        severity: input.severity,
        title: input.title,
        message: input.message,
        ...(input.ctaLabel ? { ctaLabel: input.ctaLabel } : {}),
        ...(input.ctaHref ? { ctaHref: input.ctaHref } : {}),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        enabled: true,
        createdAt: new Date().toISOString(),
        createdBy: session.email as string,
      };
      created = banner;
      return { banners: [banner, ...file.banners] };
    });
    return jsonOk({ banner: created });
  } catch (e) {
    if ((e as Error).message === "limit") {
      return jsonError(400, "limit", "Maksimal 10 banner tersimpan. Hapus yang lama dulu.");
    }
    return jsonError(502, "banner.failed", "Banner gagal dibuat. Coba lagi.");
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireCapability(req, "banners.manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", parsed.error.issues[0]?.message ?? "Data banner tidak valid.");
  }
  const input = parsed.data;
  const windowError = validateWindow(input.startsAt ?? null, input.endsAt ?? null);
  if (windowError) return jsonError(400, "validation", windowError);

  try {
    await updateFeature("banners", "store: update banner", (currentRaw) => {
      const file = parseBanners(currentRaw);
      const index = file.banners.findIndex((b) => b.id === input.id);
      if (index === -1) throw new Error("not-found");
      const banners = [...file.banners];
      const prev = banners[index];
      banners[index] = {
        ...prev,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.ctaLabel !== undefined
          ? input.ctaLabel
            ? { ctaLabel: input.ctaLabel }
            : { ctaHref: undefined }
          : {}),
        ...(input.ctaHref !== undefined ? (input.ctaHref ? { ctaHref: input.ctaHref } : { ctaHref: undefined }) : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      };
      // zod strips undefined keys on re-parse; drop the removed-CTA residue.
      if (input.ctaLabel !== undefined && !input.ctaLabel) delete banners[index].ctaLabel;
      if (input.ctaHref !== undefined && !input.ctaHref) delete banners[index].ctaHref;
      return { banners };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "banner.not-found", "Banner tidak ditemukan.");
    }
    return jsonError(502, "banner.failed", "Banner gagal diperbarui. Coba lagi.");
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireCapability(req, "banners.manage");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return jsonError(400, "validation", "Id banner wajib disertakan.");

  try {
    await updateFeature("banners", "store: delete banner", (currentRaw) => {
      const file = parseBanners(currentRaw);
      const next = file.banners.filter((b) => b.id !== id);
      if (next.length === file.banners.length) throw new Error("not-found");
      return { banners: next };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "banner.not-found", "Banner tidak ditemukan.");
    }
    return jsonError(502, "banner.failed", "Banner gagal dihapus. Coba lagi.");
  }
}
