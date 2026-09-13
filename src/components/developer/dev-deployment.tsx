"use client";

import { useDiagnostics, useGitStatus } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { formatWib } from "@/lib/format/date";
import { ExternalLink } from "lucide-react";

/**
 * Deployment references (PRD §17.4).
 * Honest boundary: deployment status is verifiable only when GitHub mode is
 * configured AND Vercel is linked. Nothing is faked here.
 */
export function DevDeployment() {
  const { data, isPending, isError, refetch } = useDiagnostics(true);
  const git = useGitStatus(true);

  if (isPending) return <LoadingState label="Memuat referensi deployment…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Referensi tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const githubMode = data.runtime.persistenceMode === "github";
  const target = data.environment.githubTarget;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Deployment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Referensi antara commit data dan deployment. Hanya yang benar-benar terverifikasi.
        </p>
      </header>

      <section className="rounded-lg border bg-card/40 p-4">
        <p className="font-display text-sm font-medium">Status verifikasi</p>
        <div className="mt-3 space-y-2 text-sm">
          <p className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Mode penyimpanan</span>
            <span className="font-mono text-xs">{data.runtime.persistenceMode}</span>
          </p>
          <p className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Target repository</span>
            <span className="font-mono text-xs">{target ?? "—"}</span>
          </p>
          <p className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Revisi konten terverifikasi</span>
            <span className="font-mono text-xs">
              {git.data?.revision ? git.data.revision.slice(0, 16) : "—"}
            </span>
          </p>
          <p className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Status deployment Vercel</span>
            <span className="text-xs">
              {githubMode
                ? "Pemeriksaan commit GitHub vs deployment aktif, dilakukan dari dashboard Vercel setelah deploy."
                : "Belum dapat diverifikasi. Mode lokal tidak memiliki deployment terkait."}
            </span>
          </p>
        </div>
      </section>

      <section className="rounded-lg border p-4 text-sm leading-relaxed text-muted-foreground">
        <p className="font-display text-sm font-medium text-foreground">Cara kerja deployment</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Setiap sinkronisasi katalog menulis commit baru
            {githubMode ? " ke repository GitHub." : " ke penyimpanan lokal (mode ini dipakai saat GITHUB_* belum diisi)."}
          </li>
          <li>Push ke GitHub memicu build Vercel secara otomatis (Git integration).</li>
          <li>
            Deployment dianggap berhasil hanya setelah build Vercel selesai dan URL produksi
            menayangkan commit yang dimaksud. Status itu diverifikasi manual dari dashboard
            hingga integrasi status Vercel diaktifkan.
          </li>
        </ol>
        <p className="mt-3 text-xs">
          Commit data terakhir yang diketahui:{" "}
          <span className="font-mono text-foreground">
            {git.data?.history?.[0]?.message ?? "belum ada"}
          </span>
          {git.data?.history?.[0]?.at ? ` · ${formatWib(new Date(git.data.history[0].at))}` : ""}
        </p>
      </section>

      {githubMode && target ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            window.open(
              `https://github.com/${target.split(" @ ")[0]}/commits`,
              "_blank",
              "noopener,noreferrer"
            )
          }
        >
          <ExternalLink aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
          Buka riwayat commit repository
        </Button>
      ) : null}
    </div>
  );
}
