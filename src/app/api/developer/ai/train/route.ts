import { NextRequest, after } from "next/server";
import { Nlp } from "@nlpjs/basic";
import { jsonOk, jsonError, requireCapability, getSession, enforceMutationRateLimit } from "@/lib/api/http";
import { updateFeature, readFeature } from "@/lib/site-features/store";
import { botBrainFileSchema } from "@/lib/site-features/schema";
import { invalidateBrainCache, brainStatus } from "@/lib/nexa-bot/engine";
import { getRepository } from "@/lib/catalog/repo";
import { buildCorpus, PERSONA } from "../../../../../../nexa-corpus.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Panel AI Bot — LATIH ULANG otak (v1.17.0, developer only).
 *
 * Melatih model NLP.js penuh dari: corpus bawaan (nexa-corpus.js) + katalog
 * LIVE + dataset kustom hasil impor → model disimpan ke data/store/bot-brain
 * (dual-mode sandbox/produksi, write-through GitHub) → engine situs
 * otomatis memakainya tanpa redeploy.
 *
 * Dataset kustom tetap hidup via overlay TF-IDF bahkan bila penulisan model
 * besar gagal — hasilnya dilaporkan jujur di respons.
 */

function readCurrent(raw: unknown) {
  const parsed = botBrainFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : { customIntents: [] };
}

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "botAi.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");
  const limited = enforceMutationRateLimit(session.email);
  if (limited) return limited;

  const t0 = Date.now();
  try {
    // 1. Katalog live + dataset kustom saat ini (TANPA menulis apa pun dulu —
    //    model lama tetap utuh bila training gagal di tengah jalan).
    const { repo } = getRepository(false);
    const { snapshot } = await repo.readSnapshot();
    const games = snapshot.games.filter((g) => g.enabled !== false);
    const gameIds = new Set(games.map((g) => g.id));
    const products = snapshot.products.filter((p) => gameIds.has(p.gameId) && p.enabled !== false);

    const brainRaw = await readFeature("bot-brain");
    const brainParsed = botBrainFileSchema.safeParse(brainRaw);
    const customIntents = brainParsed.success ? brainParsed.data.customIntents : [];

    // 2. Bangun corpus bersama (builtin + katalog + kustom).
    const now = new Date();
    const trainedAtLabel = new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Jakarta",
    }).format(now);
    const { intents, stats } = buildCorpus(games, products, trainedAtLabel, { customIntents });

    // 3. Latih model NLP penuh.
    const nlp = new Nlp({ languages: ["en"], threshold: 0.5, autoSave: false });
    for (const it of intents) {
      for (const u of it.utterances) nlp.addDocument("en", u, it.intent);
      nlp.addAnswer("en", it.intent, it.answer);
    }
    const tTrain = Date.now();
    await nlp.train();
    const trainMs = Date.now() - tTrain;
    const modelJson = nlp.export(true);

    // 4. Simpan model + metadata (file besar) ke data store.
    let modelSaved = true;
    let saveError: string | null = null;
    try {
      await updateFeature("bot-brain", "bot-brain: save trained model", (currentRaw) => {
        const current = readCurrent(currentRaw);
        return {
          version: "1.18.0",
          trainedAt: now.toISOString(),
          intentsCount: stats.intentCount,
          utterancesCount: stats.utteranceCount,
          modelJson,
          customIntents: current.customIntents,
        };
      });
    } catch (e) {
      modelSaved = false;
      saveError = e instanceof Error ? e.message : "penulisan model ke data store gagal";
    }

    invalidateBrainCache();

    const totalMs = Date.now() - t0;
    // Pastikan status yang dikembalikan segar (cache otak baru saja direset).
    after(() => {
      invalidateBrainCache();
    });

    const status = await brainStatus().catch(() => null);
    return jsonOk({
      trained: true,
      modelSaved,
      saveError,
      stats: {
        games: stats.gameCount,
        products: stats.productCount,
        intents: stats.intentCount,
        utterances: stats.utteranceCount,
        customIntents: stats.customCount,
      },
      timing: { trainMs, totalMs },
      modelSizeMb: Number((modelJson.length / 1024 / 1024).toFixed(2)),
      persona: { name: PERSONA.name, store: PERSONA.store },
      brain: status,
    });
  } catch (e) {
    return jsonError(502, "ai.train.failed", e instanceof Error ? e.message : "Training gagal.");
  }
}
