import { NextRequest } from "next/server";
import { z } from "zod";
import {
  jsonError,
  jsonOk,
  requireCapability,
  getSession,
  enforceMutationRateLimit,
} from "@/lib/api/http";
import { newId, readFeature, updateFeature } from "@/lib/site-features/store";
import {
  parseTestimonials,
  testimonialImageSchema,
} from "@/lib/site-features/schema";
import type { TestimonialRecord } from "@/lib/site-features/types";
import { effectiveThumbnail } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Testimoni CRUD (v1.23.0) — Admin & Developer.
 * Write-through GitHub di produksi (commit prefix "store:" → Vercel skip
 * rebuild, data langsung hidup). Gambar tersimpan sebagai data URI di dalam
 * file JSON → permanen di penyimpanan toko, aman walau file di HP dihapus.
 */

const MAX_TESTIMONIALS = 24;
/** Batas aman total file (Contents API + lambda body ~4.5 MB). */
const MAX_FILE_CHARS = 8_000_000;

const bodySchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(3).max(600),
  customerName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  rating: z.number().int().min(1).max(5).default(5),
  images: z.array(testimonialImageSchema).min(1).max(6),
  thumbnailIndex: z.number().int().min(0).optional().default(0),
  customThumbnail: testimonialImageSchema.max(200_000).nullable().optional().default(null),
});

const patchSchema = bodySchema.extend({ id: z.string().regex(/^tst_[a-z0-9]+$/) });

function clampIndex(input: z.infer<typeof bodySchema>): number {
  return Math.max(0, Math.min(input.thumbnailIndex, input.images.length - 1));
}

/** Tolak penulisan bila total file melewati batas aman penyimpanan. */
function assertSize(next: { testimonials: TestimonialRecord[] }): void {
  if (JSON.stringify(next).length > MAX_FILE_CHARS) throw new Error("size");
}

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "testimonials.manage");
  if (denied) return denied;
  const raw = await readFeature("testimonials");
  const file = parseTestimonials(raw);
  return jsonOk({
    testimonials: [...file.testimonials].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    ),
    thumbnails: Object.fromEntries(
      file.testimonials.map((t) => [t.id, effectiveThumbnail(t)])
    ),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "testimonials.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");
  const limited = enforceMutationRateLimit(session.email);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "validation",
      parsed.error.issues[0]?.message ?? "Data testimoni tidak valid."
    );
  }
  const input = parsed.data;

  try {
    let created: TestimonialRecord | null = null;
    await updateFeature("testimonials", "store: create testimonial", (currentRaw) => {
      const file = parseTestimonials(currentRaw);
      if (file.testimonials.length >= MAX_TESTIMONIALS) throw new Error("limit");
      const now = new Date().toISOString();
      const record: TestimonialRecord = {
        id: newId("tst"),
        title: input.title,
        description: input.description,
        customerName: input.customerName,
        rating: input.rating,
        images: input.images,
        thumbnailIndex: clampIndex(input),
        customThumbnail: input.customThumbnail,
        createdAt: now,
        updatedAt: now,
        createdBy: session.email as string,
      };
      created = record;
      const next = { testimonials: [record, ...file.testimonials] };
      assertSize(next);
      return next;
    });
    return jsonOk({ testimonial: created });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "limit") {
      return jsonError(400, "limit", "Maksimal 24 testimoni tersimpan. Hapus yang lama dulu.");
    }
    if (msg === "size") {
      return jsonError(
        400,
        "size",
        "Total foto semua testimoni melebihi batas penyimpanan. Hapus beberapa foto lama dulu."
      );
    }
    return jsonError(502, "testimonial.failed", "Testimoni gagal dibuat. Coba lagi.");
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireCapability(req, "testimonials.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");
  const limited = enforceMutationRateLimit(session.email);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "validation",
      parsed.error.issues[0]?.message ?? "Data testimoni tidak valid."
    );
  }
  const input = parsed.data;

  try {
    await updateFeature("testimonials", "store: update testimonial", (currentRaw) => {
      const file = parseTestimonials(currentRaw);
      const index = file.testimonials.findIndex((t) => t.id === input.id);
      if (index === -1) throw new Error("not-found");
      const prev = file.testimonials[index];
      const testimonials = [...file.testimonials];
      testimonials[index] = {
        ...prev,
        title: input.title,
        description: input.description,
        customerName: input.customerName,
        rating: input.rating,
        images: input.images,
        thumbnailIndex: clampIndex(input),
        customThumbnail: input.customThumbnail,
        updatedAt: new Date().toISOString(),
      };
      const next = { testimonials };
      assertSize(next);
      return next;
    });
    return jsonOk({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "not-found") {
      return jsonError(404, "testimonial.not-found", "Testimoni tidak ditemukan.");
    }
    if (msg === "size") {
      return jsonError(
        400,
        "size",
        "Total foto semua testimoni melebihi batas penyimpanan. Hapus beberapa foto lama dulu."
      );
    }
    return jsonError(502, "testimonial.failed", "Testimoni gagal diperbarui. Coba lagi.");
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireCapability(req, "testimonials.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");
  const limited = enforceMutationRateLimit(session.email);
  if (limited) return limited;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^tst_[a-z0-9]+$/.test(id)) {
    return jsonError(400, "validation", "Id testimoni tidak valid.");
  }

  try {
    await updateFeature("testimonials", "store: delete testimonial", (currentRaw) => {
      const file = parseTestimonials(currentRaw);
      const next = file.testimonials.filter((t) => t.id !== id);
      if (next.length === file.testimonials.length) throw new Error("not-found");
      return { testimonials: next };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "testimonial.not-found", "Testimoni tidak ditemukan.");
    }
    return jsonError(502, "testimonial.failed", "Testimoni gagal dihapus. Coba lagi.");
  }
}
