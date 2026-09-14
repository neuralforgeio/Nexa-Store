"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * SectionBoundary (v1.8.0) — circuit breaker untuk UI.
 *
 * Bug render di satu bagian halaman (hero, grid produk, chat widget, konsol
 * admin tertentu, dst.) DIPUTUS di sini: bagian itu menampilkan fallback
 * rapi + tombol coba lagi, sementara bagian halaman lain tetap hidup —
 * error tidak merambat menjatuhkan seluruh website (no white screen).
 *
 * Bonus observabilitas: error pertama per bagian (dengan throttle 5 menit)
 * dilaporkan ke /api/section-error → diteruskan ke Telegram pemilik,
 * sehingga bug yang menyinggung pengunjung ketahuan tanpa menunggu laporan
 * manual.
 */

type SectionBoundaryProps = {
  /** Nama bagian — tampil di fallback + laporan (mis. "home:hero"). */
  name: string;
  children: ReactNode;
  /** Matikan pelaporan otomatis (mis. untuk bagian non-kritis). */
  silent?: boolean;
  /** Kelas tambahan untuk kartu fallback. */
  className?: string;
};

type SectionBoundaryState = {
  error: Error | null;
  nonce: number;
};

// Throttle laporan: maks 1 laporan per (bagian+digest) per 5 menit.
const REPORT_WINDOW_MS = 5 * 60_000;
const reportThrottle = new Map<string, number>();

function shouldReport(key: string): boolean {
  const now = Date.now();
  const last = reportThrottle.get(key) ?? 0;
  if (now - last < REPORT_WINDOW_MS) return false;
  if (reportThrottle.size > 200) {
    for (const [k, t] of reportThrottle) {
      if (now - t > REPORT_WINDOW_MS) reportThrottle.delete(k);
    }
  }
  reportThrottle.set(key, now);
  return true;
}

function digest(message: string): string {
  let h = 5381;
  for (let i = 0; i < message.length; i++) {
    h = ((h << 5) + h + message.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
  state: SectionBoundaryState = { error: null, nonce: 0 };

  static getDerivedStateFromError(error: Error): Partial<SectionBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log penuh ke konsol browser untuk debugging developer.
    console.error(`[section-boundary] ${this.props.name}:`, error, info.componentStack);
    if (this.props.silent) return;
    const key = `${this.props.name}:${digest(error.message)}`;
    if (!shouldReport(key)) return;
    try {
      void fetch("/api/section-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section: this.props.name,
          message: error.message.slice(0, 300),
          stack: (error.stack ?? "").slice(0, 900),
          path: window.location.pathname,
        }),
        keepalive: true,
      });
    } catch {
      // pelaporan best-effort — jangan pernah mengganggu UI
    }
  }

  reset = () => {
    this.setState((s) => ({ error: null, nonce: s.nonce + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className={
            this.props.className ??
            "m-2 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-8"
          }
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle aria-hidden="true" className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Bagian ini gagal dimuat</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Bagian &quot;{this.props.name}&quot; mengalami gangguan — sisa halaman
                tetap berfungsi normal. Sudah dilaporkan otomatis ke developer.
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={this.reset}>
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              Coba lagi
            </Button>
          </div>
        </div>
      );
    }
    // key = nonce → retry memaksa subtree mount ulang dari nol.
    return (
      <div key={this.state.nonce} className="contents">
        {this.props.children}
      </div>
    );
  }
}
