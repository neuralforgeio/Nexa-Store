"use client";

import { useDiagnostics, useGitStatus } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { formatWib } from "@/lib/format/date";
import type { Role } from "@/lib/catalog/types";
import { Database, GitBranch, Activity, KeyRound, Power, Rocket, Percent, Megaphone, MessagesSquare, BarChart3, AlarmClock } from "lucide-react";

/** Developer dashboard: engineering overview + tool entry points. */
export function DevDashboard({ role, onNavigate }: { role: Role; onNavigate: (hash: string) => void }) {
  const { data, isPending, isError, refetch } = useDiagnostics(true);
  const git = useGitStatus(true);

  if (isPending) return <LoadingState label="Memuat status sistem…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Status tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const tools = [
    { hash: "/dev/access", icon: KeyRound, title: "Akses", desc: "Kontrol akses Admin: blokir atau buka kembali login Admin." },
    { hash: "/dev/control", icon: Power, title: "Kontrol Situs", desc: "Lockdown total atau per-route, dan mode pemeliharaan situs." },
    { hash: "/dev/promo", icon: Percent, title: "Event Promo", desc: "Diskon terjadwal — harga storefront berubah otomatis tanpa deploy." },
    { hash: "/dev/banner", icon: Megaphone, title: "Banner", desc: "Pengumuman berwarna dengan CTA, terbit instan ke seluruh storefront." },
    { hash: "/dev/chat", icon: MessagesSquare, title: "Obrolan", desc: "Chat live pengunjung — balas dari sini atau langsung dari Telegram." },
    { hash: "/dev/analytics", icon: BarChart3, title: "Analitik", desc: "Pengunjung live, views, halaman populer, sumber trafik, perangkat." },
    { hash: "/dev/schedule", icon: AlarmClock, title: "Tugas Terjadwal", desc: "Otomasi berwaktu: gate, promo, banner, dan pengingat Telegram." },
    { hash: "/dev/git", icon: GitBranch, title: "Git Sync", desc: "Status penyimpanan, riwayat commit, validasi, dan restore berorientasi inspeksi." },
    { hash: "/dev/data", icon: Database, title: "Data Inspector", desc: "Berkas kanonik ternormalisasi. Telusuri, filter, salin, ekspor." },
    { hash: "/dev/diagnostics", icon: Activity, title: "Diagnostics", desc: "Konfigurasi lingkungan, kesehatan penyimpanan, dan laporan validasi." },
    { hash: "/dev/deployment", icon: Rocket, title: "Deployment", desc: "Referensi commit vs deployment. Tanpa klaim palsu." },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Developer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Perkakas teknis di atas kemampuan Admin. Batas peran ditegakkan di server.
        </p>
      </header>

      <section aria-label="Status sistem" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Versi aplikasi" value={data.app.version} mono />
        <Stat label="Mode penyimpanan" value={data.runtime.persistenceMode} mono />
        <Stat label="Lingkungan" value={data.runtime.nodeEnv} mono />
        <Stat
          label="Masalah validasi"
          value={String(data.validation.issues.length)}
          tone={data.validation.ok ? "ok" : "warn"}
          mono
        />
      </section>

      <section aria-label="Alat developer">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Alat
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <button
              key={tool.hash}
              type="button"
              onClick={() => onNavigate(tool.hash)}
              className="rounded-lg border bg-card/40 p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <p className="flex items-center gap-2 font-display text-sm font-medium">
                <tool.icon aria-hidden="true" className="h-4 w-4 text-primary" />
                {tool.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{tool.desc}</p>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Revisi terakhir" className="section-line pt-6">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Revisi terakhir
        </h2>
        <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <p>
            Revisi konten: <span className="font-mono text-foreground">{data.repository.revision?.slice(0, 16) ?? "—"}</span>
          </p>
          {git.data?.history?.[0] ? (
            <p>
              Commit terakhir: <span className="font-mono text-foreground">{git.data.history[0].message}</span>
              {git.data.history[0].at ? ` · ${formatWib(new Date(git.data.history[0].at))}` : ""}
            </p>
          ) : null}
          <p>
            Kesehatan penyimpanan:{" "}
            <span className={data.repository.health.ok ? "text-primary" : "text-destructive"}>
              {data.repository.health.detail}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, mono, tone = "ok" }: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-lg border bg-card/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${mono ? "font-mono text-base" : ""} ${tone === "warn" ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}
