import { NextRequest } from "next/server";
import { jsonOk, jsonError, requireCapability } from "@/lib/api/http";
import { readFeature } from "@/lib/site-features/store";
import { botBrainFileSchema } from "@/lib/site-features/schema";
import { brainStatus } from "@/lib/nexa-bot/engine";
import { getRepository } from "@/lib/catalog/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Panel AI Bot — status otak & dataset (v1.17.0, developer only).
 * GET → otak aktif (bundled/kustom), metadata training, dataset kustom,
 *       statistik katalog, statistik corpus bawaan.
 */

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "botAi.manage");
  if (denied) return denied;
  try {
    const [status, rawBrain] = await Promise.all([
      brainStatus(),
      readFeature("bot-brain"),
    ]);
    const parsed = botBrainFileSchema.safeParse(rawBrain);
    const file = parsed.success ? parsed.data : null;

    let catalogStats: { games: number; products: number } | null = null;
    try {
      const { repo } = getRepository(false);
      const { snapshot } = await repo.readSnapshot();
      catalogStats = {
        games: snapshot.games.filter((g) => g.enabled !== false).length,
        products: snapshot.products.filter((p) => p.enabled !== false).length,
      };
    } catch {
      catalogStats = null;
    }

    return jsonOk({
      brain: status,
      dataset: file?.customIntents ?? [],
      catalog: catalogStats,
      engine: {
        mode: status.active,
        pipeline: "guard → order-status → math → resolver → overlay-kustom → NLP → gate",
        personalization: "ctx.userName (identitas chat / Telegram)",
      },
    });
  } catch {
    return jsonError(502, "ai.status", "Status otak bot tidak dapat dibaca.");
  }
}
