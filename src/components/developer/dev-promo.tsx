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
import { useCatalog, usePromos, usePromoMutation, useManagementCatalog } from "@/lib/queries";
import { activePromos, type PromoEvent } from "@/lib/site-features/types";
import { formatWib } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { Percent, Plus, Trash2, Zap, TimerReset } from "lucide-react";

/**
 * Promo engine console (v1.3.0) — create/schedule/kelola event diskon.
 * Promos hit the storefront on the next features poll (≤30s) — no deploy.
 */
export function DevPromo() {
  const { data, isPending, isError, refetch } = usePromos(true);
  const catalog = useManagementCatalog(true);
  const mutation = usePromoMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PromoEvent | null>(null);

  const promos = data?.promos ?? [];
  const live = activePromos(promos);

  const games = catalog.data?.games ?? [];
  const gameName = (id?: string) => games.find((g) => g.id === id)?.name ?? id ?? "?";

  async function toggle(p: PromoEvent) {
    try {
      await mutation.mutateAsync({ action: "patch", body: { id: p.id, active: !p.active } });
      toast.success(p.active ? "Promo dinonaktifkan" : "Promo diaktifkan");
    } catch (e) {
      toast.error("Gagal mengubah promo", { description: (e as Error).message });
    }
  }

  async function remove(p: PromoEvent) {
    try {
      await mutation.mutateAsync({ action: "delete", id: p.id });
      toast.success("Promo dihapus");
      setConfirmDelete(null);
    } catch (e) {
      toast.error("Gagal menghapus promo", { description: (e as Error).message });
    }
  }

  if (isPending) return <LoadingState label="Memuat promo…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Promo tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Event Promo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Diskon terjadwal — harga promo otomatis tampil di seluruh storefront:
            kartu produk, keranjang, dan pesan WhatsApp.
            {live.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {live.length} aktif sekarang
              </span>
            ) : null}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 font-semibold">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Promo baru
        </Button>
      </header>

      {promos.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 p-10 text-center">
          <Percent aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada promo. Buat event diskon untuk mendorong penjualan — semua
            harga storefront ikut otomatis.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {promos.map((p) => {
            const isActive = p.active && activePromos([p]).length > 0;
            return (
              <li
                key={p.id}
                className={cn(
                  "rounded-xl border bg-card/50 p-4",
                  isActive && "border-primary/40 shadow-card"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-sm font-semibold">{p.title}</span>
                      <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-bold tabular text-primary-foreground">
                        -{p.percentOff}%
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.scope === "global" ? "Semua game" : `Khusus ${gameName(p.gameId)}`}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground/80">
                      {p.startsAt ? <span>mulai {formatWib(new Date(p.startsAt))}</span> : null}
                      {p.endsAt ? (
                        <span className="flex items-center gap-0.5">
                          <TimerReset aria-hidden="true" className="h-3 w-3" />
                          berakhir {formatWib(new Date(p.endsAt))}
                        </span>
                      ) : (
                        <span>tanpa batas waktu</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isActive ? "aktif" : p.active ? "terjadwal" : "nonaktif"}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
                  <Button
                    size="sm"
                    variant={p.active ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={mutation.isPending}
                    onClick={() => void toggle(p)}
                  >
                    {p.active ? "Matikan" : "Aktifkan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    disabled={mutation.isPending}
                    onClick={() => setConfirmDelete(p)}
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

      <CreatePromoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        games={games.map((g) => ({ id: g.id, name: g.name }))}
        creating={mutation.isPending}
        onCreate={async (body) => {
          try {
            await mutation.mutateAsync({ action: "create", body });
            toast.success("Promo dibuat", { description: "Harga storefront menyusul dalam ≤30 detik." });
            setCreateOpen(false);
          } catch (e) {
            toast.error("Gagal membuat promo", { description: (e as Error).message });
          }
        }}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus promo ini?</DialogTitle>
            <DialogDescription>
              “{confirmDelete?.title}” akan dihapus permanen. Harga storefront
              kembali normal dalam ≤30 detik.
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

function CreatePromoDialog({
  open,
  onOpenChange,
  games,
  creating,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  games: Array<{ id: string; name: string }>;
  creating: boolean;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [percent, setPercent] = useState("10");
  const [scope, setScope] = useState<"global" | "game">("global");
  const [gameId, setGameId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const toIso = (local: string): string | null =>
    local ? new Date(local).toISOString() : null;

  const valid =
    title.trim().length >= 3 &&
    Number.parseInt(percent, 10) >= 1 &&
    Number.parseInt(percent, 10) <= 90 &&
    (scope === "global" || Boolean(gameId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap aria-hidden="true" className="h-4 w-4 text-primary" />
            Promo baru
          </DialogTitle>
          <DialogDescription>
            Diskon diterapkan otomatis ke harga storefront tanpa deploy.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            void onCreate({
              title: title.trim(),
              scope,
              ...(scope === "game" ? { gameId } : {}),
              percentOff: Number.parseInt(percent, 10),
              startsAt: toIso(startsAt),
              endsAt: toIso(endsAt),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="promo-title">Nama promo</Label>
            <Input
              id="promo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Promo Gajian"
              maxLength={60}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="promo-percent">Diskon (%)</Label>
              <Input
                id="promo-percent"
                value={percent}
                onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                inputMode="numeric"
                placeholder="10"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cakupan</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as "global" | "game")}>
                <SelectTrigger aria-label="Cakupan promo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Semua game</SelectItem>
                  <SelectItem value="game" disabled={games.length === 0}>
                    Satu game
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {scope === "game" ? (
            <div className="space-y-1.5">
              <Label>Game</Label>
              <Select value={gameId} onValueChange={setGameId}>
                <SelectTrigger aria-label="Pilih game">
                  <SelectValue placeholder="Pilih game…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {games.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="promo-start">Mulai (opsional)</Label>
              <Input
                id="promo-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo-end">Berakhir (opsional)</Label>
              <Input
                id="promo-end"
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
              Buat promo
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
