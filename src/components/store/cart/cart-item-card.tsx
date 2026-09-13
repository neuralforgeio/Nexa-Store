"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { productTitle } from "@/lib/whatsapp/template";
import { useCartStore } from "@/lib/cart/store";
import { validateRecipient } from "@/lib/cart/validate";
import type { ResolvedCartItem } from "@/lib/cart/resolve";
import { AlertCircle, Check, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One cart line: game + product + price on top, recipient completion status,
 * expandable inline form. Each item owns its own data — different games ask
 * for different account identifiers.
 */
export function CartItemCard({
  resolved,
  index,
  expanded,
  onToggle,
  showErrors,
}: {
  resolved: ResolvedCartItem;
  index: number;
  expanded: boolean;
  onToggle: (id: string, open: boolean) => void;
  showErrors: boolean;
}) {
  const { item, game, product } = resolved;
  const updateRecipient = useCartStore((s) => s.updateRecipient);
  const removeItem = useCartStore((s) => s.removeItem);
  const reducedMotion = useReducedMotion();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errorRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const errors = useMemo(
    () => validateRecipient(game.orderFields, item.recipient),
    [game.orderFields, item.recipient]
  );
  const complete = Object.keys(errors).length === 0;

  /** First field with an error — deterministic focus target when expanding. */
  const firstErrorKey = useMemo(() => {
    if (errors.customerName) return "customerName";
    for (const f of game.orderFields) if (errors[f.key]) return f.key;
    return null;
  }, [errors, game.orderFields]);

  const shouldShow = (key: string) =>
    (touched[key] || showErrors) && Boolean(errors[key]);

  const expandAndFocus = () => {
    if (!expanded) onToggle(item.id, true);
    requestAnimationFrame(() => {
      const el = errorRef.current ?? formRef.current?.querySelector<HTMLElement>("input");
      el?.focus();
      el?.scrollIntoView({ block: "center" });
    });
  };

  const errCount = Object.keys(errors).length;

  return (
    <motion.li
      layout={!reducedMotion}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        expanded ? "border-primary/40 shadow-card" : "shadow-card"
      )}
      data-complete={complete}
    >
      {/* Item header */}
      <div className="flex items-start gap-3 p-4">
        <GameMark name={game.name} image={game.image} size="sm" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {game.name}
          </p>
          <p className="truncate font-display text-sm font-semibold leading-snug">
            {productTitle(product)}
          </p>
          <PriceTag value={product.priceIdr} size="md" className="mt-1" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            aria-label={`Hapus ${productTitle(product)} dari keranjang`}
            onClick={() => removeItem(item.id)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Status / expand toggle */}
      <button
        type="button"
        onClick={() => (complete ? onToggle(item.id, !expanded) : expandAndFocus())}
        aria-expanded={expanded}
        aria-controls={`${baseId}-form`}
        className={cn(
          "flex w-full items-center justify-between gap-2 border-t px-4 py-2.5 text-xs font-medium transition-colors",
          complete
            ? "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
            : "border-border/70 bg-muted/40 text-foreground/80 hover:bg-muted/70"
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {complete ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" />
          )}
          <span className="truncate">
            {complete ? "Data lengkap" : "Data belum diisi"}
          </span>
          {!complete && showErrors && errCount > 0 ? (
            <span className="shrink-0 text-destructive">({errCount} kolom)</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", expanded && "rotate-180")}
        />
      </button>

      {/* Inline recipient form */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="form"
            id={`${baseId}-form`}
            ref={formRef}
            initial={reducedMotion ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reducedMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-3.5 border-t border-border/60 bg-background/60 p-4">
              <p className="text-xs text-muted-foreground">
                Data akun untuk mengirim <span className="font-medium text-foreground">{product.denomination} {product.name}</span> ke akun {game.name} kamu.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor={`${baseId}-name`} className="text-xs">
                  Nama Anda<span className="text-primary"> *</span>
                </Label>
                <Input
                  id={`${baseId}-name`}
                  autoComplete="name"
                  value={item.recipient.customerName}
                  placeholder="Nama yang bisa dihubungi"
                  aria-invalid={shouldShow("customerName") || undefined}
                  ref={firstErrorKey === "customerName" ? errorRef : undefined}
                  onBlur={() => setTouched((t) => ({ ...t, customerName: true }))}
                  onChange={(e) => updateRecipient(item.id, { customerName: e.target.value })}
                  className="h-9"
                />
                {shouldShow("customerName") ? (
                  <p role="alert" className="text-xs text-destructive">{errors.customerName}</p>
                ) : null}
              </div>

              {game.orderFields.map((field) => {
                const value = item.recipient.fields[field.key] ?? "";
                const id = `${baseId}-f-${field.key}`;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={id} className="text-xs">
                      {field.label}
                      {field.required ? <span className="text-primary"> *</span> : null}
                    </Label>
                    <Input
                      id={id}
                      inputMode={field.type === "number" ? "numeric" : "text"}
                      value={value}
                      placeholder={field.placeholder}
                      aria-invalid={shouldShow(field.key) || undefined}
                      ref={field.key === firstErrorKey ? errorRef : undefined}
                      onBlur={() => setTouched((t) => ({ ...t, [field.key]: true }))}
                      onChange={(e) =>
                        updateRecipient(item.id, {
                          fields: { ...item.recipient.fields, [field.key]: e.target.value },
                        })
                      }
                      className="h-9"
                    />
                    {shouldShow(field.key) ? (
                      <p role="alert" className="text-xs text-destructive">{errors[field.key]}</p>
                    ) : null}
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <Label htmlFor={`${baseId}-note`} className="text-xs">
                  Catatan (opsional)
                </Label>
                <Textarea
                  id={`${baseId}-note`}
                  rows={2}
                  value={item.recipient.note}
                  placeholder="Contoh: kirim sesuai jam malam saja"
                  onChange={(e) => updateRecipient(item.id, { note: e.target.value })}
                  className="min-h-16 text-sm"
                />
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => {
                  setTouched({});
                  onToggle(item.id, false);
                }}
              >
                <Check aria-hidden="true" className="h-3.5 w-3.5" />
                {complete ? "Selesai — data tersimpan" : "Tutup dulu, isi nanti"}
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}
