"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { RouteLink } from "@/components/shared/route-link";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { formatIdr } from "@/lib/format/idr";
import { track } from "@/lib/analytics/tracker";
import { useCatalog } from "@/lib/queries";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";
import {
  Check,
  CheckCheck,
  Copy,
  Link2,
  Loader2,
  MessageCircle,
  Radar,
  Scissors,
  XCircle,
} from "lucide-react";

/**
 * Lacak pesanan (v1.10.0) — meja resi.
 *
 * Satu halaman, satu dokumen: bar perintah terminal di atas, lalu resi
 * pesanan yang "tercetak" lengkap — barcode deterministik dari ID, jahitan
 * perforasi, lampu status, rincian bergaya struk, dan manifest riwayat.
 * Dirancang menyambung dengan bahasa desain blueprint v1.9.0 (hairline,
 * mono micro-label, Fig. specimen, dotted leader) — bukan kartu-kartu.
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

const ID_PATTERN = /^NEXA-\d{6}-[A-HJKMNP-TV-Z23-9]{4}$/;

const STATUS_META: Record<
  OrderStatus,
  { label: string; tag: string; lamp: string; text: string; live: boolean }
> = {
  pending: {
    label: "Menunggu",
    tag: "border-amber-500/40 text-amber-700 dark:text-amber-400",
    lamp: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-600 dark:text-amber-400",
    live: true,
  },
  processing: {
    label: "Diproses",
    tag: "border-sky-500/40 text-sky-700 dark:text-sky-400",
    lamp: "bg-sky-500 dark:bg-sky-400",
    text: "text-sky-600 dark:text-sky-400",
    live: true,
  },
  success: {
    label: "Selesai",
    tag: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    lamp: "bg-emerald-500 dark:bg-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    live: false,
  },
  cancel: {
    label: "Dibatalkan",
    tag: "border-red-500/40 text-red-700 dark:text-red-400",
    lamp: "bg-red-500 dark:bg-red-400",
    text: "text-red-600 dark:text-red-400",
    live: false,
  },
};

const STATUS_SUBLINE: Record<OrderStatus, string> = {
  pending: "Pesananmu sudah masuk antrean dan menunggu admin memproses.",
  processing: "Admin sedang mengerjakan pesananmu — halaman ini diperbarui otomatis.",
  success: "Pesanan selesai. Terima kasih sudah top up di Nexa!",
  cancel: "Pesanan ini dibatalkan. Cek keterangan admin, atau chat kalau ada yang janggal.",
};

/* ── util ──────────────────────────────────────────────────────────── */

/** Normalisasi isian: uppercase, buang aneh, sambungkan strip otomatis. */
function normalizeId(raw: string): string {
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (up.length <= 4) return up;
  if (up.length <= 10) return `${up.slice(0, 4)}-${up.slice(4)}`;
  return `${up.slice(0, 4)}-${up.slice(4, 10)}-${up.slice(10, 14)}`;
}

/** Bar lebar 1–3 unit, deterministik dari karakter ID — bukan hiasan acak. */
function barcodeBars(id: string): number[] {
  const bars: number[] = [];
  for (let i = 0; i < 44; i++) {
    const code = id.charCodeAt(i % id.length);
    bars.push(((code * 7 + i * 13) % 3) + 1);
  }
  return bars;
}

function formatWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function formatClockWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function formatDayWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function timeAgo(iso: string, now: number): string {
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 604800) return `${Math.floor(s / 86400)} hari lalu`;
  return formatDayWib(iso);
}

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success(message);
    } catch {
      toast.error("Gagal menyalin — salin manual ya.");
    }
  }
}

/* ── barcode ───────────────────────────────────────────────────────── */

function Barcode({ id, className }: { id: string; className?: string }) {
  const bars = useMemo(() => barcodeBars(id), [id]);
  return (
    <div
      aria-hidden="true"
      className={`flex h-9 items-stretch gap-[2.5px] ${className ?? ""}`}
    >
      {bars.map((v, i) => (
        <span
          key={i}
          className={`bg-foreground/85 ${i === 0 || i === bars.length - 1 ? "" : "my-[16%]"}`}
          style={{ width: v * 2 }}
        />
      ))}
    </div>
  );
}

/* ── jahitan perforasi (garis sobek khas tiket) ────────────────────── */

function Seam({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden="true" className="relative">
      <div className="border-t border-dashed border-border" />
      {!compact ? (
        <>
          <span className="absolute left-4 top-0 flex -translate-y-1/2 items-center bg-card px-1.5 text-muted-foreground/50">
            <Scissors className="h-3 w-3" />
          </span>
          <span className="absolute left-0 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background [box-shadow:inset_0_0_0_1px_var(--border)]" />
          <span className="absolute right-0 top-0 h-3.5 w-3.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-background [box-shadow:inset_0_0_0_1px_var(--border)]" />
        </>
      ) : (
        <>
          <span className="absolute left-0 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background [box-shadow:inset_0_0_0_1px_var(--border)]" />
          <span className="absolute right-0 top-0 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-background [box-shadow:inset_0_0_0_1px_var(--border)]" />
        </>
      )}
    </div>
  );
}

/* ── label mono kecil (bahasa desain situs) ────────────────────────── */

function MicroLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={`font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </p>
  );
}

/* ── resi pesanan (hasil pelacakan) ────────────────────────────────── */

function WaybillTicket({
  order,
  now,
  reducedMotion,
}: {
  order: TrackedOrder;
  now: number;
  reducedMotion: boolean;
}) {
  const meta = STATUS_META[order.status];
  const timeline = useMemo(() => [...order.history].reverse(), [order.history]);
  const updatedAt = order.statusUpdatedAt ?? order.createdAt;

  return (
    <motion.article
      key={order.id}
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      aria-label={`Resi pesanan ${order.id}`}
      className="relative overflow-hidden rounded-xl border bg-card shadow-card"
    >
      {/* kepala dokumen */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3 sm:px-6">
        <MicroLabel>Resi Pesanan</MicroLabel>
        <span
          className={`inline-flex items-center gap-2 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] ${meta.tag}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.lamp}`} />
          {meta.label}
        </span>
      </div>

      {/* barcode + ID */}
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="min-w-0">
          <Barcode id={order.id} />
          <p className="mt-3 break-all font-mono text-lg font-semibold tracking-[0.14em]">
            {order.id}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Dibuat {formatWib(order.createdAt)} WIB ·{" "}
            {order.source === "cart" ? "Dari keranjang" : "Pesan instan"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void copyText(order.id, "ID Order tersalin.")}
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            Salin ID
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() =>
              void copyText(
                `${window.location.origin}/track?id=${encodeURIComponent(order.id)}`,
                "Tautan resi tersalin — bisa dikirim ke mana saja."
              )
            }
          >
            <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
            Tautan
          </Button>
        </div>
      </div>

      <Seam />

      {/* badan dokumen */}
      <div className="grid md:grid-cols-[0.94fr_1.06fr]">
        {/* status — alasan orang datang ke halaman ini */}
        <div className="px-5 py-5 sm:px-6 md:border-r md:border-dashed md:border-border">
          <MicroLabel>Status terkini</MicroLabel>
          <div className="mt-3.5 flex items-center gap-3.5">
            <span className="relative flex h-3 w-3 shrink-0">
              {meta.live ? (
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${meta.lamp}`}
                />
              ) : null}
              <span aria-hidden="true" className={`relative h-3 w-3 rounded-full ${meta.lamp}`} />
            </span>
            <p className={`font-display text-2xl font-bold tracking-tight ${meta.text}`}>
              {meta.label}
            </p>
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            {STATUS_SUBLINE[order.status]}
          </p>
          <p className="mt-2 font-mono text-[11px] tabular text-muted-foreground">
            {timeAgo(updatedAt, now)} · {formatWib(updatedAt)} WIB
          </p>

          {order.statusReason ? (
            <div className="mt-4 rounded-lg border border-primary/25 bg-primary/[0.06] p-3.5">
              <MicroLabel className="text-primary">Keterangan admin</MicroLabel>
              <p className="mt-1.5 text-sm leading-relaxed">{order.statusReason}</p>
            </div>
          ) : null}

          <p className="mt-5 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
            <span aria-hidden="true" className="motion-safe:animate-pulse">
              ↻
            </span>
            Diperbarui otomatis tiap 30 detik
          </p>
        </div>

        {/* rincian + riwayat */}
        <div className="px-5 py-5 sm:px-6">
          <MicroLabel>Rincian</MicroLabel>
          <ul className="mt-3.5 space-y-3">
            {order.items.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{it.productName}</span>
                  <span className="block text-xs text-muted-foreground">{it.gameName}</span>
                </span>
                <span aria-hidden="true" className="mb-1 flex-1 border-b border-dotted border-border" />
                <span className="shrink-0 font-mono text-xs tabular">{formatIdr(it.price)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3.5 flex items-baseline gap-2 border-t pt-3 text-sm font-semibold">
            Total
            <span aria-hidden="true" className="mb-1 flex-1 border-b border-dotted border-border" />
            <span className="font-mono tabular">{formatIdr(order.total)}</span>
          </p>

          <div className="mt-6 md:mt-7">
            <MicroLabel>Riwayat</MicroLabel>
            <ol className="relative mt-3.5 space-y-4 border-l border-dashed border-border pl-[18px]">
              {timeline.map((h, i) => {
                const m = STATUS_META[h.status];
                const isLatest = i === 0;
                return (
                  <li key={`${h.at}-${i}`} className="relative">
                    <span
                      aria-hidden="true"
                      className={`absolute top-[5px] h-2.5 w-2.5 rounded-full ${
                        isLatest ? `${m.lamp}` : "border-2 border-border bg-background"
                      } -left-[23px]`}
                    />
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`font-display text-sm font-semibold ${isLatest ? "" : "text-muted-foreground"}`}
                      >
                        {m.label}
                      </span>
                      {isLatest && timeline.length > 1 ? (
                        <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                          Terkini
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] tabular text-muted-foreground">
                      {formatClockWib(h.at)} WIB · {formatDayWib(h.at)}
                    </p>
                    {h.reason ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{h.reason}</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

/* ── spesimen keadaan kosong (sebelum melacak) ─────────────────────── */

function SpecimenCaption({ figure, caption }: { figure: string; caption: string }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-2.5">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Fig. {figure} · {caption}
      </span>
      <span className="h-px flex-1 bg-border/80" />
    </div>
  );
}

function SpecimenTicket() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/25 p-4">
      <SpecimenCaption figure="01" caption="Resi pesanan" />
      <div
        aria-hidden="true"
        className="relative mt-3.5 overflow-hidden rounded-lg border bg-card/60"
      >
        <div className="flex items-center justify-between border-b px-3.5 py-2">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Resi
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
            Menunggu
          </span>
        </div>
        <div className="px-3.5 py-3">
          <div className="flex h-5 items-stretch gap-[2px]">
            {barcodeBars("NEXA-260914-A7KP")
              .slice(0, 26)
              .map((v, i) => (
                <span
                  key={i}
                  className={`bg-foreground/70 ${i === 0 || i === 25 ? "" : "my-[15%]"}`}
                  style={{ width: v * 1.5 }}
                />
              ))}
          </div>
          <p className="mt-2 font-mono text-[12.5px] font-semibold tracking-[0.12em]">
            NEXA-260914-A7KP
          </p>
        </div>
        <Seam compact />
        <div className="px-3.5 py-3">
          <p className="flex items-baseline gap-2 text-xs">
            <span className="font-medium">86 Diamonds</span>
            <span className="mb-0.5 flex-1 border-b border-dotted border-border" />
            <span className="font-mono text-[11px] tabular">Rp 19.000</span>
          </p>
          <p className="mt-2.5 flex items-baseline gap-2 text-xs font-semibold">
            Total
            <span className="mb-0.5 flex-1 border-b border-dotted border-border" />
            <span className="font-mono text-[11px] tabular">Rp 19.000</span>
          </p>
        </div>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 font-display text-4xl font-bold uppercase tracking-[0.32em] text-foreground/[0.05]">
          Contoh
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Begitu ID-nya ketemu, resinya tercetak seperti ini — status, rincian,
        dan riwayat dalam satu dokumen.
      </p>
    </div>
  );
}

function SpecimenChat() {
  return (
    <div className="flex flex-col rounded-xl border border-dashed border-border bg-muted/25 p-4">
      <SpecimenCaption figure="02" caption="ID di chat WhatsApp" />
      <div aria-hidden="true" className="mt-3.5 flex justify-end">
        <div className="max-w-full rounded-2xl rounded-tr-md border border-wa/25 bg-wa/10 px-3.5 py-2.5">
          <p className="font-mono text-[11.5px] leading-relaxed text-foreground">
            1× 86 Diamonds · Mobile Legends
            <br />
            User ID 12345678 (Server 2142)
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11.5px]">
            <span className="text-muted-foreground">ID</span>
            <span className="rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 font-semibold tracking-[0.08em] text-primary">
              NEXA-260914-A7KP
            </span>
          </p>
          <p className="mt-1 flex items-center justify-end gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">14.02</span>
            <CheckCheck aria-hidden="true" className="h-3.5 w-3.5 text-wa" />
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        ID Order dikirim otomatis ke chat WhatsApp saat kamu membuat pesanan —
        salin, lalu tempel di bar pencarian atas.
      </p>
    </div>
  );
}

/* ── halaman ───────────────────────────────────────────────────────── */

type ErrorKind = "format" | "notfound" | "network";

const ERROR_TITLES: Record<ErrorKind, string> = {
  format: "Format ID belum pas",
  notfound: "ID tidak ditemukan",
  network: "Koneksi bermasalah",
};

export function TrackView() {
  const reducedMotion = useReducedMotion();
  const { data: catalog } = useCatalog();
  const storeWhatsapp = catalog?.store.whatsappNumber ?? null;

  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const inputRef = useRef<HTMLInputElement>(null);
  const orderRef = useRef<TrackedOrder | null>(null);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const search = useCallback(
    async (target?: string) => {
      const id = normalizeId((target ?? query).trim());
      setQuery(id);
      if (!ID_PATTERN.test(id)) {
        setOrder(null);
        setLastQuery(id);
        setError(
          "ID Order terdiri dari pola NEXA-TANGGAL-KODE — contohnya NEXA-260914-A7KP. Periksa lagi ejaannya."
        );
        setErrorKind("format");
        return;
      }
      setLoading(true);
      setError(null);
      setErrorKind(null);
      setOrder(null);
      setLastQuery(id);
      setNow(Date.now());
      try {
        track("order_track");
        const res = await fetch(`/api/orders/track?id=${encodeURIComponent(id)}`);
        const json = (await res.json()) as {
          ok: boolean;
          data?: TrackedOrder;
          error?: { message: string };
        };
        if (!res.ok || !json.ok || !json.data) {
          throw Object.assign(new Error(json.error?.message ?? "Pesanan tidak ditemukan."), {
            kind: res.status === 400 ? "format" : "notfound",
          } as { kind?: ErrorKind });
        }
        setOrder(json.data);
        window.history.replaceState(null, "", `/track?id=${encodeURIComponent(id)}`);
      } catch (e) {
        const err = e as Error & { kind?: ErrorKind };
        if (err.name === "TypeError") {
          setError("Koneksi ke server terputus. Periksa internetmu, lalu coba lacak lagi.");
          setErrorKind("network");
        } else {
          setError(err.message);
          setErrorKind(err.kind ?? "notfound");
        }
      } finally {
        setLoading(false);
      }
    },
    [query]
  );

  // Deep link ?id=… — resi bisa dibagikan langsung lewat tautan.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    const normalized = normalizeId(id);
    setQuery(normalized);
    if (ID_PATTERN.test(normalized)) void search(normalized);
    // Hanya untuk kunjungan pertama; jalan ulang malah menimpa ketikan user.
  }, []);

  // Fokus awal di desktop — halaman ini memang satu tujuan: menempel ID.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  // Pembaruan otomatis tiap 30 detik selama resi terbuka (tab harus aktif).
  useEffect(() => {
    const orderId = order?.id;
    if (!orderId) return;
    const timer = window.setInterval(async () => {
      setNow(Date.now());
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/orders/track?id=${encodeURIComponent(orderId)}`);
        const json = (await res.json()) as { ok: boolean; data?: TrackedOrder };
        if (!res.ok || !json.ok || !json.data) return;
        const next = json.data;
        const prev = orderRef.current;
        if (prev && prev.status !== next.status) {
          toast.success(`Status pesanan kini ${STATUS_META[next.status].label}.`);
        }
        setOrder(next);
      } catch {
        // Detak berikutnya mencoba lagi.
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [order?.id]);

  const inputValid = ID_PATTERN.test(query);

  return (
    <main id="main" className="relative mx-auto w-full max-w-4xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      {/* tekstur blueprint halus — hanya di zona kepala */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-grid opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <motion.div
        className="relative"
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <RouteLink href="/" className="transition-colors hover:text-foreground">
            Beranda
          </RouteLink>
          <span aria-hidden="true">
            /
          </span>
          <span className="text-foreground/80">Lacak Pesanan</span>
        </nav>

        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Mana pesananku<span className="text-primary">?</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          Tempel ID Order dari chat WhatsApp pesananmu — status, keterangan
          admin, sampai riwayat lengkapnya tercetak dalam satu resi. Tanpa
          login, tanpa ribet.
        </p>
      </motion.div>

      {/* bar perintah terminal */}
      <Reveal delay={0.08} className="relative">
        <form
          role="search"
          aria-label="Lacak pesanan dengan ID Order"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          className="relative mt-8 overflow-hidden rounded-xl border bg-card shadow-card transition-colors focus-within:border-primary/50"
        >
          <div className="flex items-stretch">
            <span
              aria-hidden="true"
              className="flex select-none items-center pl-4 font-mono text-base font-semibold text-primary"
            >
              ›
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(normalizeId(e.target.value));
                if (error) {
                  setError(null);
                  setErrorKind(null);
                }
              }}
              placeholder="NEXA-260914-A7KP"
              aria-label="ID Order"
              autoComplete="off"
              spellCheck={false}
              className="h-14 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm font-medium tracking-[0.06em] outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/70"
            />
            {inputValid && !loading ? (
              <Check
                aria-hidden="true"
                className="my-auto mr-1 h-4 w-4 shrink-0 text-emerald-500"
              />
            ) : null}
            <Button
              type="submit"
              disabled={loading || !query.trim()}
              className="mr-1.5 gap-2 self-stretch rounded-lg px-4 font-semibold"
            >
              {loading ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Radar aria-hidden="true" className="h-4 w-4" />
              )}
              {loading ? "Memindai" : "Lacak"}
              {!loading ? (
                <kbd
                  aria-hidden="true"
                  className="hidden rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1 font-mono text-[10px] sm:inline"
                >
                  ↵
                </kbd>
              ) : null}
            </Button>
          </div>
          {loading ? (
            <span
              aria-hidden="true"
              className="scanline absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-primary/60 to-transparent"
            />
          ) : null}
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Format <span className="text-foreground/70">NEXA-TANGGAL-KODE</span>
          </p>
          <span aria-hidden="true" className="hidden h-3 w-px bg-border sm:block" />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Contoh <span className="text-foreground/70">NEXA-260914-A7KP</span>
          </p>
          <p className="ml-auto hidden text-[11px] text-muted-foreground lg:block">
            Strip dan huruf besar diisi otomatis saat kamu menempel ID.
          </p>
        </div>
      </Reveal>

      {/* hasil / keadaan */}
      <div aria-live="polite" className="relative">
        {error && errorKind ? (
          <div
            role="alert"
            className="mt-8 overflow-hidden rounded-xl border border-red-500/30 bg-red-500/[0.03]"
          >
            <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/[0.06] px-5 py-3">
              <XCircle aria-hidden="true" className="h-4 w-4 text-red-500" />
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-red-600 dark:text-red-400">
                {ERROR_TITLES[errorKind]}
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm leading-relaxed">{error}</p>
              {lastQuery ? (
                <p className="mt-2.5 font-mono text-xs text-muted-foreground">
                  Dicari: <span className="text-foreground">{lastQuery}</span>
                </p>
              ) : null}
              {errorKind === "notfound" ? (
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <span aria-hidden="true" className="text-red-500">→</span>
                    Pastikan ID sama persis dengan yang ada di chat WhatsApp pesananmu.
                  </li>
                  <li className="flex gap-2">
                    <span aria-hidden="true" className="text-red-500">→</span>
                    Pesanan baru tercatat setelah kamu mengirimnya lewat tombol pesan.
                  </li>
                </ul>
              ) : null}
              {storeWhatsapp ? (
                <Button variant="outline" size="sm" className="mt-4 gap-2" asChild>
                  <a
                    href={buildWhatsAppUrl(
                      storeWhatsapp,
                      lastQuery
                        ? `Halo, saya kesulitan melacak pesanan dengan ID ${lastQuery}.`
                        : "Halo, saya mau tanya soal pesanan saya."
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle aria-hidden="true" className="h-4 w-4" />
                    Tanya admin
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div aria-hidden="true" className="mt-8 space-y-3 overflow-hidden rounded-xl border bg-card/60 p-5">
            <div className="flex h-3 w-24 items-stretch gap-[2.5px] opacity-30">
              {barcodeBars("NEXA-SCAN-LOADING").map((v, i) => (
                <span key={i} className="bg-foreground/60" style={{ width: v * 2 }} />
              ))}
            </div>
            <div className="h-5 w-56 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-72 animate-pulse rounded bg-muted" />
            <div className="mt-4 border-t border-dashed" />
            <div className="h-3.5 w-full max-w-sm animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-64 animate-pulse rounded bg-muted" />
          </div>
        ) : order ? (
          <div className="mt-8">
            <WaybillTicket order={order} now={now} reducedMotion={reducedMotion ?? false} />
          </div>
        ) : !error ? (
          <Reveal delay={0.1} className="mt-10">
            <div className="grid gap-4 md:grid-cols-[1.22fr_0.78fr]">
              <SpecimenTicket />
              <SpecimenChat />
            </div>
          </Reveal>
        ) : null}
      </div>
    </main>
  );
}
