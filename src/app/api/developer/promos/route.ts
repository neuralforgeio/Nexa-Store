import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { newId, readFeature, updateFeature } from "@/lib/site-features/store";
import { parsePromos } from "@/lib/site-features/schema";
import type { PromoEvent } from "@/lib/site-features/types";

export const dynamic = "force-dynamic";

/**
 * Promo engine CRUD (v1.3.0) — developer only.
 * Promos are runtime-read: creating one takes effect on the storefront within
 * the next site-features poll — no deploy needed.
 */

async function gameIds(): Promise<Set<string>> {
  const { repo } = getRepository();
  const read = await repo.readSnapshot();
  return new Set(read.snapshot.games.map((g) => g.id));
}

const isoOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const createSchema = z.object({
  title: z.string().trim().min(3).max(60),
  scope: z.enum(["global", "game"]),
  gameId: z.string().min(1).optional(),
  percentOff: z.number().int().min(1).max(90),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
});

const patchSchema = z.object({
  id: z.string().min(1),
  active: z.boolean().optional(),
  title: z.string().trim().min(3).max(60).optional(),
  percentOff: z.number().int().min(1).max(90).optional(),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
});

function validateWindow(startsAt: string | null, endsAt: string | null): string | null {
  if (startsAt && Number.isNaN(Date.parse(startsAt))) return "Waktu mulai tidak valid.";
  if (endsAt && Number.isNaN(Date.parse(endsAt))) return "Waktu selesai tidak valid.";
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return "Waktu selesai harus setelah waktu mulai.";
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "promos.manage");
  if (denied) return denied;
  const raw = await readFeature("promos");
  const file = parsePromos(raw);
  return jsonOk({
    promos: [...file.promos].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    ),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "promos.manage");
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
  if (!parsed.success) return jsonError(400, "validation", "Data promo tidak valid.");
  const input = parsed.data;

  if (input.scope === "game" && !input.gameId) {
    return jsonError(400, "validation", "Pilih game untuk promo per-game.");
  }
  if (input.scope === "game" && input.gameId) {
    const ids = await gameIds().catch(() => null);
    if (ids && !ids.has(input.gameId)) {
      return jsonError(400, "validation", "Game tidak ditemukan.");
    }
  }
  const windowError = validateWindow(input.startsAt, input.endsAt);
  if (windowError) return jsonError(400, "validation", windowError);

  const MAX_PROMOS = 12;
  try {
    let created: PromoEvent | null = null;
    await updateFeature("promos", "store: create promo", (currentRaw) => {
      const file = parsePromos(currentRaw);
      if (file.promos.length >= MAX_PROMOS) throw new Error("limit");
      const promo: PromoEvent = {
        id: newId("promo"),
        title: input.title,
        scope: input.scope,
        ...(input.scope === "game" && input.gameId ? { gameId: input.gameId } : {}),
        percentOff: input.percentOff,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: session.email as string,
      };
      created = promo;
      return { promos: [promo, ...file.promos] };
    });
    return jsonOk({ promo: created });
  } catch (e) {
    if ((e as Error).message === "limit") {
      return jsonError(400, "limit", "Maksimal 12 promo tersimpan. Hapus yang lama dulu.");
    }
    return jsonError(502, "promo.failed", "Promo gagal dibuat. Coba lagi.");
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireCapability(req, "promos.manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", "Data promo tidak valid.");
  const input = parsed.data;
  const windowError = validateWindow(input.startsAt ?? null, input.endsAt ?? null);
  if (windowError) return jsonError(400, "validation", windowError);

  try {
    await updateFeature("promos", "store: update promo", (currentRaw) => {
      const file = parsePromos(currentRaw);
      const index = file.promos.findIndex((p) => p.id === input.id);
      if (index === -1) throw new Error("not-found");
      const promos = [...file.promos];
      const prev = promos[index];
      promos[index] = {
        ...prev,
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.percentOff !== undefined ? { percentOff: input.percentOff } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      };
      return { promos };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "promo.not-found", "Promo tidak ditemukan.");
    }
    return jsonError(502, "promo.failed", "Promo gagal diperbarui. Coba lagi.");
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireCapability(req, "promos.manage");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return jsonError(400, "validation", "Id promo wajib disertakan.");

  try {
    await updateFeature("promos", "store: delete promo", (currentRaw) => {
      const file = parsePromos(currentRaw);
      const next = file.promos.filter((p) => p.id !== id);
      if (next.length === file.promos.length) throw new Error("not-found");
      return { promos: next };
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if ((e as Error).message === "not-found") {
      return jsonError(404, "promo.not-found", "Promo tidak ditemukan.");
    }
    return jsonError(502, "promo.failed", "Promo gagal dihapus. Coba lagi.");
  }
}
