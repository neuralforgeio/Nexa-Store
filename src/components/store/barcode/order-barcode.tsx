"use client";

import { useEffect, useRef, useState } from "react";
import { renderOrderBarcodeSvg } from "@/lib/barcode";
import { cn } from "@/lib/utils";

/**
 * Barcode resi Code 128 asli di atas pelat putih — seperti label tiket
 * sungguhan. Responsif (viewBox), nomor ID tercetak di bawah garis,
 * dan bisa dibungkus tombol oleh pemakai (zoom/unduh ada di tangan pemanggil).
 */
export function OrderBarcode({
  orderId,
  className,
  plateClassName,
  barHeight = 96,
  idClassName,
}: {
  orderId: string;
  /** Kelas untuk pembungkus luar (pelat putih). */
  className?: string;
  plateClassName?: string;
  /** Tinggi bar barcode dalam satuan render. */
  barHeight?: number;
  idClassName?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let cancelled = false;
    // Status awal "loading" dari useState; orderId stabil per pemasangan
    // (resi/pesanan selalu memuat komponen ini segar), jadi tak perlu
    // reset sinkron di sini — cukup hasil async yang memperbarui status.
    renderOrderBarcodeSvg(svg, orderId, { height: barHeight })
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, barHeight]);

  return (
    <div
      className={cn(
        "relative rounded-lg bg-white px-3 pb-2 pt-2.5 shadow-[inset_0_0_0_1px_rgba(9,9,11,0.08)]",
        className
      )}
    >
      {status === "loading" ? (
        <div
          aria-hidden="true"
          className="w-full animate-pulse rounded bg-zinc-200"
          style={{ height: Math.round(barHeight * 0.52) }}
        />
      ) : null}
      {status === "error" ? (
        <p className="py-3 text-center text-xs font-medium text-zinc-500">
          Barcode tidak dapat dibuat — salin ID di bawah ini.
        </p>
      ) : null}
      <svg
        ref={svgRef}
        role="img"
        aria-label={`Barcode pesanan ${orderId}`}
        className={cn(
          "block w-full",
          status === "ready" ? "opacity-100" : "absolute opacity-0"
        )}
      />
      <p
        className={cn(
          "pt-1.5 text-center font-mono text-[13px] font-semibold tracking-[0.28em] text-zinc-900",
          idClassName
        )}
      >
        {orderId}
      </p>
    </div>
  );
}
