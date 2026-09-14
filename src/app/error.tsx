"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary (v1.8.0) — jaring pengaman terakhir untuk
 * kesalahan render yang lolos dari SectionBoundary (mis. error di shell
 * halaman itu sendiri). Pengunjung tetap mendapat tampilan rapi dengan
 * opsi coba lagi / kembali ke beranda — bukan layar putih.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[route-error]", error);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <main
        id="main"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
      >
        <AlertTriangle aria-hidden="true" className="h-12 w-12 text-amber-500" />
        <h1 className="font-display text-xl font-semibold">Terjadi gangguan di halaman ini</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Maaf — bagian halaman gagal dimuat. Situs lain tetap aman; coba
          muat ulang bagian ini atau kembali ke beranda.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground/70">Kode: {error.digest}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset} className="gap-1.5">
            <RotateCw aria-hidden="true" className="h-4 w-4" />
            Coba lagi
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Ke beranda</a>
          </Button>
        </div>
      </main>
      <footer className="mt-auto border-t px-4 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} NEXA STORE — Dikembangkan oleh Dearly Febriano
      </footer>
    </div>
  );
}
