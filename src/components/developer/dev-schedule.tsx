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
import { useSchedules, useScheduleMutation, useBanners, usePromos } from "@/lib/queries";
import { formatWib } from "@/lib/format/date";
import { countdownParts } from "@/lib/promo/pricing";
import type { ScheduleTask, ScheduleTaskType } from "@/lib/site-features/types";
import { cn } from "@/lib/utils";
import { AlarmClock, Plus, Trash2, XCircle, CheckCircle2, AlertTriangle, Clock3 } from "lucide-react";

/**
 * Scheduled tasks console (v1.3.0). The executor lives in the Telegram bot
 * service (always-on): it polls this store every 30s, runs due tasks through
 * the same developer APIs, and reports results back here.
 */

const TASK_META: Record<ScheduleTaskType, { label: string; icon: string }> = {
  "maintenance-on": { label: "Nyalakan maintenance", icon: "🛠" },
  "maintenance-off": { label: "Matikan maintenance", icon: "🟢" },
  "lockdown-on": { label: "Nyalakan lockdown", icon: "🔒" },
  "lockdown-off": { label: "Angkat lockdown", icon: "🔓" },
  "banner-on": { label: "Terbitkan banner", icon: "📣" },
  "banner-off": { label: "Sembunyikan banner", icon: "🔕" },
  "promo-on": { label: "Aktifkan promo", icon: "🏷" },
  "promo-off": { label: "Matikan promo", icon: "💸" },
  "announcement-set": { label: "Set announcement", icon: "📢" },
  reminder: { label: "Pengingat Telegram", icon: "⏰" },
};

function localDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DevSchedule() {
  const { data, isPending, isError, refetch } = useSchedules(true);
  const banners = useBanners(true);
  const promos = usePromos(true);
  const mutation = useScheduleMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<ScheduleTask | null>(null);

  const tasks = data?.tasks ?? [];

  async function cancel(t: ScheduleTask) {
    try {
      await mutation.mutateAsync({ action: "patch", body: { id: t.id, status: "cancelled" } });
      toast.success("Tugas dibatalkan");
      setConfirmCancel(null);
    } catch (e) {
      toast.error("Gagal membatalkan tugas", { description: (e as Error).message });
    }
  }

  async function remove(t: ScheduleTask) {
    try {
      await mutation.mutateAsync({ action: "delete", id: t.id });
      toast.success("Tugas dihapus");
    } catch (e) {
      toast.error("Gagal menghapus tugas", { description: (e as Error).message });
    }
  }

  if (isPending) return <LoadingState label="Memuat tugas…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Tugas tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const pending = tasks.filter((t) => t.status === "pending");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Tugas Terjadwal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Otomasi berwaktu — maintenance malam, promo pagi, banner event, atau sekadar pengingat
            ke Telegram. Dijalankan oleh layanan bot (mengecek tiap 30 detik).
            {pending.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                {pending.length} menunggu jadwal
              </span>
            ) : null}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 font-semibold">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Tugas baru
        </Button>
      </header>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 p-10 text-center">
          <AlarmClock aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada tugas terjadwal. Contoh: “maintenance mulai 02:00, selesai 04:00” —
            dibuat sekali, berjalan otomatis.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {tasks.map((t) => {
            const meta = TASK_META[t.type];
            const cd = countdownParts(t.runAt);
            return (
              <li
                key={t.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card/50 px-4 py-3",
                  t.status === "pending" && "border-primary/25",
                  t.status === "failed" && "border-destructive/30"
                )}
              >
                <span aria-hidden="true" className="text-lg">{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-sm font-semibold">{t.label}</span>
                    <StatusChip status={t.status} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {meta.label} · {formatWib(new Date(t.runAt))}
                    {t.status === "pending" && cd.total > 0 ? (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular">
                        {cd.days > 0 ? `${cd.days}h ` : ""}
                        {String(cd.hours).padStart(2, "0")}:
                        {String(cd.minutes).padStart(2, "0")}:
                        {String(cd.seconds).padStart(2, "0")}
                      </span>
                    ) : null}
                  </p>
                  {t.lastResult ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                      {t.status === "failed" ? "⚠ " : ""}
                      {t.lastResult}
                    </p>
                  ) : null}
                </div>
                {t.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    disabled={mutation.isPending}
                    onClick={() => setConfirmCancel(t)}
                  >
                    <XCircle aria-hidden="true" className="h-3 w-3" />
                    Batalkan
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-muted-foreground"
                    disabled={mutation.isPending}
                    onClick={() => void remove(t)}
                  >
                    <Trash2 aria-hidden="true" className="h-3 w-3" />
                    Hapus
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        banners={(banners.data?.banners ?? []).map((b) => ({ id: b.id, title: b.title }))}
        promos={(promos.data?.promos ?? []).map((p) => ({ id: p.id, title: p.title }))}
        creating={mutation.isPending}
        onCreate={async (body) => {
          try {
            await mutation.mutateAsync({ action: "create", body });
            toast.success("Tugas dijadwalkan", { description: "Eksekutor bot akan menjalankannya tepat waktu." });
            setCreateOpen(false);
          } catch (e) {
            toast.error("Gagal membuat tugas", { description: (e as Error).message });
          }
        }}
      />

      <Dialog open={confirmCancel !== null} onOpenChange={(v) => !v && setConfirmCancel(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Batalkan tugas ini?</DialogTitle>
            <DialogDescription>
              “{confirmCancel?.label}” tidak akan dijalankan pada waktunya.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmCancel(null)}>
              Kembali
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => confirmCancel && void cancel(confirmCancel)}
            >
              Ya, batalkan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusChip({ status }: { status: ScheduleTask["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock3 aria-hidden="true" className="h-2.5 w-2.5" />
          menunggu
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 aria-hidden="true" className="h-2.5 w-2.5" />
          selesai
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
          <AlertTriangle aria-hidden="true" className="h-2.5 w-2.5" />
          gagal
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          dibatalkan
        </span>
      );
  }
}

function CreateTaskDialog({
  open,
  onOpenChange,
  banners,
  promos,
  creating,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  banners: Array<{ id: string; title: string }>;
  promos: Array<{ id: string; title: string }>;
  creating: boolean;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ScheduleTaskType>("maintenance-on");
  const [runAt, setRunAt] = useState(() => localDateTimeValue(new Date(Date.now() + 3600_000)));
  const [note, setNote] = useState("");
  const [targetId, setTargetId] = useState("");
  const [text, setText] = useState("");

  const needsBanner = type === "banner-on" || type === "banner-off";
  const needsPromo = type === "promo-on" || type === "promo-off";
  const needsText = type === "reminder" || type === "announcement-set";
  const needsNote = type === "maintenance-on" || type === "lockdown-on";

  const valid =
    label.trim().length >= 3 &&
    Boolean(runAt) &&
    (!needsBanner || Boolean(targetId)) &&
    (!needsPromo || Boolean(targetId)) &&
    (!needsText || text.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock aria-hidden="true" className="h-4 w-4 text-primary" />
            Tugas terjadwal baru
          </DialogTitle>
          <DialogDescription>
            Waktu dijalankan sesuai zona WIB. Eksekusi otomatis oleh layanan bot.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            const payload: Record<string, unknown> = {};
            if (needsNote && note.trim()) payload.note = note.trim();
            if (needsBanner || needsPromo) {
              payload[needsBanner ? "bannerId" : "promoId"] = targetId;
            }
            if (needsText) payload.text = text.trim();
            void onCreate({
              label: label.trim(),
              type,
              runAt: new Date(runAt).toISOString(),
              payload,
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-label">Nama tugas</Label>
            <Input
              id="task-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Maintenance tengah malam"
              maxLength={80}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Jenis tugas</Label>
              <Select value={type} onValueChange={(v) => setType(v as ScheduleTaskType)}>
                <SelectTrigger aria-label="Jenis tugas">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(Object.keys(TASK_META) as ScheduleTaskType[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {TASK_META[key].icon} {TASK_META[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-runat">Waktu jalan (WIB)</Label>
              <Input
                id="task-runat"
                type="datetime-local"
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
              />
            </div>
          </div>
          {needsNote ? (
            <div className="space-y-1.5">
              <Label htmlFor="task-note">{type === "lockdown-on" ? "Alasan lockdown" : "Pesan maintenance"}</Label>
              <Input
                id="task-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Perbaikan sistem 02:00–04:00 WIB"
                maxLength={300}
              />
            </div>
          ) : null}
          {needsBanner ? (
            <div className="space-y-1.5">
              <Label>Banner target</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger aria-label="Pilih banner">
                  <SelectValue placeholder={banners.length === 0 ? "Belum ada banner" : "Pilih banner…"} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {banners.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {needsPromo ? (
            <div className="space-y-1.5">
              <Label>Promo target</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger aria-label="Pilih promo">
                  <SelectValue placeholder={promos.length === 0 ? "Belum ada promo" : "Pilih promo…"} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {promos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {needsText ? (
            <div className="space-y-1.5">
              <Label htmlFor="task-text">{type === "reminder" ? "Isi pengingat" : "Teks announcement"}</Label>
              <Input
                id="task-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={type === "reminder" ? "Cek laporan penjualan" : "Promo weekend mulai hari ini!"}
                maxLength={500}
              />
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" size="sm" disabled={!valid || creating} className="font-semibold">
              Jadwalkan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
