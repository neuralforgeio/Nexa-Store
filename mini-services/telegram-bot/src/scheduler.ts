/**
 * Scheduler (v1.3.0) — eksekutor tugas terjadwal + digest analitik harian.
 *
 * Bot adalah satu-satunya proses yang hidup 24/7, jadi dialah jam dinding
 * toko: mengecek tugas jatuh tempo tiap 30 detik dan menjalankannya lewat API
 * developer yang sama dengan panel (validasi + audit tetap di aplikasi).
 */
import * as nexa from "./nexa";
import { lastDigestDay, markDigestDay, isPaired } from "./state";
import { notifyOwner } from "./owner";
import { taskDoneText, digestText } from "./ui";
import type { ScheduleRecord } from "./nexa";

const TICK_MS = 30_000;
const DIGEST_HOUR_WIB = 21;
const runningTasks = new Set<string>();
let ticking = false;

export function startScheduler(): void {
  // Hot-reload safe: bersihkan interval generasi lama sebelum memulai.
  const g = globalThis as { __nexaSchedInterval?: ReturnType<typeof setInterval> };
  if (g.__nexaSchedInterval) clearInterval(g.__nexaSchedInterval);
  g.__nexaSchedInterval = setInterval(() => void tick(), TICK_MS);
  void tick();
}

function wibParts(now = new Date()): { day: string; hour: number; minute: number } {
  const t = new Date(now.getTime() + 7 * 3600_000);
  return {
    day: t.toISOString().slice(0, 10),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await runDueTasks();
    await maybeDailyDigest();
  } finally {
    ticking = false;
  }
}

async function runDueTasks(): Promise<void> {
  const tasks = await nexa.getSchedules().catch(() => null);
  if (!tasks) return;
  const now = Date.now();
  const due = tasks.filter(
    (t) => t.status === "pending" && Date.parse(t.runAt) <= now && !runningTasks.has(t.id)
  );
  for (const task of due) {
    runningTasks.add(task.id);
    void executeTask(task).finally(() => runningTasks.delete(task.id));
  }
}

async function executeTask(task: ScheduleRecord): Promise<void> {
  let result: string;
  try {
    result = await runOne(task);
    await nexa.patchSchedule(task.id, { status: "done", lastResult: result }).catch(() => undefined);
    if (isPaired()) {
      await notifyOwner(taskDoneText(task, true, result));
    }
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    await nexa.patchSchedule(task.id, { status: "failed", lastResult: message }).catch(() => undefined);
    if (isPaired()) {
      await notifyOwner(taskDoneText(task, false, message));
    }
  }
}

async function runOne(task: ScheduleRecord): Promise<string> {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const note = typeof payload.note === "string" ? payload.note : undefined;
  const text = typeof payload.text === "string" ? payload.text : undefined;

  switch (task.type) {
    case "maintenance-on": {
      await nexa.setGate("maintenance", true, "all", [], note);
      return `Maintenance AKTIF${note ? ` — ${note}` : ""}`;
    }
    case "maintenance-off": {
      await nexa.setGate("maintenance", false, "all", []);
      return "Maintenance diangkat.";
    }
    case "lockdown-on": {
      await nexa.setGate("lockdown", true, "all", [], note);
      return `Lockdown AKTIF${note ? ` — ${note}` : ""}`;
    }
    case "lockdown-off": {
      await nexa.setGate("lockdown", false, "all", []);
      return "Lockdown diangkat.";
    }
    case "banner-on": {
      const id = String(payload.bannerId ?? "");
      if (!id) throw new Error("bannerId kosong.");
      await nexa.patchBanner(id, { enabled: true });
      return "Banner diterbitkan.";
    }
    case "banner-off": {
      const id = String(payload.bannerId ?? "");
      if (!id) throw new Error("bannerId kosong.");
      await nexa.patchBanner(id, { enabled: false });
      return "Banner disembunyikan.";
    }
    case "promo-on": {
      const id = String(payload.promoId ?? "");
      if (!id) throw new Error("promoId kosong.");
      await nexa.patchPromo(id, { active: true });
      return "Promo diaktifkan.";
    }
    case "promo-off": {
      const id = String(payload.promoId ?? "");
      if (!id) throw new Error("promoId kosong.");
      await nexa.patchPromo(id, { active: false });
      return "Promo dimatikan.";
    }
    case "announcement-set": {
      if (!text?.trim()) throw new Error("Teks announcement kosong.");
      const { settings } = await nexa.getSettings();
      await nexa.saveSettings({ ...settings, announcement: text.trim() });
      return "Announcement diperbarui.";
    }
    case "reminder": {
      if (!text?.trim()) throw new Error("Isi pengingat kosong.");
      await notifyOwner(`⏰ <b>PENGINGAT</b>\n\n${text.trim()}`);
      return "Pengingat terkirim.";
    }
    default:
      throw new Error(`Jenis tugas tidak dikenal: ${task.type}`);
  }
}

// ---------------------------------------------------------------------------
// Digest analitik harian — 21:00 WIB.
// ---------------------------------------------------------------------------

async function maybeDailyDigest(): Promise<void> {
  if (!isPaired()) return;
  const { day, hour } = wibParts();
  if (hour < DIGEST_HOUR_WIB) return;
  if (lastDigestDay() === day) return;

  const summary = await nexa.getAnalyticsSummary().catch(() => null);
  if (!summary) {
    // Jangan tandai hari ini — coba lagi tick berikutnya.
    return;
  }
  markDigestDay(day);
  await notifyOwner(digestText(summary));
}

/** Untuk status bot — info singkat. */
export async function schedulerStatusLine(): Promise<string> {
  const tasks = await nexa.getSchedules().catch(() => null);
  if (!tasks) return "⏰ Tugas: tidak terbaca";
  const pending = tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
  if (pending.length === 0) return "⏰ Tugas: tidak ada yang menunggu";
  const next = pending[0];
  const ms = Date.parse(next.runAt) - Date.now();
  const mins = Math.round(ms / 60_000);
  const when =
    ms <= 0
      ? "sekarang"
      : mins < 60
        ? `${mins} menit lagi`
        : `${Math.floor(mins / 60)} jam ${mins % 60} menit lagi`;
  return `⏰ Tugas: ${pending.length} menunggu · terdekat ${when}`;
}
