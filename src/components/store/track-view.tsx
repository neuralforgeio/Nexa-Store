"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RouteLink } from "@/components/shared/route-link";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIdr } from "@/lib/format/idr";
import { track } from "@/lib/analytics/tracker";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  PackageSearch,
  RefreshCcw,
  Search,
  XCircle,
} from "lucide-react";

/**
 * Lacak pesanan (v1.6.0) — /track.
 * Masukkan ID Order (NEXA-YYMMDD-XXXX) yang tertera di pesan WhatsApp
 * pesananmu untuk melihat status terbaru beserta keterangan dari admin.
 */

type OrderStatus = "pending" | "processing" | "success" | "cancel";

type TrackedOrder = {
  id: string;
  summary: string;
  source: "instant" | "cart";
  items: Array<{ gameName: string; productName: string; price: number }>;
  total: number;
  status: OrderStatus;
  statusReason: string | null;
  statusUpdatedAt: string | null;
  createdAt: string;
  history: Array<{ status: OrderStatus; at: string; reason: string | null }>;
};

const STATUS_META: Record<
  OrderStatus,
  { label: string; badge: string; Icon: typeof Clock3 }
> = {
  pending: {
    label: "Menunggu",
    badge: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
    Icon: Clock3,
  },
  processing: {
    label: "Diproses",
    badge: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-400",
    Icon: RefreshCcw,
  },
  success: {
    label: "Selesai",
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  cancel: {
    label: "Dibatalkan",
    badge: "bg-red-500/10 text-red-600 border-red-500/30 dark:text-red-400",
    Icon: XCircle,
  },
};

function formatWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function TrackView() {
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(id?: string) {
    const target = (id ?? query).trim().toUpperCase();
    if (!target) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      track("order_track");
      const res = await fetch(`/api/orders/track?id=${encodeURIComponent(target)}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: TrackedOrder;
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Pesanan tidak ditemukan.");
      }
      setOrder(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const statusMeta = order ? STATUS_META[order.status] : null;

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <RouteLink
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Beranda
        </RouteLink>

        <div className="mt-5 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <PackageSearch aria-hidden="true" className="h-6 w-6" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Lacak Pesanan
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Masukkan ID Order yang tertera pada pesan WhatsApp pesananmu untuk
              melihat status dan keterangan dari admin.
            </p>
          </div>
        </div>
      </motion.div>

      <Reveal delay={0.08} className="mt-8">
        <section aria-labelledby="track-form" className="rounded-2xl border bg-card p-6 shadow-card sm:p-8">
          <h2 id="track-form" className="font-display text-lg font-semibold">
            Cek status pesanan
          </h2>
          <div className="mt-5 space-y-2">
            <Label htmlFor="track-id">ID Order</Label>
            <div className="flex gap-2.5">
              <Input
                id="track-id"
                value={query}
                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void search();
                }}
                placeholder="NEXA-260914-A7KP"
                className="font-mono"
                autoComplete="off"
              />
              <Button onClick={() => search()} disabled={loading || !query.trim()} className="shrink-0 gap-2 font-semibold">
                {loading ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Search aria-hidden="true" className="h-4 w-4" />
                )}
                Lacak
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Format: NEXA-TANGGAL-KODE, contoh NEXA-260914-A7KP.
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </div>
          ) : null}

          {order && statusMeta ? (
            <div className="mt-6 space-y-5" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-semibold">{order.id}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Dibuat {formatWib(order.createdAt)} WIB ·{" "}
                    {order.source === "cart" ? "Keranjang" : "Pesan instan"}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.badge}`}
                >
                  <statusMeta.Icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {statusMeta.label}
                </span>
              </div>

              {order.statusReason ? (
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Keterangan admin
                  </p>
                  <p className="mt-1 text-sm leading-relaxed">{order.statusReason}</p>
                  {order.statusUpdatedAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Diperbarui {formatWib(order.statusUpdatedAt)} WIB
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-xl border">
                <p className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ringkasan pesanan
                </p>
                <ul className="divide-y">
                  {order.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{it.productName}</span>
                        <span className="block text-xs text-muted-foreground">{it.gameName}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs">{formatIdr(it.price)}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex items-center justify-between border-t px-4 py-3 text-sm font-semibold">
                  <span>Total</span>
                  <span className="font-mono">{formatIdr(order.total)}</span>
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Riwayat status
                </p>
                <ol className="mt-3 space-y-3">
                  {order.history.map((h, i) => {
                    const meta = STATUS_META[h.status];
                    return (
                      <li key={i} className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${meta.badge}`}
                        >
                          <meta.Icon aria-hidden="true" className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {meta.label}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {formatWib(h.at)} WIB
                            </span>
                          </p>
                          {h.reason ? (
                            <p className="mt-0.5 text-sm text-muted-foreground">{h.reason}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          ) : null}
        </section>
      </Reveal>
    </main>
  );
}
