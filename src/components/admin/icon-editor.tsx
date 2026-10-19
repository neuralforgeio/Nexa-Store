"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Crop, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Icon editor (v1.14.0) — potong icon game di dalam modal.
 *
 * Gaya "pas-foto": viewport persegi, gambar digeser (drag / panah) dan
 * di-zoom (slider / roda) untuk memilih area potong; tombol putar 90° kiri
 * kanan serta flip horizontal/vertikal. Hasil dirender ke canvas 256×256
 * (webp, fallback jpeg) — persis pratinjau yang terlihat.
 */

const VIEW = 320; // px — sisi viewport pratinjau
const OUTPUT = 256; // px — sisi icon hasil
const ZOOM_MAX = 4;
/** Max stored icon size (data URI characters) — sama dengan pipeline lama. */
const ICON_LIMIT_CHARS = 260_000;

type EditorState = {
  rot: number; // 0 | 90 | 180 | 270 (dinormalisasi)
  flipH: boolean;
  flipV: boolean;
  zoom: number; // 1..ZOOM_MAX — pengali di atas cover-scale
  offX: number;
  offY: number;
};

const INITIAL: EditorState = { rot: 0, flipH: false, flipV: false, zoom: 1, offX: 0, offY: 0 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gambar tidak dapat dibaca."));
    img.src = src;
  });
}

/** Pre-downscale foto raksasa agar kanvas tetap ringan (min sisi ≤ 2048). */
async function normalizeSource(src: string): Promise<HTMLImageElement> {
  const img = await loadImage(src);
  const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
  if (maxSide <= 2048) return img;
  const k = 2048 / maxSide;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return loadImage(canvas.toDataURL("image/png"));
}

export function IconEditorDialog({
  open,
  onOpenChange,
  src,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Object URL / data URI gambar mentah yang akan dipotong. */
  src: string | null;
  onApply: (dataUri: string) => void;
}) {
  const [st, setSt] = useState<EditorState>(INITIAL);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);
  // Dimensi termutakhir untuk listener non-passive (roda) di luar render cycle.
  const dimsRef = useRef<{ bw: number; bh: number }>({ bw: 0, bh: 0 });

  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    setSt(INITIAL);
    setImg(null);
    void normalizeSource(src)
      .then((loaded) => {
        if (!cancelled) setImg(loaded);
      })
      .catch(() => {
        if (!cancelled) toast.error("Gambar tidak dapat dibaca.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, src]);

  const rotated = st.rot % 180 !== 0;
  const bw = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 0;
  const bh = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 0;
  dimsRef.current = { bw, bh };
  const cover = bw > 0 && bh > 0 ? VIEW / Math.min(bw, bh) : 1;
  const scale = cover * st.zoom;
  const maxOffX = Math.max(0, (scale * bw - VIEW) / 2);
  const maxOffY = Math.max(0, (scale * bh - VIEW) / 2);

  const patch = (p: Partial<EditorState>) => setSt((prev) => ({ ...prev, ...p }));

  const clampOffsets = useCallback(
    (s: EditorState, bw: number, bh: number): EditorState => {
      const rot = s.rot % 180 !== 0;
      const w = rot ? bh : bw;
      const h = rot ? bw : bh;
      const cov = w > 0 && h > 0 ? VIEW / Math.min(w, h) : 1;
      const sc = cov * s.zoom;
      return {
        ...s,
        offX: Math.max(-Math.max(0, (sc * w - VIEW) / 2), Math.min(Math.max(0, (sc * w - VIEW) / 2), s.offX)),
        offY: Math.max(-Math.max(0, (sc * h - VIEW) / 2), Math.min(Math.max(0, (sc * h - VIEW) / 2), s.offY)),
      };
    },
    []
  );

  const rotate = (dir: 1 | -1) =>
    setSt((prev) => clampOffsets({ ...prev, rot: (((prev.rot + dir * 90) % 360) + 360) % 360 }, bw, bh));

  // Roda = zoom (listener non-passive agar halaman tidak ikut menggulung).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { bw, bh } = dimsRef.current;
      if (bw <= 0 || bh <= 0) return;
      e.preventDefault();
      setSt((prev) =>
        clampOffsets(
          { ...prev, zoom: Math.max(1, Math.min(ZOOM_MAX, prev.zoom * (e.deltaY > 0 ? 0.94 : 1.06))) },
          bw,
          bh
        )
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clampOffsets]);

  const apply = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Peramban tidak mendukung pemrosesan gambar.");
      const k = OUTPUT / VIEW;
      ctx.translate(OUTPUT / 2 + st.offX * k, OUTPUT / 2 + st.offY * k);
      ctx.rotate((st.rot * Math.PI) / 180);
      ctx.scale((st.flipH ? -1 : 1) * scale * k, (st.flipV ? -1 : 1) * scale * k);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const webp = canvas.toDataURL("image/webp", 0.85);
      if (webp.length <= ICON_LIMIT_CHARS) {
        onApply(webp);
        onOpenChange(false);
        return;
      }
      const jpeg = canvas.toDataURL("image/jpeg", 0.8);
      if (jpeg.length > ICON_LIMIT_CHARS) {
        throw new Error("Hasil potongan masih terlalu besar. Perkecil zoom lalu coba lagi.");
      }
      onApply(jpeg);
      onOpenChange(false);
    } catch (e) {
      toast.error("Gagal memproses potongan", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Papan ketik: panah menggeser, +/- mengatur zoom.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8;
    if (e.key === "ArrowLeft") patch({ offX: Math.max(-maxOffX, st.offX - step) });
    else if (e.key === "ArrowRight") patch({ offX: Math.min(maxOffX, st.offX + step) });
    else if (e.key === "ArrowUp") patch({ offY: Math.max(-maxOffY, st.offY - step) });
    else if (e.key === "ArrowDown") patch({ offY: Math.min(maxOffY, st.offY + step) });
    else if (e.key === "+" || e.key === "=") patch({ zoom: Math.min(ZOOM_MAX, st.zoom + 0.1) });
    else if (e.key === "-" || e.key === "_") patch({ zoom: Math.max(1, st.zoom - 0.1) });
    else return;
    e.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Crop aria-hidden="true" className="h-4 w-4 text-primary" />
            Potong icon
          </DialogTitle>
          <DialogDescription>
            Geser gambar untuk memilih area, zoom untuk memperketat. Hasil dipangkas persegi {OUTPUT}×{OUTPUT}.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={viewportRef}
          role="application"
          aria-label="Area potong icon — gunakan panah untuk menggeser"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="relative mx-auto touch-none select-none overflow-hidden rounded-xl border bg-[conic-gradient(var(--color-muted)_0_25%,transparent_0_50%,var(--color-muted)_0_75%,transparent_0)] bg-[length:16px_16px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ width: VIEW, height: VIEW, cursor: img ? (dragRef.current ? "grabbing" : "grab") : "wait" }}
          onPointerDown={(e) => {
            if (!img) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, y: e.clientY, offX: st.offX, offY: st.offY };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            patch({
              offX: Math.max(-maxOffX, Math.min(maxOffX, d.offX + (e.clientX - d.x))),
              offY: Math.max(-maxOffY, Math.min(maxOffY, d.offY + (e.clientY - d.y))),
            });
          }}
          onPointerUp={(e) => {
            dragRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          {img ? (
            <img
              src={src ?? undefined}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none origin-center"
              style={{
                transform: `translate(-50%, -50%) translate(${st.offX}px, ${st.offY}px) rotate(${st.rot}deg) scale(${scale}) scaleX(${st.flipH ? -1 : 1}) scaleY(${st.flipV ? -1 : 1})`,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
              memuat gambar…
            </div>
          )}
          {/* bingkai bantu */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_var(--color-border)]" />
        </div>

        <div className="flex items-center justify-center gap-1.5">
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Putar 90° ke kiri" onClick={() => rotate(-1)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Putar 90° ke kanan" onClick={() => rotate(1)}>
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={st.flipH ? "default" : "outline"}
            size="icon"
            className="h-8 w-8"
            aria-label="Balik horizontal"
            aria-pressed={st.flipH}
            onClick={() => patch({ flipH: !st.flipH })}
          >
            <FlipHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={st.flipV ? "default" : "outline"}
            size="icon"
            className="h-8 w-8"
            aria-label="Balik vertikal"
            aria-pressed={st.flipV}
            onClick={() => patch({ flipV: !st.flipV })}
          >
            <FlipVertical className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="ml-1 gap-1 text-muted-foreground" onClick={() => setSt(INITIAL)}>
            <RefreshCw aria-hidden="true" className="h-3 w-3" />
            Reset
          </Button>
        </div>

        <div className="flex items-center gap-3 px-1">
          <span aria-hidden="true" className="font-mono text-[10px] text-muted-foreground">1×</span>
          <Slider
            value={[st.zoom]}
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            aria-label="Zoom gambar"
            onValueChange={(v) => setSt((prev) => clampOffsets({ ...prev, zoom: v[0] ?? 1 }, bw, bh))}
            className={cn(!img && "pointer-events-none opacity-50")}
          />
          <span aria-hidden="true" className="font-mono text-[10px] text-muted-foreground">{ZOOM_MAX}×</span>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button size="sm" onClick={() => void apply()} disabled={!img || busy}>
            Pasang icon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
