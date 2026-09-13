/**
 * Instrumentation (v1.4.0) — penyembuhan diri layanan bot Telegram.
 *
 * Saat dev server / instance aplikasi boot, bot di-revive otomatis lewat
 * POST /api/bot-service (aktif hanya bila BOT_SERVICE_LAUNCH=1, sandbox saja).
 * Pemeriksaan ulang berjala berkala: bila proses bot mati, ia dinyalakan
 * ulang tanpa menunggu intervensi.
 */

const REVIVE_AFTER_BOOT_MS = 15_000;
const HEALTHY_INTERVAL_MS = 10 * 60_000;
const RETRY_INTERVAL_MS = 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BOT_SERVICE_LAUNCH !== "1") return;

  const log = (...args: unknown[]) => console.log("[bot-guard]", ...args);

  const check = async (): Promise<boolean> => {
    try {
      const res = await fetch("http://127.0.0.1:3000/api/bot-service", {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => null)) as { data?: { running?: boolean } } | null;
      if (json?.data?.running) return true;
      log("probe selesai tapi bot belum terdeteksi hidup");
      return false;
    } catch (e) {
      log("probe gagal:", (e as Error).message);
      return false;
    }
  };

  const loop = async () => {
    const healthy = await check();
    setTimeout(() => void loop(), healthy ? HEALTHY_INTERVAL_MS : RETRY_INTERVAL_MS);
  };

  setTimeout(() => void loop(), REVIVE_AFTER_BOOT_MS);
}
