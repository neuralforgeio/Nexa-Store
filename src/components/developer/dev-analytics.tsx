"use client";

import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/shared/state-views";
import { useAnalytics } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  BarChart3,
  Eye,
  Users,
  RadioTower,
  TrendingUp,
  MousePointerClick,
  MessageCircle,
  Share2,
  MonitorSmartphone,
} from "lucide-react";

/**
 * Visitor analytics dashboard (v1.3.0) — first-party tracking, WIB-day
 * buckets, live visitor counter (5-minute window). The bot's daily Telegram
 * digest reads the same numbers.
 */
export function DevAnalytics() {
  const { data, isPending, isError, refetch } = useAnalytics(true);

  if (isPending) return <LoadingState label="Memuat analitik…" />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Analitik tidak dapat dimuat"
        action={<Button size="sm" variant="outline" onClick={() => refetch()}>Coba lagi</Button>}
      />
    );
  }

  const chartData = data.series.map((d) => ({
    date: d.date.slice(5).replace("-", "/"),
    views: d.views,
    uniques: d.uniques,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Analitik Pengunjung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pelacakan pihak pertama tanpa cookie lintas situs — hari dibakukan ke WIB.
        </p>
      </header>

      {/* Stat cards */}
      <section aria-label="Ringkasan" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<RadioTower aria-hidden="true" className="h-4 w-4" />}
          label="Online sekarang"
          value={String(data.live)}
          tone="live"
        />
        <Stat icon={<Eye aria-hidden="true" className="h-4 w-4" />} label="Views hari ini" value={String(data.today.views)} />
        <Stat icon={<Users aria-hidden="true" className="h-4 w-4" />} label="Unik hari ini" value={String(data.today.uniques)} />
        <Stat icon={<TrendingUp aria-hidden="true" className="h-4 w-4" />} label="Views 30 hari" value={String(data.last30.views)} />
      </section>

      {/* 30-day chart */}
      <section aria-label="Tren 30 hari" className="rounded-xl border bg-card/50 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <BarChart3 aria-hidden="true" className="h-3.5 w-3.5" />
          Tren 30 hari
        </p>
        <div className="h-56 w-full" role="img" aria-label="Grafik area views dan pengunjung unik 30 hari terakhir">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.16 35)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="oklch(0.62 0.16 35)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="uniquesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.55 0.12 150)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="oklch(0.55 0.12 150)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.5 0 0 / 0.12)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} stroke="oklch(0.5 0 0 / 0.6)" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="oklch(0.5 0 0 / 0.6)" tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.19 0.02 40 / 0.95)",
                  border: "1px solid oklch(0.5 0 0 / 0.25)",
                  borderRadius: 10,
                  fontSize: 12,
                }}
                labelStyle={{ color: "oklch(0.9 0 0)" }}
              />
              <Area type="monotone" dataKey="views" name="Views" stroke="oklch(0.62 0.16 35)" strokeWidth={2} fill="url(#viewsFill)" />
              <Area type="monotone" dataKey="uniques" name="Unik" stroke="oklch(0.55 0.12 150)" strokeWidth={2} fill="url(#uniquesFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Top pages */}
        <section aria-label="Halaman terpopuler" className="rounded-xl border bg-card/50 p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MousePointerClick aria-hidden="true" className="h-3.5 w-3.5" />
            Halaman terpopuler (30 hari)
          </p>
          <ul className="space-y-2">
            {data.topPages.length === 0 ? (
              <li className="text-sm text-muted-foreground">Belum ada data.</li>
            ) : (
              data.topPages.map((p, i) => (
                <li key={p.path} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                    <span className="font-mono text-[13px]">{p.path}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular">{p.views}</span>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Referrers */}
        <section aria-label="Sumber trafik" className="rounded-xl border bg-card/50 p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Share2 aria-hidden="true" className="h-3.5 w-3.5" />
            Sumber trafik (30 hari)
          </p>
          <ul className="space-y-2">
            {data.topReferrers.length === 0 ? (
              <li className="text-sm text-muted-foreground">Belum ada data.</li>
            ) : (
              data.topReferrers.map((r, i) => (
                <li key={r.referrer} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                    {r.referrer}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular">{r.views}</span>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Devices + events */}
        <section aria-label="Perangkat dan interaksi" className="space-y-4">
          <div className="rounded-xl border bg-card/50 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MonitorSmartphone aria-hidden="true" className="h-3.5 w-3.5" />
              Perangkat (30 hari)
            </p>
            <ul className="space-y-2">
              {data.devices.map((d) => (
                <li key={d.device} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="capitalize">{d.device}</span>
                  <span className="font-mono text-xs font-semibold tabular">{d.views}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border bg-card/50 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
              Interaksi (7 hari)
            </p>
            <ul className="space-y-2 text-sm">
              <EventRow label="Chat dibuka" value={data.last7.events["chat_open"] ?? 0} />
              <EventRow label="Lanjut order" value={data.last7.events["order_click"] ?? 0} />
              <EventRow label="Lanjut ke WhatsApp" value={data.last7.events["wa_handoff"] ?? 0} />
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "live";
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular",
          tone === "live" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
        {tone === "live" ? (
          <span aria-hidden="true" className="ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500 align-middle" />
        ) : null}
      </p>
    </div>
  );
}

function EventRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-semibold tabular">{value}</span>
    </li>
  );
}
