import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GateRetryButton } from "@/components/store/gate/gate-retry";
import { readAccessControl } from "@/lib/auth/access";
import { normalizeGate } from "@/lib/catalog/site-control";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pemeliharaan",
  robots: { index: false, follow: false },
};

/**
 * MAINTENANCE gate screen (Developer site-control) — amber, calmer than the
 * red lockdown screen. Content server-rendered so the message is visible
 * before hydration; standalone page with no storefront chrome.
 */
export default async function MaintenancePage() {
  const control = await readAccessControl();
  const maintenance = normalizeGate(control.maintenance);

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  const viewerRole = session.ok ? session.role : null;

  const routeLabels =
    maintenance.scope === "routes"
      ? maintenance.routes.map((r) => r.replace("/games/*", "/games/…")).join(", ")
      : null;

  return (
    <main
      id="main"
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[oklch(0.16_0.012_75)] px-4 py-16 text-center text-[oklch(0.94_0.008_75)]"
    >
      {/* Warm dark lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,oklch(0.78_0.14_80_/_0.16),transparent_65%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_130%_at_50%_50%,transparent_38%,oklch(0.11_0.012_75_/_0.9)_100%)]"
      />
      {/* Amber top line */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-transparent via-[oklch(0.8_0.15_85)] to-transparent opacity-90"
      />

      <div className="relative flex w-full max-w-lg flex-col items-center">
        <span
          aria-hidden="true"
          className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl border border-[oklch(0.8_0.12_85_/_0.3)] bg-[oklch(0.22_0.03_85)] font-display text-lg font-bold text-[oklch(0.83_0.13_85)]"
        >
          N
        </span>

        {/* Spinning gear + wrench badge */}
        <div className="relative">
          <span
            aria-hidden="true"
            className="gate-anim absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,oklch(0.8_0.14_85_/_0.22),transparent)]"
            style={{ animation: "blocked-pulse 3.2s ease-in-out infinite" }}
          />
          <span className="relative flex h-28 w-28 items-center justify-center rounded-3xl border border-[oklch(0.8_0.12_85_/_0.4)] bg-[oklch(0.22_0.04_85)] text-[oklch(0.82_0.13_85)] shadow-[inset_0_1px_0_oklch(0.4_0.06_85),0_16px_48px_-12px_oklch(0.7_0.14_85_/_0.35)]">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="gate-anim h-14 w-14"
              style={{ animation: "gear-spin 9s linear infinite" }}
            >
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </span>
        </div>

        <p className="mt-8 font-mono text-[11px] font-semibold uppercase tracking-[0.35em] text-[oklch(0.75_0.12_85)]">
          Sedang dikerjakan
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-[oklch(0.88_0.1_85)] sm:text-5xl">
          Pemeliharaan
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-[oklch(0.75_0.012_75)]">
          Kami sedang melakukan perbaikan dan penyempurnaan. Store akan dibuka
          kembali secepatnya — tidak ada pesanan yang hilang.
        </p>

        {/* The Developer's message */}
        <div className="mt-7 w-full rounded-xl border border-[oklch(0.8_0.12_85_/_0.35)] bg-[oklch(0.21_0.03_85_/_0.85)] p-4 text-left">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.75_0.12_85)]">
            {maintenance.scope === "routes" ? `Pesan · route ${routeLabels}` : "Pesan"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[oklch(0.9_0.015_75)]">
            {maintenance.note?.trim()
              ? `“${maintenance.note.trim()}”`
              : "Tim sedang melakukan pemeliharaan berkala. Terima kasih atas kesabarannya."}
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <GateRetryButton gate="maintenance" className="flex flex-col items-center" />
          <a
            href="/login"
            className="text-xs text-[oklch(0.65_0.012_75)] underline-offset-4 transition-colors hover:text-[oklch(0.85_0.01_75)] hover:underline"
          >
            Masuk sebagai staf
          </a>
        </div>

        {viewerRole === "DEVELOPER" ? (
          <div className="mt-8 w-full rounded-xl border border-[oklch(0.8_0.12_85_/_0.35)] bg-[oklch(0.21_0.03_85_/_0.85)] p-4 text-left">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.75_0.12_85)]">
              Panel Developer
            </p>
            <p className="mt-1.5 text-sm text-[oklch(0.8_0.012_75)]">
              Anda masuk sebagai Developer. Mode pemeliharaan dapat dinonaktifkan
              dari kontrol situs.
            </p>
            <a
              href="/dev/control"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[oklch(0.8_0.12_85_/_0.4)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.85_0.1_85)] transition-colors hover:bg-[oklch(0.3_0.08_85_/_0.25)]"
            >
              Buka Kontrol Situs →
            </a>
          </div>
        ) : null}

        <p className="mt-10 text-[11px] text-[oklch(0.55_0.012_75)]">
          Nexa Store · pemeliharaan dijalankan oleh Developer
        </p>
      </div>
    </main>
  );
}
