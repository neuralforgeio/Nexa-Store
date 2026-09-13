import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GateRetryButton } from "@/components/store/gate/gate-retry";
import { readAccessControl } from "@/lib/auth/access";
import { normalizeGate } from "@/lib/catalog/site-control";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lockdown",
  robots: { index: false, follow: false },
};

/**
 * LOCKDOWN gate screen (Developer site-control).
 * Shown when the whole storefront or specific routes are locked down.
 * Standalone page: no storefront header/footer, red-on-black regardless of
 * the visitor's theme, content server-rendered so the reason is visible
 * even before hydration.
 */
export default async function LockdownPage() {
  const control = await readAccessControl();
  const lockdown = normalizeGate(control.lockdown);

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  const viewerRole = session.ok ? session.role : null;

  const routeLabels =
    lockdown.scope === "routes"
      ? lockdown.routes.map((r) => r.replace("/games/*", "/games/…")).join(", ")
      : null;

  return (
    <main
      id="main"
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[oklch(0.145_0.02_25)] px-4 py-16 text-center text-[oklch(0.93_0.01_25)]"
    >
      {/* Dark red lighting layers */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,oklch(0.36_0.14_25_/_0.28),transparent_65%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_130%_at_50%_50%,transparent_35%,oklch(0.09_0.02_25_/_0.9)_100%)]"
      />
      {/* Hazard stripes */}
      <div
        aria-hidden="true"
        className="gate-anim pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(-45deg,oklch(0.55_0.19_25)_0_16px,transparent_16px_32px)] opacity-90"
      />
      {/* Slow red sweep */}
      <div
        aria-hidden="true"
        className="gate-anim pointer-events-none absolute inset-y-0 w-40 bg-gradient-to-r from-transparent via-[oklch(0.5_0.16_25_/_0.05)] to-transparent"
        style={{ animation: "lockdown-sweep 9s linear infinite" }}
      />

      <div className="relative flex w-full max-w-lg flex-col items-center">
        <span
          aria-hidden="true"
          className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl border border-[oklch(0.45_0.16_25_/_0.4)] bg-[oklch(0.2_0.04_25)] font-display text-lg font-bold text-[oklch(0.6_0.13_25)]"
        >
          N
        </span>

        {/* Skull with pulsing halo */}
        <div className="relative">
          <span
            aria-hidden="true"
            className="gate-anim absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,oklch(0.5_0.19_25_/_0.45),transparent)]"
            style={{ animation: "blocked-pulse 2.4s ease-in-out infinite" }}
          />
          <span className="relative flex h-28 w-28 items-center justify-center rounded-3xl border border-[oklch(0.45_0.16_25_/_0.55)] bg-[oklch(0.2_0.05_25)] text-[oklch(0.75_0.15_25)] shadow-[inset_0_1px_0_oklch(0.35_0.08_25),0_16px_48px_-12px_oklch(0.5_0.19_25_/_0.5)]">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-14 w-14"
            >
              <circle cx="9" cy="12.5" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12.5" r="1.6" fill="currentColor" stroke="none" />
              <path d="M8 20v-1.5" />
              <path d="M16 20v-1.5" />
              <path d="M12.5 17h-1l-.5 2h2z" fill="currentColor" stroke="none" />
              <path d="M12 2a8 8 0 0 0-8 8v3.5a2.5 2.5 0 0 0 2.5 2.5H8v2l1.5-1.5h5L16 18v-2h1.5a2.5 2.5 0 0 0 2.5-2.5V10a8 8 0 0 0-8-8Z" />
            </svg>
          </span>
        </div>

        <p className="mt-8 font-mono text-[11px] font-semibold uppercase tracking-[0.35em] text-[oklch(0.66_0.15_25)]">
          Akses ditutup
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold uppercase tracking-[0.08em] text-[oklch(0.82_0.13_25)] sm:text-5xl">
          Lockdown
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-[oklch(0.75_0.02_25)]">
          Situs ini sedang berada dalam mode lockdown yang ditetapkan oleh
          pengelola teknis situs. Seluruh akses pembeli sementara ditutup
          sampai batas waktu yang tidak ditentukan.
        </p>

        {/* The Developer's reason */}
        <div className="mt-7 w-full rounded-xl border border-[oklch(0.45_0.16_25_/_0.45)] bg-[oklch(0.19_0.04_25_/_0.85)] p-4 text-left">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.66_0.14_25)]">
            {lockdown.scope === "routes" ? `Alasan · route ${routeLabels}` : "Alasan"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[oklch(0.88_0.02_25)]">
            {lockdown.note?.trim()
              ? `“${lockdown.note.trim()}”`
              : "Pengelola tidak mencantumkan alasan. Situs akan dibuka kembali setelah keputusan diambil."}
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <GateRetryButton gate="lockdown" className="flex flex-col items-center" />
        </div>

        {viewerRole === "DEVELOPER" ? (
          <div className="mt-8 w-full rounded-xl border border-[oklch(0.5_0.14_60_/_0.35)] bg-[oklch(0.2_0.04_25_/_0.85)] p-4 text-left">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.8_0.11_60)]">
              Panel Developer
            </p>
            <p className="mt-1.5 text-sm text-[oklch(0.8_0.02_25)]">
              Anda masuk sebagai Developer. Lockdown dapat dinonaktifkan dari
              kontrol situs.
            </p>
            <a
              href="/dev/control"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[oklch(0.5_0.14_60_/_0.4)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.85_0.1_60)] transition-colors hover:bg-[oklch(0.28_0.08_60_/_0.3)]"
            >
              Buka Kontrol Situs →
            </a>
          </div>
        ) : null}

        <p className="mt-10 text-[11px] text-[oklch(0.55_0.03_25)]">
          Nexa Store · akses ditutup sementara oleh pengelola
        </p>
      </div>
    </main>
  );
}
