import { NextRequest } from "next/server";
import { readFeature } from "@/lib/site-features/store";
import { parseTestimonials } from "@/lib/site-features/schema";
import { toPublicTestimonialDetail } from "@/lib/site-features/types";
import { jsonError, jsonOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * Detail satu testimoni publik (v1.23.0) — semua foto bukti ikut (dipanggil
 * saat dialog galeri dibuka dari halaman /testimoni).
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^tst_[a-z0-9]+$/.test(id)) {
    return jsonError(400, "validation", "Id testimoni tidak valid.");
  }
  const raw = await readFeature("testimonials");
  const file = parseTestimonials(raw);
  const record = file.testimonials.find((t) => t.id === id);
  if (!record) {
    return jsonError(404, "testimonial.not-found", "Testimoni tidak ditemukan.");
  }
  return jsonOk({ testimonial: toPublicTestimonialDetail(record) });
}
