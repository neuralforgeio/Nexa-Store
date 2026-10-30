"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  compressImageToDataUri,
  ImageTooLargeError,
  UnsupportedImageError,
} from "@/lib/image-compress";
import { useTestimonials, useTestimonialMutation } from "@/lib/queries";
import { effectiveThumbnail, type TestimonialRecord } from "@/lib/site-features/types";
import { formatWib } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import {
  Images,
  Loader2,
  MessageSquareHeart,
  Pencil,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

/**
 * Konsol Testimoni (v1.23.0) — Admin & Developer mengunggah bukti testimoni
 * customer: multi-foto + judul + deskripsi + rating + thumbnail fleksibel
 * (foto pertama otomatis / pilih foto ke-N / unggah khusus dari perangkat).
 * Tersimpan permanen ke penyimpanan toko (write-through GitHub di produksi).
 */

const MAX_IMAGES = 6;

type FormState = {
  title: string;
  customerName: string;
  rating: number;
  description: string;
  images: string[];
  thumbnailIndex: number;
  customThumbnail: string | null;
};

const EMPTY_FORM: FormState = {
  title: "",
  customerName: "",
  rating: 5,
  description: "",
  images: [],
  thumbnailIndex: 0,
  customThumbnail: null,
};

export function DevTestimonials() {
  const { data, isPending, isError, refetch } = useTestimonials(true);
  const mutation = useTestimonialMutation();
  const [editing, setEditing] = useState<TestimonialRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TestimonialRecord | null>(null);

  const testimonials = data?.testimonials ?? [];

  async function remove(t: TestimonialRecord) {
    try {
      await mutation.mutateAsync({ action: "delete", id: t.id });
      toast.success("Testimoni dihapus");
      setConfirmDelete(null);
    } catch (e) {
      toast.error("Gagal menghapus testimoni", { description: (e as Error).message });
    }
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        title="Testimoni tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Testimoni Customer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unggah bukti ulasan berfoto — tampil di halaman publik /testimoni.
            {testimonials.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {testimonials.length} tersimpan
              </span>
            ) : null}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 font-semibold">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Testimoni baru
        </Button>
      </header>

      {testimonials.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 p-10 text-center">
          <MessageSquareHeart aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada testimoni. Unggah screenshot chat, bukti pesanan sukses, atau ulasan
            customer — bisa beberapa foto sekaligus dalam satu testimoni.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {testimonials.map((t) => {
            const thumb = effectiveThumbnail(t);
            return (
              <article key={t.id} className="group overflow-hidden rounded-xl border bg-card/50">
                <div className="relative aspect-[4/3] bg-muted">
                  {thumb ? (
                     
                    <img
                      src={thumb}
                      alt={`Thumbnail ${t.title}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  {t.customThumbnail ? (
                    <Badge className="absolute left-2 top-2 bg-background/80 backdrop-blur">
                      thumbnail khusus
                    </Badge>
                  ) : null}
                  {t.images.length > 1 ? (
                    <Badge className="absolute right-2 top-2 gap-1 bg-background/80 backdrop-blur">
                      <Images aria-hidden="true" className="h-3 w-3" />
                      {t.images.length} foto
                    </Badge>
                  ) : null}
                </div>
                <div className="space-y-1.5 p-4">
                  <div className="flex items-center gap-1" aria-label={`Rating ${t.rating} dari 5`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star
                        key={i}
                        aria-hidden="true"
                        className={cn(
                          "h-3.5 w-3.5",
                          i < t.rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30"
                        )}
                      />
                    ))}
                  </div>
                  <h3 className="line-clamp-1 font-display text-sm font-semibold">{t.title}</h3>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  <p className="text-[11px] text-muted-foreground/80">
                    {t.customerName ?? "Customer"} · {formatWib(new Date(t.createdAt))}
                  </p>
                  <div className="flex items-center gap-2 border-t border-border/50 pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={mutation.isPending}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil aria-hidden="true" className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                      disabled={mutation.isPending}
                      onClick={() => setConfirmDelete(t)}
                    >
                      <Trash2 aria-hidden="true" className="h-3 w-3" />
                      Hapus
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <TestimonialFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        saving={mutation.isPending}
        initial={EMPTY_FORM}
        title="Testimoni baru"
        description="Foto tersimpan permanen di penyimpanan toko — aman walau file di HP dihapus."
        submitLabel="Simpan testimoni"
        onSubmit={async (form) => {
          try {
            await mutation.mutateAsync({ action: "create", body: form });
            toast.success("Testimoni tersimpan", {
              description: "Live di halaman /testimoni dalam ≤15 detik.",
            });
            setCreateOpen(false);
          } catch (e) {
            toast.error("Gagal menyimpan testimoni", { description: (e as Error).message });
          }
        }}
      />

      <TestimonialFormDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        saving={mutation.isPending}
        initial={
          editing
            ? {
                title: editing.title,
                customerName: editing.customerName ?? "",
                rating: editing.rating,
                description: editing.description,
                images: editing.images,
                thumbnailIndex: editing.thumbnailIndex,
                customThumbnail: editing.customThumbnail,
              }
            : EMPTY_FORM
        }
        title="Edit testimoni"
        description="Perubahan tersimpan permanen dan langsung tampil di halaman publik."
        submitLabel="Simpan perubahan"
        onSubmit={async (form) => {
          if (!editing) return;
          try {
            await mutation.mutateAsync({ action: "patch", body: { id: editing.id, ...form } });
            toast.success("Testimoni diperbarui");
            setEditing(null);
          } catch (e) {
            toast.error("Gagal memperbarui testimoni", { description: (e as Error).message });
          }
        }}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus testimoni ini?</DialogTitle>
            <DialogDescription>
              “{confirmDelete?.title}” beserta semua fotonya dihapus permanen dari penyimpanan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => confirmDelete && void remove(confirmDelete)}
            >
              Ya, hapus
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form dialog (dipakai create & edit)
// ---------------------------------------------------------------------------

function TestimonialFormDialog({
  open,
  onOpenChange,
  saving,
  initial,
  title,
  description,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saving: boolean;
  initial: FormState;
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (form: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false); // sedang mengompresi foto
  const photoInput = useRef<HTMLInputElement>(null);
  const thumbInput = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);

  // Reset tiap kali dialog dibuka dengan data baru (create/edit switch).
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(initial);
      setTouched(false);
      setBusy(false);
    }
  }

  const effective = form.customThumbnail ?? form.images[form.thumbnailIndex] ?? form.images[0] ?? "";
  const valid =
    form.title.trim().length >= 3 &&
    form.description.trim().length >= 3 &&
    form.images.length >= 1 &&
    !busy;

  function clampAfterRemoval(images: string[], removedIndex: number, prevIndex: number): number {
    if (removedIndex > prevIndex) return prevIndex;
    return Math.max(0, prevIndex - (removedIndex < prevIndex ? 1 : 0));
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - form.images.length;
    const picked = Array.from(files).slice(0, room);
    if (picked.length < files.length) {
      toast.info(`Maksimal ${MAX_IMAGES} foto per testimoni — foto selebihnya diabaikan.`);
    }
    if (picked.length === 0) return;
    setBusy(true);
    const results: string[] = [];
    for (const file of picked) {
      try {
        results.push(await compressImageToDataUri(file));
      } catch (e) {
        const msg =
          e instanceof ImageTooLargeError || e instanceof UnsupportedImageError
            ? e.message
            : `Foto “${file.name}” gagal diproses.`;
        toast.error("Foto dilewati", { description: msg });
      }
    }
    setBusy(false);
    if (results.length > 0) {
      setForm((f) => ({ ...f, images: [...f.images, ...results].slice(0, MAX_IMAGES) }));
    }
    if (photoInput.current) photoInput.current.value = "";
  }

  async function addCustomThumbnail(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const uri = await compressImageToDataUri(file, { maxSide: 900, maxChars: 180_000 });
      setForm((f) => ({ ...f, customThumbnail: uri }));
    } catch (e) {
      const msg =
        e instanceof ImageTooLargeError || e instanceof UnsupportedImageError
          ? e.message
          : "Foto gagal diproses.";
      toast.error("Thumbnail khusus gagal", { description: msg });
    }
    setBusy(false);
    if (thumbInput.current) thumbInput.current.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareHeart aria-hidden="true" className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!valid || busy) return;
            void onSubmit({
              title: form.title.trim(),
              description: form.description.trim(),
              customerName: form.customerName.trim() || null,
              rating: form.rating,
              images: form.images,
              thumbnailIndex: Math.min(
                form.thumbnailIndex,
                Math.max(0, form.images.length - 1)
              ),
              customThumbnail: form.customThumbnail,
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tst-title">Judul</Label>
            <Input
              id="tst-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Top up kilat, proses 2 menit"
              maxLength={80}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tst-name">Nama customer (opsional)</Label>
              <Input
                id="tst-name"
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                placeholder="Rafi"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rating</Label>
              <div className="flex h-9 items-center gap-0.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Beri ${i + 1} bintang`}
                    className="rounded p-1 hover:bg-muted"
                    onClick={() => setForm((f) => ({ ...f, rating: i + 1 }))}
                  >
                    <Star
                      aria-hidden="true"
                      className={cn(
                        "h-5 w-5",
                        i < form.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/40"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tst-desc">Deskripsi</Label>
            <Textarea
              id="tst-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Cerita singkat ulasan customer — apa yang dibeli, pengalamannya…"
              maxLength={600}
              rows={3}
              required
            />
            <p className="text-right text-[11px] text-muted-foreground">
              {form.description.length}/600
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Foto bukti (1–{MAX_IMAGES})</Label>
              <span className="text-[11px] text-muted-foreground">
                {form.images.length}/{MAX_IMAGES}
              </span>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void addPhotos(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 border-dashed"
              disabled={busy || form.images.length >= MAX_IMAGES}
              onClick={() => photoInput.current?.click()}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Upload aria-hidden="true" className="h-4 w-4" />
              )}
              {busy ? "Mengompresi foto…" : "Tambah foto dari perangkat"}
            </Button>
            {touched && form.images.length === 0 && !busy ? (
              <p className="text-xs text-destructive">Minimal 1 foto bukti.</p>
            ) : null}
            {form.images.length > 0 ? (
              <ScrollArea className="w-full whitespace-nowrap rounded-lg border bg-muted/30 p-2">
                <div className="flex gap-2 pb-1">
                  {form.images.map((img, i) => (
                    <figure
                      key={`${i}-${img.slice(0, 32)}`}
                      className="relative shrink-0"
                    >
                      { }
                      <img
                        src={img}
                        alt={`Foto bukti ${i + 1}`}
                        className={cn(
                          "h-20 w-20 rounded-md object-cover",
                          !form.customThumbnail && i === form.thumbnailIndex
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                            : "opacity-90"
                        )}
                      />
                      <button
                        type="button"
                        aria-label={`Jadikan foto ${i + 1} thumbnail`}
                        title={`Jadikan foto ${i + 1} thumbnail`}
                        disabled={Boolean(form.customThumbnail)}
                        className={cn(
                          "absolute -right-1.5 -top-1.5 rounded-full p-1 shadow",
                          !form.customThumbnail && i === form.thumbnailIndex
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-foreground hover:bg-muted"
                        )}
                        onClick={() => setForm((f) => ({ ...f, thumbnailIndex: i }))}
                      >
                        <Star aria-hidden="true" className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Hapus foto ${i + 1}`}
                        className="absolute -left-1.5 -top-1.5 rounded-full bg-destructive p-1 text-destructive-foreground shadow hover:bg-destructive/90"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            images: f.images.filter((_, idx) => idx !== i),
                            thumbnailIndex: clampAfterRemoval(f.images, i, f.thumbnailIndex),
                          }))
                        }
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </button>
                      <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">
                        {i + 1}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            ) : null}
            {!form.customThumbnail ? (
              <p className="text-[11px] text-muted-foreground">
                Tanpa thumbnail khusus, foto bertanda bintang dipakai (default: foto pertama).
              </p>
            ) : null}
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Thumbnail khusus (opsional)</Label>
              {form.customThumbnail ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 text-[11px] text-destructive hover:text-destructive"
                  onClick={() => setForm((f) => ({ ...f, customThumbnail: null }))}
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                  Pakai foto bukti lagi
                </Button>
              ) : null}
            </div>
            <input
              ref={thumbInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void addCustomThumbnail(e.target.files?.[0])}
            />
            <div className="flex items-center gap-3">
              <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md border bg-background">
                {effective ? (
                   
                  <img src={effective} alt="Pratinjau thumbnail" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    belum ada
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={busy}
                  onClick={() => thumbInput.current?.click()}
                >
                  {busy ? (
                    <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                  Unggah thumbnail dari perangkat
                </Button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Menimpa pilihan foto — dikompresi ke 900px. Kosong = foto bertanda bintang.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" size="sm" disabled={!valid} className="font-semibold">
              {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
