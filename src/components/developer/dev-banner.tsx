"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBanners, useBannerMutation } from "@/lib/queries";
import { activeBanners, type BannerRecord, type BannerSeverity } from "@/lib/site-features/types";
import { formatWib } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { Megaphone, Plus, Trash2 } from "lucide-react";

/**
 * Announcement banner console (v1.3.0). Publishing is instant: active banners
 * ride the /api/site-features poll onto every open storefront within 30s.
 */
const SEVERITY_CLASS: Record<BannerSeverity, string> = {
  info: "border-l-primary bg-primary/5",
  sukses: "border-l-emerald-500 bg-emerald-500/5",
  peringatan: "border-l-amber-500 bg-amber-500/5",
  penting: "border-l-destructive bg-destructive/5",
};

const SEVERITY_BADGE: Record<BannerSeverity, string> = {
  info: "bg-primary/15 text-primary",
  sukses: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  peringatan: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  penting: "bg-destructive/15 text-destructive",
};

export function DevBanner() {
  const { data, isPending, isError, refetch } = useBanners(true);
  const mutation = useBannerMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BannerRecord | null>(null);

  const banners = data?.banners ?? [];
  const live = activeBanners(banners);

  async function toggle(b: BannerRecord) {
    try {
      await mutation.mutateAsync({ action: "patch", body: { id: b.id, enabled: !b.enabled } });
      toast.success(b.enabled ? "Banner disembunyikan" : "Banner diterbitkan");
    } catch (e) {
      toast.error("Gagal mengubah banner", { description: (e as Error).message });
    }
  }

  async function remove(b: BannerRecord) {
    try {
      await mutation.mutateAsync({ action: "delete", id: b.id });
      toast.success("Banner dihapus");
      setConfirmDelete(null);
    } catch (e) {
      toast.error("Gagal menghapus banner", { description: (e as Error).message });
    }
  }

  if (isPending) return <LoadingState label="Memuat banner…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Banner tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Banner Pengumuman</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pita pengumuman di seluruh storefront — dengan level warna dan tombol ajakan (CTA).
            {live.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {live.length} tampil sekarang
              </span>
            ) : null}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 font-semibold">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Banner baru
        </Button>
      </header>

      {banners.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 p-10 text-center">
          <Megaphone aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada banner. Umumkan promo, jam operasional, atau info penting
            ke semua pengunjung dalam hitungan detik.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {banners.map((b) => {
            const isLive = activeBanners([b]).length > 0;
            return (
              <li
                key={b.id}
                className={cn(
                  "rounded-xl border border-l-4 bg-card/50 p-4",
                  SEVERITY_CLASS[b.severity],
                  !isLive && "opacity-70"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold">{b.title}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          SEVERITY_BADGE[b.severity]
                        )}
                      >
                        {b.severity}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{b.message}</p>
                    {b.ctaLabel && b.ctaHref ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        CTA: <span className="font-medium text-foreground">{b.ctaLabel}</span>
                        <span className="ml-1 font-mono">→ {b.ctaHref}</span>
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[11px] text-muted-foreground/80">
                      {b.startsAt ? `mulai ${formatWib(new Date(b.startsAt))}` : "langsung"} ·{" "}
                      {b.endsAt ? `berakhir ${formatWib(new Date(b.endsAt))}` : "tanpa batas"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      isLive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isLive ? "tampil" : b.enabled ? "terjadwal" : "nonaktif"}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
                  <Button
                    size="sm"
                    variant={b.enabled ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={mutation.isPending}
                    onClick={() => void toggle(b)}
                  >
                    {b.enabled ? "Sembunyikan" : "Terbitkan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    disabled={mutation.isPending}
                    onClick={() => setConfirmDelete(b)}
                  >
                    <Trash2 aria-hidden="true" className="h-3 w-3" />
                    Hapus
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateBannerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        creating={mutation.isPending}
        onCreate={async (body) => {
          try {
            await mutation.mutateAsync({ action: "create", body });
            toast.success("Banner dibuat", { description: "Tampil di storefront dalam ≤30 detik." });
            setCreateOpen(false);
          } catch (e) {
            toast.error("Gagal membuat banner", { description: (e as Error).message });
          }
        }}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus banner ini?</DialogTitle>
            <DialogDescription>
              “{confirmDelete?.title}” akan dihapus permanen dari daftar.
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

function CreateBannerDialog({
  open,
  onOpenChange,
  creating,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  creating: boolean;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [severity, setSeverity] = useState<BannerSeverity>("info");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const toIso = (local: string): string | null => (local ? new Date(local).toISOString() : null);
  const valid =
    title.trim().length >= 3 &&
    message.trim().length >= 3 &&
    (!ctaLabel.trim() || ctaHref.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone aria-hidden="true" className="h-4 w-4 text-primary" />
            Banner baru
          </DialogTitle>
          <DialogDescription>
            Tampil sebagai pita di bawah header seluruh halaman publik.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            void onCreate({
              severity,
              title: title.trim(),
              message: message.trim(),
              ...(ctaLabel.trim() && ctaHref.trim() ? { ctaLabel: ctaLabel.trim(), ctaHref: ctaHref.trim() } : {}),
              startsAt: toIso(startsAt),
              endsAt: toIso(endsAt),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label>Level</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as BannerSeverity)}>
              <SelectTrigger aria-label="Level banner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="sukses">Sukses</SelectItem>
                <SelectItem value="peringatan">Peringatan</SelectItem>
                <SelectItem value="penting">Penting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="banner-title">Judul</Label>
            <Input
              id="banner-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Libur sementara"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="banner-message">Pesan</Label>
            <Input
              id="banner-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Store tutup tiap Senin pagi."
              maxLength={300}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="banner-cta-label">Tombol CTA (opsional)</Label>
              <Input
                id="banner-cta-label"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Lihat promo"
                maxLength={30}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="banner-cta-href">Tautan CTA</Label>
              <Input
                id="banner-cta-href"
                value={ctaHref}
                onChange={(e) => setCtaHref(e.target.value)}
                placeholder="/games"
                maxLength={300}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="banner-start">Mulai (opsional)</Label>
              <Input
                id="banner-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="banner-end">Berakhir (opsional)</Label>
              <Input
                id="banner-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" size="sm" disabled={!valid || creating} className="font-semibold">
              Terbitkan banner
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
