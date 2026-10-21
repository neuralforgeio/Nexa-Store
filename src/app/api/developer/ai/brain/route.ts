import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonOk, jsonError, requireCapability, getSession, enforceMutationRateLimit } from "@/lib/api/http";
import { updateFeature } from "@/lib/site-features/store";
import { botBrainFileSchema } from "@/lib/site-features/schema";
import { invalidateBrainCache } from "@/lib/nexa-bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Panel AI Bot — reset otak kustom (v1.17.0, developer only).
 * DELETE { keepDataset: boolean }
 *   keepDataset=true  → buang model hasil training, dataset kustom dipertahankan.
 *   keepDataset=false → kembalikan file ke kosong (otak bawaan repo dipakai).
 */

const resetSchema = z.object({ keepDataset: z.boolean().default(true) });

export async function DELETE(req: NextRequest) {
  const denied = await requireCapability(req, "botAi.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");
  const limited = enforceMutationRateLimit(session.email);
  if (limited) return limited;

  let body: unknown = { keepDataset: true };
  try {
    body = await req.json();
  } catch {
    // body kosong → default keepDataset=true
  }
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Permintaan reset tidak valid.");
  }

  try {
    const result = await updateFeature("bot-brain", "bot-brain: reset", (currentRaw) => {
      const parsedCurrent = botBrainFileSchema.safeParse(currentRaw);
      const current = parsedCurrent.success ? parsedCurrent.data : { customIntents: [] };
      if (parsed.data.keepDataset) {
        // Buang model + metadata training, pertahankan dataset (overlay tetap hidup).
        return { customIntents: current.customIntents };
      }
      return { customIntents: [] };
    });
    invalidateBrainCache();
    return jsonOk({ reset: true, keepDataset: parsed.data.keepDataset, dataset: result.customIntents });
  } catch {
    return jsonError(502, "ai.reset.failed", "Reset otak gagal. Coba lagi.");
  }
}
