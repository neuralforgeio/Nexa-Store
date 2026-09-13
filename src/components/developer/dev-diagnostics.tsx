"use client";

import { useDiagnostics } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { formatWib } from "@/lib/format/date";
import { RefreshCw, CheckCircle2, XCircle } from "lucide-react";

/** Diagnostics (PRD §17.3) — observed facts only, presence booleans, no values. */
export function DevDiagnostics() {
  const { data, isPending, isError, refetch, isFetching } = useDiagnostics(true);

  if (isPending) return <LoadingState label="Menjalankan pemeriksaan…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Diagnostics tidak dapat dijalankan"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hasil pemeriksaan nyata, tanpa status palsu.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw aria-hidden="true" className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Jalankan ulang
        </Button>
      </header>

      <section aria-label="Aplikasi" className="grid gap-3 sm:grid-cols-2">
        <Card title="Aplikasi">
          <Row label="Nama" value={data.app.name} />
          <Row label="Versi" value={data.app.version} mono />
          <Row label="Node env" value={data.runtime.nodeEnv} mono />
          <Row label="Mode penyimpanan" value={data.runtime.persistenceMode} mono />
        </Card>
        <Card title="Konfigurasi lingkungan">
          <Presence label="Kredensial login (AUTH_*)" present={data.environment.authConfigured} />
          <Presence label="SESSION_SECRET" present={data.environment.sessionSecretPresent} />
          <Presence label="GitHub (GITHUB_*)" present={data.environment.githubConfigured} />
          <Row
            label="Target GitHub"
            value={data.environment.githubTarget ?? "(mode lokal)"}
            mono={Boolean(data.environment.githubTarget)}
          />
        </Card>
      </section>

      <section aria-label="Repositori">
        <Card title="Repositori / penyimpanan">
          <Row label="Kesehatan" value={data.repository.health.detail} />
          <Row
            label="Revisi konten"
            value={data.repository.revision ? data.repository.revision.slice(0, 16) : "—"}
            mono
          />
          <Row
            label="Commit terakhir"
            value={
              data.repository.lastCommit
                ? `${data.repository.lastCommit.message}${data.repository.lastCommit.at ? ` · ${formatWib(new Date(data.repository.lastCommit.at))}` : ""}`
                : "—"
            }
          />
        </Card>
      </section>

      <section aria-label="Validasi data">
        <Card title="Validasi data katalog">
          {data.validation.ok ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-primary" />
              Semua berkas lolos validasi skema dan integritas.
            </p>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-sm">
                <XCircle aria-hidden="true" className="h-4 w-4 text-destructive" />
                {data.validation.issues.length} masalah ditemukan:
              </p>
              <ul className="scroll-slim mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                {data.validation.issues.map((issue, i) => (
                  <li key={i} className="font-mono text-muted-foreground">
                    {issue.file}
                    {issue.recordId ? `/${issue.recordId}` : ""}
                    {issue.field ? `.${issue.field}` : ""}: {issue.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card/40 p-4">
      <p className="font-display text-sm font-medium">{title}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </p>
  );
}

function Presence({ label, present }: { label: string; present: boolean }) {
  return (
    <p className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1.5 ${present ? "text-primary" : "text-muted-foreground"}`}>
        {present ? (
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {present ? "terkonfigurasi" : "tidak ada"}
      </span>
    </p>
  );
}
