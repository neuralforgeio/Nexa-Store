import { readFeature } from "@/lib/site-features/store";
import { parseTestimonials } from "@/lib/site-features/schema";
import { toPublicTestimonialSummary } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Daftar testimoni publik (v1.23.0) — ringkasan per kartu TANPA array foto
 * penuh (hanya thumbnail teratasi + jumlah foto) supaya halaman Testimoni
 * tetap ringan di kuota pengunjung. Galeri diambil on-demand dari /[id].
 */

const LIST_CACHE_TTL_MS = 15_000;
let cache: { at: number; body: string } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < LIST_CACHE_TTL_MS) {
    return new Response(cache.body, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const raw = await readFeature("testimonials");
  const file = parseTestimonials(raw);
  const body = JSON.stringify({
    ok: true,
    data: {
      testimonials: [...file.testimonials]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(toPublicTestimonialSummary),
    },
  });
  cache = { at: now, body };
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
