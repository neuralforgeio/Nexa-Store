"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { useReportsConsole, useReportsOwnerMutation, type ReportRecordView } from "@/lib/queries";
import { toast } from "sonner";
import { Bug, Flag, Inbox, Lightbulb, Paperclip, Search, Trash2 } from "lucide-react";

/**
 * Konsol Laporan (v1.6.0) — laporan bug/saran/lainnya dari pengunjung.
 * Media (gambar/video) diteruskan ke Telegram saat laporan dibuat — di sini
 * tampil metadata + indikator lampiran. Panel ini dipakai Admin & Developer.
 */

const TYPE_META: Record<
  ReportRecordView["type"],
  { label: string; Icon: typeof Bug; badge: string }
> = {
  bug: { label: "Bug", Icon: Bug, badge: "bg-red-500/10 text-red-600 border-red-500/30 dark:text-red-400" },
  feature: {
    label: "Saran Fitur",
    Icon: Lightbulb,
    badge: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
  },
  other: { label: "Lainnya", Icon: Flag, badge: "bg-primary/10 text-primary border-primary/30" },
};

function formatWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function DevReports() {
  const { data, isPending, isError, refetch } = useReportsConsole(true);
  const mutation = useReportsOwnerMutation();
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ReportRecordView | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  if (isPending) return <LoadingState label="Memuat laporan…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Laporan tidak dapat dimuat"
        action={
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Coba lagi
          </Button>
        }
      />
    );
  }

  const q = search.trim().toLowerCase();
  const reports = data.reports.filter(
    (r) =>
      !q ||
      r.text.toLowerCase().includes(q) ||
      (r.name ?? "").toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)
  );

  function removeOne(r: ReportRecordView) {
    mutation.mutate(
      { action: "delete", id: r.id },
      {
        onSuccess: () => {
          toast.success("Laporan dihapus.");
          setPendingDelete(null);
        },
        onError: (e) => toast.error("Gagal menghapus laporan", { description: (e as Error).message }),
      }
    );
  }

  function clearAll() {
    mutation.mutate(
      { action: "clearAll" },
      {
        onSuccess: () => {
          toast.success("Semua laporan dihapus.");
          setConfirmClearAll(false);
        },
        onError: (e) => toast.error("Gagal menghapus laporan", { description: (e as Error).message }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Laporan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Laporan bug, saran fitur, dan pesan lain dari pengunjung — juga
            terkirim ke Telegram saat dibuat. Media lampiran ada di Telegram.
          </p>
        </div>
        {data.reports.length > 0 ? (
          <Button
            variant="outline"
            className="gap-2 text-red-600 hover:text-red-700 dark:text-red-400"
            onClick={() => setConfirmClearAll(true)}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            Hapus semua
          </Button>
        ) : null}
      </header>

      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari isi laporan, nama, atau ID…"
          className="pl-9"
        />
      </div>

      {reports.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-12 text-center">
          <Inbox aria-hidden="true" className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {data.reports.length === 0
              ? "Belum ada laporan masuk. Pengunjung mengirim laporan lewat halaman /reports."
              : "Tidak ada laporan yang cocok dengan pencarian."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const meta = TYPE_META[r.type];
            return (
              <li key={r.id} className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`gap-1.5 ${meta.badge}`}>
                    <meta.Icon aria-hidden="true" className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
                  {r.media ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip aria-hidden="true" className="h-3 w-3" />
                      {r.media.kind === "image" ? "Gambar" : "Video"} ·{" "}
                      {(r.media.size / 1024 / 1024).toFixed(2)} MB (di Telegram)
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">{formatWib(r.createdAt)} WIB</span>
                </div>
                <p className="mt-2.5 text-sm">
                  <span className="font-medium">{r.name ?? "Tanpa nama"}</span>
                  <span className="text-muted-foreground"> — </span>
                  {r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text}
                </p>
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400"
                    onClick={() => setPendingDelete(r)}
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    Hapus
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus laporan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Laporan {pendingDelete?.id} akan dihapus permanen dari data store.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => pendingDelete && removeOne(pendingDelete)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus SEMUA laporan?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua {data.reports.length} laporan akan dihapus permanen. Tindakan
              ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={clearAll}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Menghapus…" : "Hapus semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
