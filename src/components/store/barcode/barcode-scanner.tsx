"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  Camera,
  CameraOff,
  CircleAlert,
  ImageUp,
  Loader2,
  ScanBarcode,
  ScanLine,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { extractOrderId } from "@/lib/barcode";
import { navigateTo } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Pemindai barcode pesanan (v1.16.0). Dua jalur:
 * - Kamera: pemindaian live @zxing/browser dengan bingkai penyisiran ala
 *   alat pemindai sungguhan (sudut emas + garis menyapu + vignette).
 * - Galeri: pilih/seret gambar (mis. barcode yang diunduh dari halaman sukses
 *   pesanan) → ID Order dibaca → resi terbuka otomatis.
 *
 * Hasil pindai apa pun yang memuat ID Order (tautan resi maupun teks mentah)
 * diterima; selain itu ditolak dengan pesan yang jelas.
 */

export function BarcodeScannerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [camKey, setCamKey] = useState(0);
  const [foundId, setFoundId] = useState<string | null>(null);
  const [tab, setTab] = useState<"camera" | "gallery">("camera");
  const timerRef = useRef<number | null>(null);

  // Radix melepas isi Dialog saat tertutup — foundId/tab/kamera reset otomatis
  // setiap kali dialog dibuka lagi; camKey hanya untuk memulai ulang kamera
  // setelah pindaian yang ditolak (dialog tetap terbuka).

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleResult = useCallback(
    (raw: string) => {
      const id = extractOrderId(raw);
      if (!id) {
        toast.error("Barcode ini bukan pesanan Nexa", {
          description:
            raw.trim().length > 90
              ? `${raw.trim().slice(0, 90)}…`
              : raw.trim() || "(kosong)",
        });
        setCamKey((k) => k + 1); // mulai ulang kamera untuk coba lagi
        return;
      }
      setFoundId(id);
      toast.success("Barcode terbaca", {
        description: `Membuka resi ${id}…`,
      });
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        onOpenChange(false);
        navigateTo(`/track?id=${encodeURIComponent(id)}`);
      }, 900);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="scan-description"
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="px-5 pb-3 pt-5 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 font-display">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <ScanBarcode aria-hidden="true" className="h-4.5 w-4.5" />
            </span>
            Pindai Barcode Pesanan
          </DialogTitle>
          <DialogDescription id="scan-description">
            Arahkan kamera ke barcode resi, atau ambil dari galeri — resi
            pesanan terbuka otomatis di Nexa Store.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "camera" | "gallery")}>
          <div className="relative">
            <div className="px-5 sm:px-6">
              <TabsList className="w-full">
                <TabsTrigger value="camera" className="flex-1 gap-1.5">
                  <Camera aria-hidden="true" className="h-3.5 w-3.5" />
                  Kamera
                </TabsTrigger>
                <TabsTrigger value="gallery" className="flex-1 gap-1.5">
                  <ImageUp aria-hidden="true" className="h-3.5 w-3.5" />
                  Galeri
                </TabsTrigger>
              </TabsList>
            </div>
            {/* Radix melepas isi tab yang tidak aktif — kamera otomatis
                berhenti saat berpindah ke galeri. */}
            <TabsContent value="camera" className="mt-0 p-0">
              <CameraScanner
                key={camKey}
                locked={foundId !== null}
                onResult={handleResult}
                onSwitchToGallery={() => setTab("gallery")}
              />
            </TabsContent>
            <TabsContent value="gallery" className="mt-0 p-0">
              <GalleryScanner locked={foundId !== null} onResult={handleResult} />
            </TabsContent>

              {foundId ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-background/92 backdrop-blur-sm"
                >
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 24 }}
                    className="flex flex-col items-center gap-2.5 px-6 text-center"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 shadow-[0_0_28px_-6px_var(--color-emerald-500)] dark:text-emerald-400">
                      <Sparkles aria-hidden="true" className="h-7 w-7" />
                    </span>
                    <p className="font-display text-base font-semibold">ID ditemukan</p>
                    <p className="font-mono text-sm font-semibold tracking-[0.12em] text-primary">
                      {foundId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Membuka resi pesanan…
                    </p>
                  </motion.div>
                </motion.div>
              ) : null}
            </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ── kamera ────────────────────────────────────────────────────────── */

type CameraPhase = "starting" | "scanning" | "denied" | "nocamera" | "error";

function CameraScanner({
  locked,
  onResult,
  onSwitchToGallery,
}: {
  locked: boolean;
  onResult: (raw: string) => void;
  onSwitchToGallery: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<CameraPhase>("starting");
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("nocamera");
      return;
    }
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    let settled = false;
    const stopRef = { current: null as null | (() => void) };
    void (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 180,
        });
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false },
          videoRef.current ?? undefined,
          (result) => {
            if (settled || cancelled || !result) return;
            settled = true;
            try {
              controls?.stop();
            } catch {
              // stream boleh sudah mati
            }
            onResult(result.getText());
          }
        );
        stopRef.current = () => {
          try {
            controls?.stop();
          } catch {
            // abaikan
          }
        };
        if (cancelled) {
          stopRef.current();
          return;
        }
        setPhase("scanning");
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException | Error)?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") setPhase("denied");
        else if (
          name === "NotFoundError" ||
          name === "OverconstrainedError" ||
          name === "NotReadableError" ||
          name === "AbortError"
        )
          setPhase("nocamera");
        else setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      stopRef.current?.();
    };
  }, [onResult]);

  return (
    <div className="p-4 pt-3 sm:p-5 sm:pt-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-zinc-950">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Pratinjau kamera pemindai barcode"
          className={cn(
            "h-full w-full object-cover transition-opacity duration-500",
            phase === "scanning" ? "opacity-100" : "opacity-30"
          )}
        />

        {/* vignette tepi — fokus ke tengah */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(9,9,11,0.62)_100%)]"
        />

        {phase === "scanning" ? (
          <>
            {/* bingkai pemindai: pita lebar + sudut emas */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-6 top-1/2 h-[34%] -translate-y-1/2 sm:inset-x-10"
            >
              <span className="absolute -left-0.5 -top-0.5 h-7 w-7 rounded-tl-lg border-l-[3px] border-t-[3px] border-primary shadow-[0_0_14px_-4px_var(--primary)]" />
              <span className="absolute -right-0.5 -top-0.5 h-7 w-7 rounded-tr-lg border-r-[3px] border-t-[3px] border-primary shadow-[0_0_14px_-4px_var(--primary)]" />
              <span className="absolute -bottom-0.5 -left-0.5 h-7 w-7 rounded-bl-lg border-b-[3px] border-l-[3px] border-primary shadow-[0_0_14px_-4px_var(--primary)]" />
              <span className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-br-lg border-b-[3px] border-r-[3px] border-primary shadow-[0_0_14px_-4px_var(--primary)]" />
              {/* garis penyapu */}
              {reducedMotion ? (
                <span className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary/80 shadow-[0_0_16px_2px_var(--glow-primary)]" />
              ) : (
                <motion.span
                  className="absolute inset-x-3 h-0.5 rounded-full bg-primary shadow-[0_0_16px_2px_var(--glow-primary)]"
                  animate={{ top: ["6%", "92%", "6%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </div>
            <p className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-100/90">
              <ScanLine aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
              Arahkan ke barcode pesanan
            </p>
          </>
        ) : null}

        {phase === "starting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-100">
            <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin text-primary" />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em]">
              Menyiapkan kamera…
            </p>
          </div>
        ) : null}

        {(phase === "denied" || phase === "nocamera" || phase === "error") && !locked ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-zinc-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-100/20 bg-zinc-100/10">
              {phase === "denied" ? (
                <CameraOff aria-hidden="true" className="h-6 w-6" />
              ) : (
                <CircleAlert aria-hidden="true" className="h-6 w-6" />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold">
                {phase === "denied"
                  ? "Izin kamera ditolak"
                  : phase === "nocamera"
                    ? "Kamera tidak tersedia"
                    : "Kamera gagal dinyalakan"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-100/70">
                {phase === "denied"
                  ? "Izinkan kamera dari pengaturan peramban, atau pindai dari galeri saja."
                  : "Perangkat atau peramban ini tidak menyediakan kamera — gunakan tab Galeri."}
              </p>
            </div>
            {phase !== "error" ? (
              <Button
                type="button"
                size="sm"
                className="gap-1.5 bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                onClick={onSwitchToGallery}
              >
                <ImageUp aria-hidden="true" className="h-3.5 w-3.5" />
                Pindai dari galeri
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="mt-3 px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
        Barcode resi tercetak di halaman Lacak Pesanan dan di halaman sukses
        pesanan kamu.
      </p>
    </div>
  );
}

/* ── galeri ────────────────────────────────────────────────────────── */

function GalleryScanner({
  locked,
  onResult,
}: {
  locked: boolean;
  onResult: (raw: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "decoding">("idle");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (locked) setPhase("idle");
  }, [locked]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !file.type.startsWith("image/")) {
        toast.error("Bukan gambar", {
          description: "Pilih tangkapan layar atau foto barcode pesanan.",
        });
        return;
      }
      setPhase("decoding");
      const url = URL.createObjectURL(file);
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 120,
        });
        const result = await reader.decodeFromImageUrl(url);
        onResult(result.getText());
        setPhase("idle");
      } catch {
        setPhase("idle");
        toast.error("Barcode tidak terbaca", {
          description:
            "Pastikan gambar barcode utuh, jelas, dan tidak terpotong — lalu coba lagi.",
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [onResult]
  );

  return (
    <div className="p-4 pt-3 sm:p-5 sm:pt-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragOver
            ? "border-primary/60 bg-primary/10"
            : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary/[0.06]"
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary"
        >
          {phase === "decoding" ? (
            <Loader2 className="h-5.5 w-5.5 animate-spin" />
          ) : (
            <ImageUp className="h-5.5 w-5.5" />
          )}
        </span>
        {phase === "decoding" ? (
          <p className="text-sm font-medium">Membaca barcode…</p>
        ) : (
          <>
            <p className="text-sm font-semibold">Pilih gambar dari galeri</p>
            <p className="mx-auto max-w-[34ch] text-xs leading-relaxed text-muted-foreground">
              Tangkapan layar barcode resi atau fotonya — ID Order akan dibaca
              dan resinya terbuka otomatis.
            </p>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Pilih gambar barcode dari galeri"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = ""; // file yang sama bisa dipilih ulang
        }}
      />
      <div className="mt-3 flex justify-center">
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <ImageUp aria-hidden="true" className="h-3.5 w-3.5" />
          Buka galeri
        </Button>
      </div>
    </div>
  );
}
