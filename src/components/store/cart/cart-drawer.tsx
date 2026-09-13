"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCatalog } from "@/lib/queries";
import { RouteLink } from "@/components/shared/route-link";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import { useCartStore } from "@/lib/cart/store";
import { resolveCart, type ResolvedCartItem } from "@/lib/cart/resolve";
import { isRecipientComplete } from "@/lib/cart/validate";
import {
  buildCartWhatsAppMessage,
  generateOrderReference,
  type CartMessageItem,
} from "@/lib/cart/message";
import { productTitle } from "@/lib/whatsapp/template";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";
import { displayPhone } from "@/lib/format/phone";
import { formatJakartaDateTime } from "@/lib/format/date";
import { MAX_CART_ITEMS, type LocalOrderRecord } from "@/lib/cart/types";
import { CartItemCard } from "./cart-item-card";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  History,
  MessageCircle,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = "review" | "confirm" | "success";

/** Immutable checkout snapshot — what the customer is about to send (§33). */
type CheckoutSnapshot = {
  reference: string;
  total: number;
  items: CartMessageItem[];
  createdAt: string;
};

/**
 * Cart drawer: review + inline recipient data → final review → WhatsApp handoff.
 * Desktop: right sheet. Mobile: bottom sheet. Content scrolls; the primary
 * CTA footer stays visible at all times.
 *
 * All state lives in CartDrawerInner — the sheet content unmounts when the
 * drawer closes, so every open starts from a fresh, predictable state without
 * reset effects.
 */
export function CartDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent aria-describedby="cart-description" className="flex max-h-[92dvh] flex-col gap-0 p-0">
          <CartDrawerInner isMobile onOpenChange={onOpenChange} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby="cart-description"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <CartDrawerInner isMobile={false} onOpenChange={onOpenChange} />
      </SheetContent>
    </Sheet>
  );
}

function CartDrawerInner({
  isMobile,
  onOpenChange,
}: {
  isMobile: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data } = useCatalog();
  const items = useCartStore((s) => s.items);
  const orders = useCartStore((s) => s.orders);
  const clearItems = useCartStore((s) => s.clearItems);
  const addOrderRecord = useCartStore((s) => s.addOrderRecord);
  const clearOrderHistory = useCartStore((s) => s.clearOrderHistory);
  const reducedMotion = useReducedMotion();

  const [step, setStep] = useState<Step>("review");
  // Auto-expand the first incomplete item so "what remains" is obvious (§12).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!data) return new Set();
    const resolution = resolveCart(data, items);
    const firstIncomplete = resolution.resolved.find(
      (r) => !isRecipientComplete(r.game.orderFields, r.item.recipient)
    );
    return firstIncomplete ? new Set([firstIncomplete.item.id]) : new Set();
  });
  const [showErrors, setShowErrors] = useState(false);
  const [snapshot, setSnapshot] = useState<CheckoutSnapshot | null>(null);
  const [sentRef, setSentRef] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const resolution = useMemo(() => resolveCart(data, items), [data, items]);
  const { resolved, total } = resolution;
  const completeCount = resolved.filter((r) =>
    isRecipientComplete(r.game.orderFields, r.item.recipient)
  ).length;

  const maintenance = data?.store.maintenanceMode ?? false;
  const storeName = data?.store.name ?? "Nexa Store";

  function toggleExpanded(id: string, next: boolean) {
    setExpanded((prev) => {
      const out = new Set(next ? [...prev, id] : [...prev].filter((x) => x !== id));
      return out;
    });
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pesan disalin", { description: "Tempel di chat WhatsApp store." });
    } catch {
      toast.error("Gagal menyalin", { description: "Buka pratinjau pesan lalu salin manual." });
    }
  }

  function buildMessage(snap: CheckoutSnapshot): string | null {
    if (!data) return null;
    return buildCartWhatsAppMessage({
      storeName,
      reference: snap.reference,
      items: snap.items,
      total: snap.total,
    });
  }

  /** Validate everything; move to confirm with an immutable snapshot. */
  function goToConfirm() {
    if (resolved.length === 0) return;
    const incomplete = resolved.find(
      (r) => !isRecipientComplete(r.game.orderFields, r.item.recipient)
    );
    if (incomplete) {
      setShowErrors(true);
      setExpanded((prev) => new Set([...prev, incomplete.item.id]));
      requestAnimationFrame(() => {
        const el = document.getElementById(`cart-item-${incomplete.item.id}`);
        el?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      });
      toast.info("Masih ada data yang belum lengkap", {
        description: `Lengkapi ${resolved.length - completeCount} item lagi sebelum lanjut.`,
      });
      return;
    }

    const messageItems: CartMessageItem[] = resolved.map((r) => ({
      gameName: r.game.name,
      productName: productTitle(r.product),
      priceIdr: r.product.priceIdr,
      recipient: r.item.recipient,
      orderFields: r.game.orderFields,
    }));
    setSnapshot({
      reference: generateOrderReference(),
      total,
      items: messageItems,
      createdAt: new Date().toISOString(),
    });
    setShowErrors(false);
    setStep("confirm");
    scrollRef.current?.scrollTo({ top: 0 });
  }

  /** WhatsApp handoff — precise language, never a false "order success". */
  function sendToWhatsApp() {
    if (!snapshot) return;
    const message = buildMessage(snapshot);
    if (!message || !data) return;

    addOrderRecord({
      reference: snapshot.reference,
      createdAt: snapshot.createdAt,
      total: snapshot.total,
      itemCount: snapshot.items.length,
      items: snapshot.items.map((it) => ({
        gameName: it.gameName,
        productName: it.productName,
        price: it.priceIdr,
      })),
    });
    clearItems();
    setSentRef(snapshot.reference);
    setSnapshot(null);
    setStep("success");
    setExpanded(new Set());

    try {
      const url = buildWhatsAppUrl(data.store.whatsappNumber, message);
      // open() with "noopener" always returns null by spec — open plain, then
      // detach the opener manually for the same security property.
      const win = window.open(url, "_blank");
      if (!win) {
        toast.info("Peramban memblokir WhatsApp", {
          description: "Pesan sudah disalin. Tempel manual di chat store.",
          duration: 8000,
        });
        void copyMessage(message);
        return;
      }
      try {
        win.opener = null;
      } catch {
        // Cross-origin windows may reject the assignment. Safe to ignore.
      }
      toast.success("WhatsApp dibuka", {
        description: "Kirim pesan yang sudah disiapkan untuk menyelesaikan pesanan.",
      });
    } catch {
      toast.error("Nomor WhatsApp store tidak valid", {
        description: "Hubungi admin. Konfigurasi nomor perlu diperbaiki.",
      });
      void copyMessage(message);
    }
  }

  const headerTitle =
    step === "review" ? "Keranjang" : step === "confirm" ? "Periksa pesanan" : "Pesanan disiapkan";

  const headerDescription =
    step === "review"
      ? `${items.length} / ${MAX_CART_ITEMS} item · maksimal ${MAX_CART_ITEMS} per pesanan`
      : step === "confirm"
        ? "Pastikan semua data sudah benar sebelum lanjut ke WhatsApp."
        : "WhatsApp dibuka untuk melanjutkan pesanan kamu.";

  const titleNode = (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-primary/25 bg-primary/10 text-primary"
      >
        <ShoppingBag className="h-4 w-4" />
      </span>
      <span className="truncate">{headerTitle}</span>
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-step={step}>
      {/* Header — always visible */}
      {isMobile ? (
        <div className="flex-none border-b border-border/70 px-4 pb-3 pt-1 text-left">
          <DrawerTitle className="flex items-center justify-between gap-2 font-display">
            <span className="min-w-0">{titleNode}</span>
            <SheetCloseButton onClose={() => onOpenChange(false)} />
          </DrawerTitle>
          <DrawerDescription className="mt-0.5">{headerDescription}</DrawerDescription>
        </div>
      ) : (
        <div className="flex-none border-b border-border/70 px-5 py-4 pr-12 text-left">
          <SheetTitle className="font-display">{titleNode}</SheetTitle>
          <SheetDescription className="mt-0.5">{headerDescription}</SheetDescription>
        </div>
      )}

      {maintenance && step !== "success" ? (
        <p role="alert" className="flex-none border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-xs text-destructive sm:px-5">
          Pemesanan sedang ditutup. Keranjang tetap tersimpan di perangkat kamu.
        </p>
      ) : null}

      {/* Scrollable middle */}
      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {step === "review" ? (
          resolved.length === 0 ? (
            <CartEmptyState orders={orders} onClearHistory={() => {
              clearOrderHistory();
              toast.success("Riwayat pesanan lokal dihapus");
            }} onClose={() => onOpenChange(false)} />
          ) : (
            <CartReviewList
              resolved={resolved}
              completeCount={completeCount}
              expanded={expanded}
              onToggle={toggleExpanded}
              showErrors={showErrors}
            />
          )
        ) : step === "confirm" ? (
          <CartConfirmView snapshot={snapshot} storePhone={data?.store.whatsappNumber ?? ""} storeName={storeName} />
        ) : (
          <CartSuccessView snapshotRef={sentRef} orders={orders} />
        )}
      </div>

      {/* Sticky footer — the CTA never gets pushed off-screen. */}
      {step === "review" && resolved.length > 0 ? (
        <div className="flex-none border-t border-border/70 bg-background/95 p-4 backdrop-blur sm:px-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Subtotal · {resolved.length} item
            </span>
            <PriceTag value={total} size="lg" />
          </div>
          <Button
            type="button"
            size="lg"
            className="w-full gap-2 font-semibold"
            disabled={maintenance}
            onClick={goToConfirm}
          >
            Lanjut ke peninjauan
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {step === "confirm" ? (
        <div className="flex-none border-t border-border/70 bg-background/95 p-4 backdrop-blur sm:px-5">
          {snapshot ? (
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                Total · {snapshot.items.length} item
              </span>
              <PriceTag value={snapshot.total} size="lg" />
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" size="lg" className="gap-1.5" onClick={() => setStep("review")}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Kembali
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1 gap-2 bg-wa font-semibold text-wa-foreground shadow-card hover:bg-wa/90"
              onClick={sendToWhatsApp}
            >
              <Check aria-hidden="true" className="h-4 w-4" />
              Lanjut ke WhatsApp
            </Button>
          </div>
        </div>
      ) : null}

      {step === "success" ? (
        <div className="flex-none border-t border-border/70 bg-background/95 p-4 backdrop-blur sm:px-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="gap-1.5 text-muted-foreground"
              disabled={!sentRef}
              onClick={() => {
                // Snapshot is consumed on send; the toast in sendToWhatsApp
                // already offered the copy fallback. Keep a plain close.
                onOpenChange(false);
              }}
            >
              <Copy aria-hidden="true" className="h-4 w-4" />
              Tutup
            </Button>
            <Button type="button" size="lg" className="flex-1 gap-2 font-semibold" onClick={() => onOpenChange(false)}>
              Selesai
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SheetCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Tutup keranjang"
      onClick={onClose}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

function CartReviewList({
  resolved,
  completeCount,
  expanded,
  onToggle,
  showErrors,
}: {
  resolved: ResolvedCartItem[];
  completeCount: number;
  expanded: Set<string>;
  onToggle: (id: string, open: boolean) => void;
  showErrors: boolean;
}) {
  const allComplete = completeCount === resolved.length;
  return (
    <div>
      <p
        role="status"
        className={cn(
          "mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
          allComplete
            ? "border-primary/25 bg-primary/10 text-primary"
            : "border-border bg-muted/50 text-foreground/80"
        )}
      >
        {allComplete ? <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" /> : null}
        {allComplete
          ? "Semua item siap diproses"
          : `${completeCount} / ${resolved.length} item siap diproses`}
      </p>
      <ul className="space-y-3">
        {resolved.map((r, i) => (
          <CartItemRow key={r.item.id} resolved={r} index={i} expanded={expanded} onToggle={onToggle} showErrors={showErrors} />
        ))}
      </ul>
    </div>
  );
}

/** Wrapper with the scroll-to anchor id used by validation focus. */
function CartItemRow({
  resolved,
  index,
  expanded,
  onToggle,
  showErrors,
}: {
  resolved: ResolvedCartItem;
  index: number;
  expanded: Set<string>;
  onToggle: (id: string, open: boolean) => void;
  showErrors: boolean;
}) {
  return (
    <div id={`cart-item-${resolved.item.id}`} className="contents">
      <AnimatePresence>
        <CartItemCard
          resolved={resolved}
          index={index}
          expanded={expanded.has(resolved.item.id)}
          onToggle={onToggle}
          showErrors={showErrors}
        />
      </AnimatePresence>
    </div>
  );
}

function CartConfirmView({ snapshot, storePhone, storeName }: { snapshot: CheckoutSnapshot | null; storePhone: string; storeName: string }) {
  if (!snapshot) return null;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground">Referensi pesanan</p>
        <p className="font-mono text-sm font-semibold tracking-wide">{snapshot.reference}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatJakartaDateTime(new Date(snapshot.createdAt))}
        </p>
      </div>

      <ol className="space-y-3">
        {snapshot.items.map((item, i) => (
          <li key={i} className="rounded-xl border bg-card p-4 shadow-card">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate font-display text-sm font-semibold">
                <span className="text-muted-foreground">{i + 1}.</span> {item.gameName}
              </p>
              <PriceTag value={item.priceIdr} size="md" className="shrink-0" />
            </div>
            <p className="mt-1 text-sm text-foreground/80">{item.productName}</p>
            <dl className="mt-2 space-y-1 border-t border-border/60 pt-2 text-xs">
              <ConfirmRow label="Nama" value={item.recipient.customerName || "—"} />
              {item.orderFields.map((f) => (
                <ConfirmRow
                  key={f.key}
                  label={f.label}
                  value={(item.recipient.fields[f.key] ?? "").trim() || "—"}
                />
              ))}
              {item.recipient.note.trim() ? (
                <ConfirmRow label="Catatan" value={item.recipient.note.trim()} />
              ) : null}
            </dl>
          </li>
        ))}
      </ol>

      <Separator />

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Total pembayaran</span>
        <PriceTag value={snapshot.total} size="lg" />
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessageCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-wa" />
        Pesanan dikirim ke <span className="font-mono text-foreground">{displayPhone(storePhone) || "—"}</span>
      </p>

      {snapshot.items.length > 1 ? (
        <details className="group rounded-xl border bg-background/60">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            Lihat pesan WhatsApp yang akan terkirim
          </summary>
          <pre className="scroll-slim max-h-56 overflow-y-auto whitespace-pre-wrap border-t px-4 py-3 font-mono text-xs leading-relaxed text-foreground/90">
            {buildCartWhatsAppMessage({
              storeName,
              reference: snapshot.reference,
              items: snapshot.items,
              total: snapshot.total,
            })}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}

function CartSuccessView({
  snapshotRef,
  orders,
}: {
  snapshotRef: string | null;
  orders: LocalOrderRecord[];
}) {
  const latest = snapshotRef ? orders.find((o) => o.reference === snapshotRef) : null;
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="flex h-14 w-14 items-center justify-center rounded-full border border-wa/40 bg-wa/10 text-wa"
      >
        <CheckCheck aria-hidden="true" className="h-7 w-7" />
      </motion.span>
      <div>
        <h3 className="font-display text-lg font-semibold">Pesanan telah disiapkan.</h3>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
          WhatsApp dibuka untuk melanjutkan pesanan. Kirim pesannya agar admin bisa
          konfirmasi dan memproses top up.
        </p>
      </div>
      {latest ? (
        <div className="w-full rounded-xl border bg-card p-4 text-left shadow-card">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-sm font-semibold tracking-wide">{latest.reference}</p>
            <PriceTag value={latest.total} size="md" className="shrink-0" />
          </div>
          <ul className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2.5 text-xs">
            {latest.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-muted-foreground">
                  {it.gameName} · {it.productName}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[11px] text-muted-foreground/70">
            Tersimpan di riwayat pesanan perangkat ini.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CartEmptyState({
  orders,
  onClearHistory,
  onClose,
}: {
  orders: LocalOrderRecord[];
  onClearHistory: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground/60"
      >
        <ShoppingBag className="h-6 w-6" />
      </span>
      <div>
        <h3 className="font-display text-base font-semibold">Keranjang kosong</h3>
        <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Tambahkan produk dari halaman game. Maksimal {MAX_CART_ITEMS} item per
          pesanan, satu pesan WhatsApp untuk semuanya.
        </p>
      </div>
      <Button asChild className="gap-2 font-semibold" onClick={onClose}>
        <RouteLink href="/games">
          Lihat game
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </RouteLink>
      </Button>

      {orders.length > 0 ? (
        <div className="mt-4 w-full text-left">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History aria-hidden="true" className="h-3.5 w-3.5" />
              Riwayat pesanan
            </p>
            <button
              type="button"
              onClick={onClearHistory}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-destructive"
            >
              <Trash2 aria-hidden="true" className="h-3 w-3" />
              Hapus riwayat
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            Catatan lokal di perangkat ini — bukan riwayat resmi store.
          </p>
          <ul className="scroll-slim mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {orders.map((o) => (
              <li key={o.reference + o.createdAt} className="rounded-lg border bg-card px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs font-semibold">{o.reference}</span>
                  <span className="text-xs font-semibold tabular">
                    Rp{o.total.toLocaleString("id-ID")}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {formatJakartaDateTime(new Date(o.createdAt))} · {o.itemCount} item ·{" "}
                  {o.items.map((it) => it.gameName).filter((g, i, arr) => arr.indexOf(g) === i).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
