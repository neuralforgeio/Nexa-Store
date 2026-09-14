"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { useReportsConsole, useReportsOwnerMutation, type ReportRecordView } from "@/lib/queries";
import { toast } from "sonner";
import {
  Bug,
  Download,
  EyeOff,
  Film,
  Flag,
  ImageIcon,
  Inbox,
  Lightbulb,
  Loader2,
  Paperclip,
  Search,
  Trash2,
} from "lucide-react";

/**
 * Konsol Laporan (v1.6.0, media preview v1.8.0) — laporan bug/saran/lainnya
 * dari pengunjung. Sejak v1.8.0 lampiran media TERSIMPAN dan bisa dilihat
 * langsung di sini: thumbnail gambar di kartu, klik (gambar/video) →
 * modal preview penuh + tombol unduh. Panel ini dipakai Admin & Developer.
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

type ReportMediaView = NonNullable<ReportRecordView["media"]> & { storedAt?: string };

function formatWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------------------
// Pengambilan media (blob terautentikasi → object URL)
// ---------------------------------------------------------------------------

type MediaFetchState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; url: string; mime: string; fileName: string; size: number }
  | { phase: "unavailable"; reason: string };

function useReportMedia(report: ReportRecordView | null): MediaFetchState {
  // Reset via key remount (call site) — initial phase langsung dari laporan,
  // effect hanya melakukan fetch (setState asinkron saja).
  const [state, setState] = useState<MediaFetchState>(() =>
    report?.media ? { phase: "loading" } : { phase: "idle" }
  );
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const media = report?.media as ReportMediaView | undefined;
    if (!report || !media) return;

    let cancelled = false;
    (async () => {
      if (!media.storedAt) {
        // Laporan pra-v1.8.0 — bytes media tidak pernah disimpan.
        if (!cancelled)
          setState({
            phase: "unavailable",
            reason:
              "Media laporan ini dibuat sebelum penyimpanan media aktif (v1.8.0) — bytes-nya hanya diteruskan ke Telegram saat itu.",
          });
        return;
      }
      try {
        const res = await fetch(`/api/developer/reports/${report.id}/media`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (!cancelled)
            setState({
              phase: "unavailable",
              reason:
                res.status === 404
                  ? "File media tidak ditemukan di penyimpanan."
                  : `Gagal memuat media (HTTP ${res.status}).`,
            });
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setState({ phase: "ready", url, mime: blob.type || media.mime, fileName: media.fileName, size: blob.size });
      } catch {
        if (!cancelled) setState({ phase: "unavailable", reason: "Koneksi gagal saat memuat media." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report?.id, report?.media?.storedAt]);

  // revoke saat unmount
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  return state;
}

// ---------------------------------------------------------------------------
// Thumbnail di kartu (gambar saja; video pakai chip ikon)
// ---------------------------------------------------------------------------

function ReportMediaThumb({ report, onOpen }: { report: ReportRecordView; onOpen: () => void }) {
  const media = report.media as ReportMediaView | null;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    if (!media || media.kind !== "image" || !media.storedAt) return;
    (async () => {
      try {
        const res = await fetch(`/api/developer/reports/${report.id}/media`, {
          cache: "default",
          credentials: "same-origin",
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setThumbUrl(url);
      } catch {
        // thumbnail opsional — diam saja
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [report.id, media?.storedAt, media?.kind]);

  if (!media) return null;

  if (media.kind === "image" && media.storedAt) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group relative mt-3 block h-28 w-full max-w-[220px] overflow-hidden rounded-lg border bg-muted"
        aria-label={`Lihat gambar lampiran laporan ${report.id}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`Lampiran laporan ${report.id}`}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <ImageIcon aria-hidden="true" className="h-8 w-8 text-muted-foreground/50" />
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/40">
          <span className="rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium opacity-0 transition group-hover:opacity-100">
            Klik untuk perbesar
          </span>
        </span>
      </button>
    );
  }

  // Video / arsip lama → chip klik (bukan thumbnail).
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground/90 transition hover:bg-muted disabled:cursor-not-allowed"
      aria-label={media.kind === "video" ? `Putar video lampiran laporan ${report.id}` : `Buka lampiran laporan ${report.id}`}
    >
      {media.kind === "video" ? (
        <Film aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      ) : (
        <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      )}
      <span className="truncate">
        {media.kind === "video" ? "Video" : "Gambar"} · {formatSize(media.size)}
      </span>
      <span className="text-muted-foreground">· Klik untuk {media.kind === "video" ? "putar" : "lihat"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal preview media
// ---------------------------------------------------------------------------

function ReportMediaModal({
  report,
  onOpenChange,
}: {
  report: ReportRecordView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const media = (report?.media as ReportMediaView | null) ?? null;
  const state = useReportMedia(report);

  return (
    <Dialog open={report !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {media?.kind === "video" ? (
              <Film aria-hidden="true" className="h-5 w-5 text-primary" />
            ) : (
              <ImageIcon aria-hidden="true" className="h-5 w-5 text-primary" />
            )}
            Lampiran {media?.kind === "video" ? "video" : "gambar"}
            <span className="font-mono text-xs font-normal text-muted-foreground">{report?.id}</span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {media?.fileName ?? "—"} · {media ? formatSize(media.size) : ""}
            {state.phase === "ready" ? ` · ${formatSize(state.size)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] items-center justify-center overflow-auto rounded-lg border bg-black/5 p-2 dark:bg-black/40">
          {state.phase === "loading" ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin" />
              <p className="text-sm">Memuat media…</p>
            </div>
          ) : state.phase === "unavailable" ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <EyeOff aria-hidden="true" className="h-8 w-8" />
              <p className="max-w-sm text-center text-sm">{state.reason}</p>
            </div>
          ) : state.phase === "ready" ? (
            state.mime.startsWith("video/") ? (
              <video
                src={state.url}
                controls
                playsInline
                className="max-h-[60vh] w-auto rounded"
                aria-label={`Video lampiran laporan ${report?.id}`}
              />
            ) : (
              /* blob URL lokal, bukan aset Next */
              <img
                src={state.url}
                alt={`Lampiran laporan ${report?.id}`}
                className="max-h-[60vh] w-auto rounded"
              />
            )
          ) : (
            <p className="py-10 text-sm text-muted-foreground">Laporan ini tidak memiliki lampiran.</p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">
            Media tersimpan permanen di data store — juga terkirim ke Telegram.
          </p>
          <div className="flex gap-2">
            {state.phase === "ready" ? (
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <a href={state.url} download={state.fileName}>
                  <Download aria-hidden="true" className="h-3.5 w-3.5" />
                  Unduh
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Tutup
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Konsol utama
// ---------------------------------------------------------------------------

export function DevReports() {
  const { data, isPending, isError, refetch } = useReportsConsole(true);
  const mutation = useReportsOwnerMutation();
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ReportRecordView | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [previewReport, setPreviewReport] = useState<ReportRecordView | null>(null);

  const reports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.reports ?? []).filter(
      (r) =>
        !q ||
        r.text.toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [data, search]);

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

  function removeOne(r: ReportRecordView) {
    mutation.mutate(
      { action: "delete", id: r.id },
      {
        onSuccess: () => {
          toast.success("Laporan dihapus.");
          setPendingDelete(null);
          if (previewReport?.id === r.id) setPreviewReport(null);
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
          setPreviewReport(null);
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
            Laporan bug, saran fitur, dan pesan lain dari pengunjung — terkirim
            ke Telegram saat dibuat. Klik lampiran untuk preview gambar/video.
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
                  <span className="ml-auto text-xs text-muted-foreground">{formatWib(r.createdAt)} WIB</span>
                </div>
                <p className="mt-2.5 text-sm">
                  <span className="font-medium">{r.name ?? "Tanpa nama"}</span>
                  <span className="text-muted-foreground"> — </span>
                  {r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text}
                </p>
                {r.media ? (
                  <ReportMediaThumb report={r} onOpen={() => setPreviewReport(r)} />
                ) : null}
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

      {/* key=id → state media di-reset tiap ganti laporan (remount) */}
      <ReportMediaModal
        key={previewReport?.id ?? "none"}
        report={previewReport}
        onOpenChange={(o) => !o && setPreviewReport(null)}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus laporan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Laporan {pendingDelete?.id} akan dihapus permanen dari data store —
              termasuk file medianya.
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
              Semua {data.reports.length} laporan akan dihapus permanen beserta
              file medianya. Tindakan ini tidak bisa dibatalkan.
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
