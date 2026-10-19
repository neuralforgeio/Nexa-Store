"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/state-views";
import { formatIdr } from "@/lib/format/idr";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Copy, Inbox, Loader2, MessageSquarePlus, RefreshCw, RotateCcw } from "lucide-react";

/**
 * Panel Admin → Pesanan (v1.15.0).
 * Daftar pesanan terbaru + aksi cepat ubah status/keterangan. Label dan
 * warna status SAMA PERSIS dengan halaman Lacak Pesanan (track-view.tsx)
 * supaya admin dan pelanggan melihat bahasa yang sama.
 */

type OrderStatus = "pending" | "processing" | "success" | "cancel";

type AdminOrder = {
  id: string;
  source: "instant" | "cart";
  summary: string;
  customerName: string | null;
  items: Array<{ gameName: string; productName: string; price: number }>;
  total: number;
  status: OrderStatus;
  statusReason: string | null;
  statusUpdatedAt: string | null;
  createdAt: string;
  history: Array<{ status: OrderStatus; at: string; reason: string | null }>;
};

/** Label + warna — salinan eksak STATUS_META di track-view.tsx. */
const STATUS_META: Record<OrderStatus, { label: string; tag: string; lamp: string }> = {
  pending: {
    label: "Menunggu",
    tag: "border-amber-500/40 text-amber-700 dark:text-amber-400",
    lamp: "bg-amber-500 dark:bg-amber-400",
  },
  processing: {
    label: "Diproses",
    tag: "border-sky-500/40 text-sky-700 dark:text-sky-400",
    lamp: "bg-sky-500 dark:bg-sky-400",
  },
  success: {
    label: "Selesai",
    tag: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
    lamp: "bg-emerald-500 dark:bg-emerald-400",
  },
  cancel: {
    label: "Dibatalkan",
    tag: "border-red-500/40 text-red-700 dark:text-red-400",
    lamp: "bg-red-500 dark:bg-red-400",
  },
};

const ORDER_TIME = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

async function copyOrderId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.success("ID Order tersalin.");
  } catch {
    toast.error("Gagal menyalin — salin manual ya.");
  }
}

export function AdminOrders() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => api.get<{ orders: AdminOrder[] }>("/api/developer/orders"),
    refetchInterval: 15_000,
  });

  const [cancelTarget, setCancelTarget] = useState<AdminOrder | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  const updateStatus = useMutation({
    mutationFn: (input: { id: string; status: OrderStatus; reason?: string; reasonOnly?: boolean }) =>
      api.patch<{ order: AdminOrder }>("/api/developer/orders", {
        id: input.id,
        status: input.status,
        reason: input.reason,
      }),
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      if (input.reasonOnly) {
        toast.success("Keterangan tersimpan", { description: `Pesanan ${input.id} diperbarui.` });
      } else {
        toast.success("Status diperbarui", {
          description: `Pesanan ${input.id} kini ${STATUS_META[input.status].label}.`,
        });
      }
    },
    onError: (err) => {
      toast.error("Perubahan gagal tersimpan", {
        description: err instanceof Error ? err.message : undefined,
      });
    },
  });

  if (query.isPending) return <LoadingState label="Memuat pesanan…" />;
  if (query.isError) {
    return (
      <ErrorState
        title="Pesanan tidak dapat dimuat"
        description="Periksa koneksi lalu coba lagi."
        action={
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Coba lagi
          </Button>
        }
      />
    );
  }

  const orders = query.data.orders;
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const processingCount = orders.filter((o) => o.status === "processing").length;
  const busy = updateStatus.isPending ? updateStatus.variables : null;

  const submitStatus = (order: AdminOrder, status: OrderStatus, reason?: string, reasonOnly = false) => {
    updateStatus.mutate({ id: order.id, status, reason, reasonOnly });
  };

  const renderActions = (o: AdminOrder) => {
    const mine = busy?.id === o.id;
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {o.status === "pending" ? (
          <StatusButton
            label="Proses"
            ariaLabel={`Proses pesanan ${o.id}`}
            busy={mine && busy?.status === "processing"}
            disabled={!!mine}
            onClick={() => submitStatus(o, "processing")}
          />
        ) : null}
        {o.status === "pending" || o.status === "processing" ? (
          <StatusButton
            tone="emerald"
            label="Selesai"
            ariaLabel={`Tandai selesai pesanan ${o.id}`}
            busy={mine && busy?.status === "success"}
            disabled={!!mine}
            onClick={() => submitStatus(o, "success")}
          />
        ) : null}
        {o.status === "pending" || o.status === "processing" ? (
          <StatusButton
            tone="red"
            label="Batal"
            ariaLabel={`Batalkan pesanan ${o.id}`}
            busy={mine && busy?.status === "cancel"}
            disabled={!!mine}
            onClick={() => setCancelTarget(o)}
          />
        ) : null}
        {o.status === "success" || o.status === "cancel" ? (
          <StatusButton
            label="Proses"
            title="Kembalikan ke Diproses"
            ariaLabel={`Kembalikan pesanan ${o.id} ke Diproses`}
            busy={mine && busy?.status === "processing"}
            disabled={!!mine}
            icon={RotateCcw}
            onClick={() => submitStatus(o, "processing")}
          />
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          aria-label={`Beri keterangan pesanan ${o.id}`}
          aria-expanded={reasonFor === o.id}
          title="Keterangan untuk pelanggan"
          onClick={() => {
            if (reasonFor === o.id) {
              setReasonFor(null);
            } else {
              setReasonFor(o.id);
              setReasonText(o.statusReason ?? "");
            }
          }}
        >
          <MessageSquarePlus aria-hidden="true" className="size-3.5" />
        </Button>
        {reasonFor === o.id ? (
          <div className="flex w-full items-center gap-1.5 pt-1">
            <Input
              autoFocus
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="mis. Stok diamond sedang habis"
              maxLength={500}
              className="h-7 min-w-0 flex-1 text-xs"
              aria-label={`Teks keterangan pesanan ${o.id}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitStatus(o, o.status, reasonText.trim() || undefined, true);
                  setReasonFor(null);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setReasonFor(null)}
            >
              Tutup
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={!!mine}
              onClick={() => {
                submitStatus(o, o.status, reasonText.trim() || undefined, true);
                setReasonFor(null);
              }}
            >
              Simpan
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Pesanan</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Kelola status pesanan pelanggan — perubahan langsung terlihat di halaman Lacak Pesanan.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          aria-label="Muat ulang daftar pesanan"
        >
          <RefreshCw aria-hidden="true" className={cn("size-3.5", query.isFetching && "animate-spin")} />
          Muat ulang
        </Button>
      </header>

      <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
        {orders.length} pesanan terbaru · {pendingCount} menunggu · {processingCount} diproses · diperbarui tiap 15 dtk
      </p>

      {orders.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="Belum ada pesanan masuk"
          description="Pesanan baru dari storefront akan muncul di sini secara otomatis."
          icon={<Inbox aria-hidden="true" className="size-5" />}
        />
      ) : (
        <>
          {/* Meja pesanan (desktop) */}
          <div className="scroll-slim mt-4 hidden max-h-[60vh] overflow-auto rounded-lg border md:block">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead scope="col">ID Order</TableHead>
                  <TableHead scope="col">Waktu</TableHead>
                  <TableHead scope="col">Pembeli</TableHead>
                  <TableHead scope="col">Ringkasan</TableHead>
                  <TableHead scope="col" className="text-right">
                    Total
                  </TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" className="text-right">
                    Aksi
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <span className="flex items-center gap-1 font-mono text-xs">
                        <span className="tracking-tight">{o.id}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 px-0"
                          aria-label={`Salin ID ${o.id}`}
                          title="Salin ID Order"
                          onClick={() => void copyOrderId(o.id)}
                        >
                          <Copy aria-hidden="true" className="size-3" />
                        </Button>
                      </span>
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-xs text-muted-foreground"
                      title={`${ORDER_TIME.format(new Date(o.createdAt))} WIB`}
                    >
                      {ORDER_TIME.format(new Date(o.createdAt))}
                    </TableCell>
                    <TableCell className="max-w-[9rem] truncate">{o.customerName ?? "—"}</TableCell>
                    <TableCell className="max-w-[12rem]">
                      <p className="truncate" title={o.summary}>
                        {o.summary}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular">
                      {formatIdr(o.total)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge order={o} />
                    </TableCell>
                    <TableCell className="text-right">{renderActions(o)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Kartu bertumpuk (mobile) */}
          <ul aria-label="Daftar pesanan" className="mt-4 space-y-3 md:hidden">
            {orders.map((o) => (
              <li key={o.id} className="rounded-xl border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-mono text-sm font-semibold">
                      <span className="truncate tracking-tight">{o.id}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 px-0"
                        aria-label={`Salin ID ${o.id}`}
                        title="Salin ID Order"
                        onClick={() => void copyOrderId(o.id)}
                      >
                        <Copy aria-hidden="true" className="size-3" />
                      </Button>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ORDER_TIME.format(new Date(o.createdAt))} WIB · {o.customerName ?? "—"}
                    </p>
                  </div>
                  <StatusBadge order={o} />
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-relaxed">{o.summary}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <p className="font-mono text-sm font-semibold tabular">{formatIdr(o.total)}</p>
                  {renderActions(o)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pesanan ini?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <span>
                Pesanan <span className="font-mono">{cancelTarget?.id}</span> akan ditandai{" "}
                <strong>Dibatalkan</strong> dan langsung terlihat oleh pelanggan di halaman Lacak
                Pesanan.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal mengubah</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (cancelTarget) updateStatus.mutate({ id: cancelTarget.id, status: "cancel" });
                setCancelTarget(null);
              }}
            >
              Ya, batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Badge status + baris kecil waktu/keterangan — gaya resi track-view. */
function StatusBadge({ order }: { order: AdminOrder }) {
  const meta = STATUS_META[order.status];
  const updatedAt = order.statusUpdatedAt
    ? `${ORDER_TIME.format(new Date(order.statusUpdatedAt))} WIB`
    : null;
  return (
    <div className="min-w-0">
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] ${meta.tag}`}
      >
        <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.lamp}`} />
        {meta.label}
      </span>
      {updatedAt || order.statusReason ? (
        <p
          className="mt-1 max-w-[11rem] truncate font-mono text-[10px] text-muted-foreground/80"
          title={[updatedAt ? `Status diperbarui ${updatedAt}` : null, order.statusReason]
            .filter(Boolean)
            .join(" — ")}
        >
          {[updatedAt, order.statusReason].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** Tombol aksi status ringkas — outline kecil, aksen mengikuti track-view. */
function StatusButton({
  label,
  ariaLabel,
  title,
  busy = false,
  disabled = false,
  tone,
  icon: Icon,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  title?: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: "emerald" | "red";
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={title}
      aria-label={ariaLabel}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        "h-7 gap-1 px-2.5 text-xs",
        tone === "emerald" &&
          "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300",
        tone === "red" &&
          "border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
      )}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-3" />
      ) : null}
      {label}
    </Button>
  );
}
