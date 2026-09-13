"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { z } from "zod";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { GameMark } from "@/components/shared/game-mark";
import { PriceTag } from "@/components/shared/price-tag";
import type { Game, Product } from "@/lib/catalog/types";
import type { PublicCatalog } from "@/lib/queries";
import {
  buildTemplateContext,
  renderTemplate,
  productTitle,
  UnknownPlaceholderError,
} from "@/lib/whatsapp/template";
import { buildWhatsAppUrl } from "@/lib/whatsapp/url";
import { displayPhone } from "@/lib/format/phone";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Copy, MessageCircle } from "lucide-react";

type OrderGame = PublicCatalog["games"][number];
type Step = "form" | "review";

function buildSchema(game: OrderGame) {
  const shape: Record<string, z.ZodTypeAny> = {
    customerName: z.string().trim().min(1, "Nama wajib diisi").max(80, "Nama terlalu panjang"),
  };
  for (const f of game.orderFields) {
    let s: z.ZodString = z.string().trim();
    if (f.minLength) s = s.min(f.minLength, `Minimal ${f.minLength} karakter`);
    if (f.maxLength) s = s.max(f.maxLength, `Maksimal ${f.maxLength} karakter`);
    if (f.pattern) {
      try {
        const re = new RegExp(f.pattern);
        s = s.regex(re, `Format ${f.label} tidak sesuai`);
      } catch {
        // Invalid configured pattern must not brick checkout. Skip regex.
      }
    }
    if (f.required) s = s.min(1, `${f.label} wajib diisi`);
    shape[f.key] = s;
  }
  shape["note"] = z.string().trim().max(300, "Catatan maksimal 300 karakter");
  return z.object(shape);
}

type FormValues = Record<string, string> & { customerName: string; note: string };

/** Public game shape → domain Game (template context needs orderFieldSchema). */
function asDomainGame(game: OrderGame): Game {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    description: game.description ?? undefined,
    image: game.image ?? undefined,
    categoryIds: game.categoryIds,
    orderFieldSchema: game.orderFields,
    enabled: true,
    sortOrder: 0,
  };
}

export function OrderSheet({
  product,
  game,
  store,
  template,
  open,
  onOpenChange,
}: {
  product: Product | null;
  game: OrderGame | null;
  store: PublicCatalog["store"] | null;
  template: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();

  if (!product || !game || !store) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-md p-6 text-center text-sm text-muted-foreground">
            Produk tidak ditemukan.
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  const body = (
    <OrderSheetBody
      product={product}
      game={game}
      store={store}
      template={template}
      onDone={() => onOpenChange(false)}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent aria-describedby="order-description" className="max-h-[92dvh]">
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="order-description"
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

function OrderSheetBody({
  product,
  game,
  store,
  template,
  onDone,
}: {
  product: Product;
  game: OrderGame;
  store: PublicCatalog["store"];
  template: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>("form");
  const isMobile = useIsMobile();
  const schema = useMemo(() => buildSchema(game), [game]);
  const domainGame = useMemo(() => asDomainGame(game), [game]);
  const reducedMotion = useReducedMotion();

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      customerName: "",
      note: "",
      ...Object.fromEntries(game.orderFields.map((f) => [f.key, ""])),
    },
  });

  // RHF watch() is incompatible with React Compiler memoization by design.
  // Live preview requires reactive form state. Safe: re-render on change.
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = watch();

  const message = useMemo(() => {
    try {
      const ctx = buildTemplateContext(
        {
          storeName: store.name,
          whatsappNumber: store.whatsappNumber,
          currency: "IDR",
          locale: "id-ID",
          maintenanceMode: false,
        },
        domainGame,
        product,
        {
          customerName: values.customerName ?? "",
          note: values.note ?? "",
          fields: values as Record<string, string>,
        }
      );
      return renderTemplate(template, ctx);
    } catch (e) {
      if (e instanceof UnknownPlaceholderError) return `Template tidak valid: ${e.message}`;
      return "";
    }
  }, [store, domainGame, product, template, values]);

  const goToReview = async () => {
    const ok = await trigger();
    if (ok) setStep("review");
  };

  const submitToWhatsApp = handleSubmit(() => {
    try {
      const url = buildWhatsAppUrl(store.whatsappNumber, message);
      // NOTE: open() with the "noopener" feature always returns null by spec,
      // so the popup-blocked check would misfire. Open plain, then detach
      // the opener manually for the same security property.
      const win = window.open(url, "_blank");
      if (!win) {
        // Popup blocked → surface the copy fallback explicitly (PRD §12.4).
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
      onDone();
    } catch {
      toast.error("Nomor WhatsApp store tidak valid", {
        description: "Hubungi admin. Konfigurasi nomor perlu diperbaiki.",
      });
    }
  });

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pesan disalin", { description: "Tempel di chat WhatsApp store." });
    } catch {
      toast.error("Gagal menyalin", { description: "Salin manual dari pratinjau pesan." });
    }
  }

  const slide = reducedMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 },
      };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col" data-step={step}>
      <HeaderBlock game={game} product={product} step={step} isMobile={isMobile} />

      <form onSubmit={submitToWhatsApp} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Product summary — always visible. */}
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {game.name}
              </p>
              <p className="truncate font-display text-base font-semibold">
                {productTitle(product)}
              </p>
            </div>
            <PriceTag value={product.priceIdr} size="lg" className="shrink-0" />
          </div>

          <AnimatePresence mode="wait">
            {step === "form" ? (
              <motion.div
                key="form"
                {...slide}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="mt-4 space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="customerName">Nama Anda</Label>
                  <Input
                    id="customerName"
                    autoComplete="name"
                    placeholder="Nama yang bisa dihubungi"
                    aria-invalid={errors.customerName ? true : undefined}
                    {...register("customerName")}
                  />
                  {errors.customerName ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errors.customerName.message as string}
                    </p>
                  ) : null}
                </div>

                {game.orderFields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required ? (
                        <span aria-hidden="true" className="text-primary">
                          {" "}
                          *
                        </span>
                      ) : null}
                    </Label>
                    <Input
                      id={field.key}
                      inputMode={field.type === "number" ? "numeric" : "text"}
                      placeholder={field.placeholder}
                      aria-invalid={errors[field.key] ? true : undefined}
                      aria-describedby={errors[field.key] ? `${field.key}-error` : undefined}
                      {...register(field.key)}
                    />
                    {errors[field.key] ? (
                      <p role="alert" id={`${field.key}-error`} className="text-xs text-destructive">
                        {(errors[field.key]?.message as string) ?? `${field.label} tidak valid`}
                      </p>
                    ) : null}
                  </div>
                ))}

                <div className="space-y-1.5">
                  <Label htmlFor="note">Catatan (opsional)</Label>
                  <Textarea
                    id="note"
                    rows={2}
                    placeholder="Contoh: kirim sesuai jam malam saja"
                    {...register("note")}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="review"
                {...slide}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="mt-4 space-y-4"
              >
                <h3 className="font-display text-sm font-semibold">Ringkasan pesanan</h3>
                <dl className="space-y-2.5 rounded-xl border bg-muted/30 p-4 text-sm">
                  <SummaryRow label="Game" value={game.name} />
                  <SummaryRow label="Produk" value={productTitle(product)} />
                  <SummaryRow label="Nama" value={values.customerName || "-"} />
                  {game.orderFields.map((f) => (
                    <SummaryRow key={f.key} label={f.label} value={values[f.key] || "-"} />
                  ))}
                  {values.note ? <SummaryRow label="Catatan" value={values.note} /> : null}
                </dl>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total pembayaran</span>
                  <PriceTag value={product.priceIdr} size="lg" />
                </div>

                <details className="group rounded-xl border bg-background/60">
                  <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    Lihat pesan WhatsApp yang akan terkirim
                  </summary>
                  <pre className="scroll-slim max-h-56 overflow-y-auto whitespace-pre-wrap border-t px-4 py-3 font-mono text-xs leading-relaxed text-foreground/90">
                    {message}
                  </pre>
                </details>

                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-wa" />
                  Pesanan dikirim ke <span className="font-mono text-foreground">{displayPhone(store.whatsappNumber)}</span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <FooterBlock
          step={step}
          onBack={() => setStep("form")}
          onNext={goToReview}
          onCopy={() => (message ? copyMessage(message) : undefined)}
          hasMessage={Boolean(message)}
        />
      </form>
    </div>
  );
}

function HeaderBlock({
  game,
  product,
  step,
  isMobile,
}: {
  game: OrderGame;
  product: Product;
  step: Step;
  isMobile: boolean;
}) {
  const title = step === "form" ? "Lengkapi data pesanan" : "Periksa pesanan";
  const description =
    step === "form"
      ? `Data akun dipakai untuk mengirim ${product.denomination} ${product.name} ke akun ${game.name} kamu.`
      : "Pastikan data sudah benar sebelum lanjut ke WhatsApp.";

  const titleNode = (
    <>
      <GameMark name={game.name} image={game.image} size="md" className="shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
    </>
  );

  if (isMobile) {
    return (
      <DrawerHeader className="flex-none border-b border-border/70 px-4 py-4 text-left">
        <DrawerTitle className="flex items-center gap-3 font-display">{titleNode}</DrawerTitle>
        <DrawerDescription className="text-balance">{description}</DrawerDescription>
      </DrawerHeader>
    );
  }

  return (
    <DialogHeader className="flex-none border-b border-border/70 px-6 py-4 text-left">
      <DialogTitle className="flex items-center gap-3 font-display">{titleNode}</DialogTitle>
      <DialogDescription className="text-balance">{description}</DialogDescription>
    </DialogHeader>
  );
}

function FooterBlock({
  step,
  onBack,
  onNext,
  onCopy,
  hasMessage,
}: {
  step: Step;
  onBack: () => void;
  onNext: () => void;
  onCopy: () => void;
  hasMessage: boolean;
}) {
  if (step === "form") {
    return (
      <div className="flex-none border-t border-border/70 bg-background/80 p-4 backdrop-blur sm:px-6">
        <Button type="button" size="lg" className="w-full gap-2 font-semibold" onClick={onNext}>
          Lanjut ke ringkasan
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-none border-t border-border/70 bg-background/80 p-4 backdrop-blur sm:px-6">
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="gap-1.5 sm:w-auto"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Kembali
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="gap-1.5 text-muted-foreground sm:w-auto"
          onClick={onCopy}
          disabled={!hasMessage}
          aria-label="Salin pesan WhatsApp ke papan klip"
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          Salin pesan
        </Button>
        <Button
          type="submit"
          size="lg"
          className="flex-1 gap-2 bg-wa font-semibold text-wa-foreground shadow-card hover:bg-wa/90"
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          Lanjut ke WhatsApp
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}
