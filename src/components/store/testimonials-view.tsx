"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { usePublicTestimonialDetail, usePublicTestimonials } from "@/lib/queries";
import type { PublicTestimonialSummary } from "@/lib/site-features/types";
import { formatWib } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { Images, MessageSquareHeart, Quote, Star } from "lucide-react";

/**
 * Halaman publik Testimoni (v1.23.0) — bukti ulasan customer berfoto.
 * Daftar kartu memakai ringkasan (thumbnail saja); galeri foto lengkap
 * diambil on-demand saat kartu diklik.
 */

export function TestimonialsView() {
  const { data, isPending, isError } = usePublicTestimonials(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const testimonials = data?.testimonials ?? [];

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <header className="mx-auto max-w-2xl text-center">
        <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1">
          <Quote aria-hidden="true" className="h-3 w-3 text-primary" />
          Kata customer kami
        </Badge>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Testimoni Customer
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Bukti nyata ulasan dan pesanan sukses — langsung dari layar HP customer.
          Klik kartu untuk melihat semua foto buktinya.
        </p>
      </header>

      <section aria-label="Daftar testimoni" className="mt-10">
        {isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border bg-card/40">
                <Skeleton className="aspect-[4/3] rounded-none" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed bg-card/40 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Testimoni tidak dapat dimuat. Tarik ulang halaman sebentar lagi.
            </p>
          </div>
        ) : testimonials.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed bg-card/40 p-10 text-center">
            <MessageSquareHeart aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Belum ada testimoni. Jadilah yang pertama melakukan pesanan — ulasanmu
              bisa tampil di sini.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <TestimonialCard key={t.id} t={t} index={i} onOpen={() => setOpenId(t.id)} />
            ))}
          </div>
        )}
      </section>

      <TestimonialGalleryDialog id={openId} onClose={() => setOpenId(null)} />
    </main>
  );
}

function TestimonialCard({
  t,
  index,
  onOpen,
}: {
  t: PublicTestimonialSummary;
  index: number;
  onOpen: () => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.3) }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Buka testimoni ${t.title}`}
        className="group block w-full overflow-hidden rounded-xl border bg-card/50 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="relative aspect-[4/3] bg-muted">
          {t.thumbnail ? (
             
            <img
              src={t.thumbnail}
              alt={`Bukti ${t.title}`}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : null}
          {t.imageCount > 1 ? (
            <Badge className="absolute right-2 top-2 gap-1 bg-background/85 backdrop-blur">
              <Images aria-hidden="true" className="h-3 w-3" />
              {t.imageCount} foto
            </Badge>
          ) : null}
        </div>
        <div className="space-y-2 p-4">
          <div className="flex items-center gap-0.5" aria-label={`Rating ${t.rating} dari 5`}>
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5",
                  i < t.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                )}
              />
            ))}
          </div>
          <h2 className="line-clamp-1 font-display text-sm font-semibold">{t.title}</h2>
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {t.description}
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {t.customerName ?? "Customer Nexa Store"} · {formatWib(new Date(t.createdAt))}
          </p>
        </div>
      </button>
    </motion.article>
  );
}

function TestimonialGalleryDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isPending, isError } = usePublicTestimonialDetail(id);
  const [active, setActive] = useState(0);
  const [lastId, setLastId] = useState<string | null>(null);
  if (id !== lastId) {
    setLastId(id);
    setActive(0);
  }

  const detail = data?.testimonial;
  const images = detail?.images ?? [];
  const mainImage = images[Math.min(active, Math.max(0, images.length - 1))] ?? detail?.thumbnail ?? "";

  return (
    <Dialog open={id !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="aspect-[4/3] w-full rounded-lg" />
            <Skeleton className="h-3 w-full" />
          </div>
        ) : isError || !detail ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Testimoni tidak ditemukan — mungkin sudah dihapus.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-start gap-2 pr-6">
                <Quote aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">{detail.title}</span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-0.5" aria-label={`Rating ${detail.rating} dari 5`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      aria-hidden="true"
                      className={cn(
                        "h-3 w-3",
                        i < detail.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/30"
                      )}
                    />
                  ))}
                </span>
                <span className="font-medium text-foreground/80">
                  {detail.customerName ?? "Customer Nexa Store"}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatWib(new Date(detail.createdAt))}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {mainImage ? (
                 
                <img
                  src={mainImage}
                  alt={`Foto bukti ${active + 1} dari ${images.length}`}
                  className="max-h-[55dvh] w-full rounded-lg border object-contain bg-muted/50"
                />
              ) : null}

              {images.length > 1 ? (
                <ScrollArea className="w-full whitespace-nowrap rounded-lg border bg-muted/30 p-2">
                  <div className="flex gap-2 pb-1">
                    {images.map((img, i) => (
                      <button
                        key={`${i}-${img.slice(0, 24)}`}
                        type="button"
                        aria-label={`Lihat foto ${i + 1}`}
                        onClick={() => setActive(i)}
                        className={cn(
                          "shrink-0 overflow-hidden rounded-md border transition",
                          i === active
                            ? "border-primary ring-2 ring-primary/60"
                            : "opacity-75 hover:opacity-100"
                        )}
                      >
                        { }
                        <img src={img} alt="" className="h-14 w-14 object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              ) : null}

              <p className="text-sm leading-relaxed text-muted-foreground">{detail.description}</p>

              <div className="flex items-center justify-between border-t border-border/50 pt-3">
                <p className="text-[11px] text-muted-foreground/80">
                  {images.length} foto bukti tersimpan permanen
                </p>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href="/games"
                    className="gap-1.5"
                  >
                    Belanja sekarang
                  </a>
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
