"use client";

import { useQuery } from "@tanstack/react-query";
import { useManagementCatalog, useDiagnostics, useGitStatus } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { GameMark } from "@/components/shared/game-mark";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { formatWib } from "@/lib/format/date";
import type { Role } from "@/lib/catalog/types";
import { AlertTriangle, CheckCircle2, Package, Gamepad2, EyeOff, GitBranch } from "lucide-react";

/** Admin dashboard — real catalog-derived metrics only (PRD §15). */
export function AdminDashboard({ role, onNavigate }: { role: Role; onNavigate: (hash: string) => void }) {
  const { data, isPending, isError, refetch } = useManagementCatalog(true);
  const { data: diagnostics } = useDiagnostics(role === "DEVELOPER");
  const { data: git } = useGitStatus(role === "DEVELOPER");

  if (isPending) return <LoadingState label="Memuat ringkasan store…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Data tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const activeGames = data.games.filter((g) => g.enabled).length;
  const activeProducts = data.products.filter((p) => p.enabled).length;
  const disabledProducts = data.products.filter((p) => !p.enabled).length;
  const gamesWithoutFields = data.games.filter((g) => g.orderFieldSchema.length === 0);
  const warnings: string[] = [];
  if (gamesWithoutFields.length > 0) {
    warnings.push(
      `${gamesWithoutFields.length} game tanpa field pesanan: ${gamesWithoutFields.map((g) => g.name).join(", ")}`
    );
  }
  const zeroPriceActive = data.products.filter((p) => p.enabled && p.priceIdr <= 0);
  if (zeroPriceActive.length > 0) {
    warnings.push(`${zeroPriceActive.length} produk aktif tanpa harga valid`);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Ringkasan store</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Status operasional dari data katalog saat ini, bukan analitik.
        </p>
      </header>

      <section aria-label="Status store" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={Gamepad2} label="Game aktif" value={activeGames} />
        <Metric icon={Package} label="Produk aktif" value={activeProducts} />
        <Metric icon={EyeOff} label="Produk nonaktif" value={disabledProducts} />
        <Metric
          icon={AlertTriangle}
          label="Peringatan konfigurasi"
          value={warnings.length}
          tone={warnings.length > 0 ? "warn" : "ok"}
        />
      </section>

      {warnings.length > 0 ? (
        <section aria-label="Peringatan konfigurasi" className="rounded-xl border border-primary/30 bg-primary/6 p-4 shadow-card">
          <p className="flex items-center gap-2 font-display text-sm font-medium">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 text-primary" />
            Perlu perhatian
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70" />
                {w}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-label="Status validasi" className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-primary" />
          Konfigurasi katalog tidak menunjukkan masalah.
        </section>
      )}

      <section aria-label="Aksi cepat">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">Aksi cepat</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate("/admin/products")}>
            Kelola produk
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/admin/games")}>
            Kelola game
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/admin/promo")}>
            Event promo
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/admin/banner")}>
            Banner pengumuman
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/admin/chat")}>
            Balas obrolan
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/admin/settings")}>
            Pengaturan store
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/")}>
            Lihat storefront
          </Button>
        </div>
      </section>

      <section aria-label="Game terpopuler berdasarkan jumlah produk" className="section-line pt-6">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Game dengan produk terbanyak
        </h2>
        <ul className="mt-3 divide-y divide-border/60">
          {[...data.games]
            .sort((a, b) => {
              const count = (id: string) => data.products.filter((p) => p.gameId === id && p.enabled).length;
              return count(b.id) - count(a.id);
            })
            .slice(0, 5)
            .map((g) => {
              const count = data.products.filter((p) => p.gameId === g.id && p.enabled).length;
              return (
                <li key={g.id} className="flex items-center gap-3 py-2.5">
                  <GameMark name={g.name} image={g.image} size="sm" />
                  <span className="text-sm">{g.name}</span>
                  {!g.enabled ? <span className="text-xs text-muted-foreground">(nonaktif)</span> : null}
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{count} produk aktif</span>
                </li>
              );
            })}
        </ul>
      </section>

      {role === "DEVELOPER" ? (
        <section aria-label="Status sinkronisasi" className="section-line pt-6">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Status sinkronisasi
          </h2>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <GitBranch aria-hidden="true" className="h-4 w-4" />
              Mode: <span className="font-mono text-foreground">{data.adapter}</span> · revisi{" "}
              <span className="font-mono text-foreground">{data.revision.slice(0, 16)}</span>
            </p>
            {git?.history?.[0] ? (
              <p>
                Commit terakhir: <span className="font-mono text-foreground">{git.history[0].message}</span>
                {git.history[0].at ? ` · ${formatWib(new Date(git.history[0].at))}` : ""}
              </p>
            ) : null}
            {diagnostics && !diagnostics.validation.ok ? (
              <p className="text-destructive">
                Validasi data menemukan {diagnostics.validation.issues.length} masalah. Lihat Diagnostics.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "ok",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className={`mt-2 font-mono text-2xl font-semibold tabular ${tone === "warn" && value > 0 ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}
