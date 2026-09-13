"use client";

import { useState } from "react";
import { useGitStatus, useDataInspector } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState, ErrorState, EmptyState } from "@/components/shared/state-views";
import { api, ApiError } from "@/lib/api-client";
import { formatWib } from "@/lib/format/date";
import { Loader2, RefreshCw, GitCompareArrows, History, RotateCcw } from "lucide-react";
import { toast } from "sonner";

/** Git Sync panel (PRD §17.1) + rollback-oriented inspection (§43). */
export function DevGit() {
  const { data, isPending, isError, refetch, isFetching } = useGitStatus(true);
  const inspector = useDataInspector(true);
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<{ revision: string; message: string } | null>(null);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{
    gamesChanged: number;
    productsChanged: number;
    lines: string[];
    settingsChanged: boolean;
    templateChanged: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return <LoadingState label="Memuat status sinkronisasi…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Status sinkronisasi tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const loadDiff = async (revision: string) => {
    setBusy(true);
    setDiffFor(revision);
    setDiffData(null);
    try {
      const result = await api.get<{
        gamesChanged: number;
        productsChanged: number;
        settingsChanged: boolean;
        templateChanged: boolean;
        lines: string[];
      }>(`/api/developer/git?action=diff&ref=${encodeURIComponent(revision)}`);
      setDiffData(result);
    } catch (e) {
      toast.error("Gagal memuat pratinjau", {
        description: e instanceof ApiError ? e.message : "Coba lagi.",
      });
      setDiffFor(null);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (revision: string) => {
    setBusy(true);
    try {
      const result = await api.post<{ revision: string }>("/api/developer/git", {
        action: "restore",
        ref: revision,
        baseRevision: data.revision,
        confirm: true,
      });
      toast.success("Restore selesai", {
        description: `Data dikembalikan dari ${revision} sebagai commit baru · revisi ${result.revision.slice(0, 12)}`,
      });
      setRestoring(null);
      qc.invalidateQueries({ queryKey: ["git-status"] });
      qc.invalidateQueries({ queryKey: ["mgmt-catalog"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    } catch (e) {
      toast.error("Restore gagal", {
        description: e instanceof ApiError ? e.message : "Data tidak berubah.",
        duration: 9000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Git Sync</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status penyimpanan katalog dan riwayat commit.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw aria-hidden="true" className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <section aria-label="Status penyimpanan" className="grid gap-3 sm:grid-cols-2">
        <InfoRow label="Mode penyimpanan" value={data.adapter} mono />
        <InfoRow label="Kesehatan" value={data.health.detail} tone={data.health.ok ? "ok" : "warn"} />
        <InfoRow label="Revisi saat ini" value={data.revision.slice(0, 16)} mono />
        <InfoRow label="Dibaca" value={formatWib(new Date(data.readAt))} />
      </section>

      <section aria-label="Validasi data">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Validasi data
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              inspector.refetch();
              toast.info(inspector.data?.validation.ok ? "Data valid" : `${inspector.data?.validation.issues.length} masalah ditemukan`);
            }}
          >
            Validasi
          </Button>
        </div>
        <div className="mt-3 rounded-lg border p-4 text-sm">
          {inspector.data ? (
            inspector.data.validation.ok ? (
              <p className="text-muted-foreground">Semua berkas katalog lolos validasi skema dan integritas.</p>
            ) : (
              <ul className="scroll-slim max-h-40 space-y-1 overflow-y-auto text-xs text-destructive">
                {inspector.data.validation.issues.slice(0, 20).map((issue, i) => (
                  <li key={i} className="font-mono">
                    {issue.file}
                    {issue.recordId ? `/${issue.recordId}` : ""}
                    {issue.field ? `.${issue.field}` : ""}: {issue.reason}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-muted-foreground">Memuat…</p>
          )}
        </div>
      </section>

      <section aria-label="Riwayat commit">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Riwayat ({data.adapter === "github" ? "commit GitHub" : "snapshot lokal"})
        </h2>
        {data.history.length === 0 ? (
          <EmptyState className="mt-3" title="Belum ada riwayat" description="Riwayat terbentuk setelah sinkronisasi pertama." />
        ) : (
          <ul className="mt-3 divide-y divide-border/60 rounded-lg border">
            {data.history.map((h) => (
              <li key={h.revision + h.at} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <History aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{h.revision.slice(0, 12)}</span>
                <span className="min-w-0 flex-1 truncate">{h.message}</span>
                <span className="text-xs text-muted-foreground">{h.at ? formatWib(new Date(h.at)) : "—"}</span>
                <span className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void loadDiff(h.revision)} disabled={busy}>
                    <GitCompareArrows aria-hidden="true" className="h-3 w-3" />
                    Pratinjau restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    onClick={() => setRestoring({ revision: h.revision, message: h.message })}
                  >
                    <RotateCcw aria-hidden="true" className="h-3 w-3" />
                    Restore
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={diffFor !== null} onOpenChange={(open) => !open && setDiffFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Pratinjau restore</DialogTitle>
            <DialogDescription>
              Perubahan yang akan diterapkan bila data dikembalikan ke revisi{" "}
              <span className="font-mono">{diffFor?.slice(0, 12)}</span>. Restore menulis commit
              baru, bukan menghapus riwayat.
            </DialogDescription>
          </DialogHeader>
          {diffData ? (
            <div className="scroll-slim max-h-64 space-y-2 overflow-y-auto rounded-md border bg-card/50 p-4 text-sm">
              <p className="text-muted-foreground">
                Game berubah: {diffData.gamesChanged} · Produk berubah: {diffData.productsChanged}
                {diffData.settingsChanged ? " · Pengaturan berubah" : ""}
                {diffData.templateChanged ? " · Template berubah" : ""}
              </p>
              {diffData.lines.length > 0 ? (
                <ul className="space-y-1 font-mono text-xs">
                  {diffData.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ada detail tambahan.</p>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Memuat perbandingan…
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDiffFor(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Konfirmasi restore</DialogTitle>
            <DialogDescription>
              Data akan dikembalikan ke revisi{" "}
              <span className="font-mono">{restoring?.revision.slice(0, 12)}</span> ({restoring?.message}).
              Validasi dijalankan sebelum penulisan. Bila data revisi tersebut tidak lolos,
              restore ditolak. Tindakan ini menulis commit baru dan tetap bisa dibatalkan lewat
              restore berikutnya.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRestoring(null)}>Batal</Button>
            <Button
              size="sm"
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => restoring && void restore(restoring.revision)}
              disabled={busy}
            >
              {busy ? <Loader2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Restore data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  tone = "ok",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm ${mono ? "font-mono" : ""} ${tone === "warn" ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
