import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { newId, readFeature, updateFeature } from "@/lib/site-features/store";
import { parseSchedules } from "@/lib/site-features/schema";
import type { ScheduleTask } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Scheduled tasks CRUD (v1.3.0) — developer only.
 *
 * Tasks are executed by the scheduler inside the Telegram bot service (the
 * only always-on process). This API is the shared store both sides talk to:
 * the panel creates/cancels, the bot polls for due tasks and PATCHes results.
 */

const createSchema = z.object({
  label: z.string().trim().min(3).max(80),
  type: z.enum([
    "maintenance-on",
    "maintenance-off",
    "lockdown-on",
    "lockdown-off",
    "banner-on",
    "banner-off",
    "promo-on",
    "promo-off",
    "announcement-set",
    "reminder",
  ]),
  runAt: z.string().datetime(),
  payload: z
    .object({
      note: z.string().max(300).optional(),
      bannerId: z.string().min(1).optional(),
      promoId: z.string().min(1).optional(),
      text: z.string().max(500).optional(),
      scope: z.enum(["all", "routes"]).optional(),
      routes: z.array(z.string()).max(12).optional(),
    })
    .default({}),
});

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["cancelled", "done", "failed"]),
  lastResult: z.string().max(500).optional(),
});

const MAX_PENDING = 30;

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "schedules.manage");
  if (denied) return denied;
  const raw = await readFeature("schedules");
  const file = parseSchedules(raw);
  const order = { pending: 0, done: 1, failed: 2, cancelled: 3 } as const;
  const tasks = [...file.tasks].sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    return Date.parse(a.runAt) - Date.parse(b.runAt);
  });
  return jsonOk({ tasks: tasks.slice(0, 60) });
}

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "schedules.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", parsed.error.issues[0]?.message ?? "Data tugas tidak valid.");
  }
  const input = parsed.data;

  const runAtMs = Date.parse(input.runAt);
  if (Number.isNaN(runAtMs)) return jsonError(400, "validation", "Waktu jalan tidak valid.");
  if (runAtMs < Date.now() - 60_000) {
    return jsonError(400, "validation", "Waktu jalan harus di masa depan.");
  }
  if (runAtMs > Date.now() + 365 * 24 * 3600_000) {
    return jsonError(400, "validation", "Waktu jalan maksimal 1 tahun ke depan.");
  }
  if (input.type === "banner-on" && !input.payload.bannerId) {
    return jsonError(400, "validation", "Pilih banner yang akan diterbitkan.");
  }
  if (input.type === "promo-on" && !input.payload.promoId) {
    return jsonError(400, "validation", "Pilih promo yang akan diaktifkan.");
  }
  if ((input.type === "reminder" || input.type === "announcement-set") && !input.payload.text?.trim()) {
    return jsonError(400, "validation", "Tulis isi teks untuk tugas ini.");
  }

  try {
    let created: ScheduleTask | null = null;
    await updateFeature("schedules", "ops: create scheduled task", (currentRaw) => {
      const file = parseSchedules(currentRaw);
      const pending = file.tasks.filter((t) => t.status === "pending");
      if (pending.length >= MAX_PENDING) throw new Error("limit");
      const task: ScheduleTask = {
        id: newId("task"),
        label: input.label,
        type: input.type,
        payload: input.payload,
        runAt: input.runAt,
        status: "pending",
        createdAt: new Date().toISOString(),
        createdBy: session.email as string,
      };
      created = task;
      return { tasks: [...file.tasks.filter((t) => t.status !== "done" && t.status !== "failed" ? t : t), task].slice(-120) };
    });
    return jsonOk({ task: created });
  } catch (e) {
    if ((e as Error).message === "limit") {
      return jsonError(400, "limit", "Maksimal 30 tugas tertunda.");
    }
    return jsonError(502, "schedule.failed", "Tugas gagal dibuat. Coba lagi.");
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireCapability(req, "schedules.manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", "Data tugas tidak valid.");
  const input = parsed.data;

  try {
    await updateFeature("schedules", "ops: update scheduled task", (currentRaw) => {
      const file = parseSchedules(currentRaw);
      const index = file.tasks.findIndex((t) => t.id === input.id);
      if (index === -1) throw new Error("not-found");
      const tasks = [...file.tasks];
      const prev = tasks[index];
      if (prev.status !== "pending" && input.status !== "cancelled") {
        // Executor may only move pending → terminal states.
        return { tasks };
      }
      tasks[index] = {
        ...prev,
        status: input.status,
        ...(input.lastResult !== undefined ? { lastResult: input.lastResult } : {}),
        ...(input.status !== "cancelled" ? { completedAt: new Date().toISOString() } : {}),
      };
      return { tasks };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "schedule.not-found", "Tugas tidak ditemukan.");
    }
    return jsonError(502, "schedule.failed", "Tugas gagal diperbarui. Coba lagi.");
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireCapability(req, "schedules.manage");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return jsonError(400, "validation", "Id tugas wajib disertakan.");

  try {
    await updateFeature("schedules", "ops: delete scheduled task", (currentRaw) => {
      const file = parseSchedules(currentRaw);
      const next = file.tasks.filter((t) => t.id !== id);
      if (next.length === file.tasks.length) throw new Error("not-found");
      return { tasks: next };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "schedule.not-found", "Tugas tidak ditemukan.");
    }
    return jsonError(502, "schedule.failed", "Tugas gagal dihapus. Coba lagi.");
  }
}
