import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonOk, jsonError, requireCapability, getSession, enforceMutationRateLimit } from "@/lib/api/http";
import { updateFeature, readFeature } from "@/lib/site-features/store";
import { botBrainFileSchema, customIntentSchema } from "@/lib/site-features/schema";
import { invalidateBrainCache } from "@/lib/nexa-bot/engine";
import { PROTECTED_PREFIXES } from "../../../../../../nexa-corpus.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Panel AI Bot — kelola dataset kustom (v1.17.0, developer only).
 * POST   {intent, utterances, answer} → upsert satu intent kustom.
 * DELETE {intent}                      → hapus satu intent kustom.
 *
 * Dataset langsung HIDUP lewat lapisan overlay TF-IDF — tanpa perlu training.
 * Intent terlindungi (security./off./system./math) tidak boleh ditimpa.
 */

const upsertSchema = customIntentSchema;

const deleteSchema = z.object({ intent: z.string().min(2).max(60) });

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error?.issues?.[0];
    return jsonError(400, "validation", issue ? `${issue.path.join(".") || "root"} — ${issue.message}` : "Dataset tidak valid.");
  }
  const item = parsed.data;
  const intentLower = item.intent.toLowerCase();
  if (PROTECTED_PREFIXES.some((p: string) => intentLower.startsWith(p))) {
    return jsonError(400, "protected", `Intent "${intentLower}" memakai prefiks terlindungi dan tidak boleh ditimpa.`);
  }

  try {
    const result = await updateFeature("bot-brain", "bot-brain: dataset upsert", (currentRaw) => {
      const current = readCurrent(currentRaw);
      const others = current.customIntents.filter((c) => c.intent !== intentLower);
      const next = [...others, { ...item, intent: intentLower }].sort((a, b) => a.intent.localeCompare(b.intent));
      return {
        version: current.version ?? null,
        trainedAt: current.trainedAt ?? null,
        intentsCount: current.intentsCount,
        utterancesCount: current.utterancesCount,
        ...(current.modelJson ? { modelJson: current.modelJson } : {}),
        customIntents: next.slice(0, 200),
      };
    });
    invalidateBrainCache();
    return jsonOk({ saved: true, dataset: result.customIntents });
  } catch {
    return jsonError(502, "ai.dataset.write", "Dataset gagal disimpan. Coba lagi.");
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireCapability(req, "botAi.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");
  const limited = enforceMutationRateLimit(session.email);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Nama intent tidak valid.");
  }
  const target = parsed.data.intent.toLowerCase();

  try {
    const currentRaw = await readFeature("bot-brain");
    const current = readCurrent(currentRaw);
    if (!current.customIntents.some((c) => c.intent === target)) {
      return jsonError(404, "not-found", `Intent "${target}" tidak ada di dataset.`);
    }
    const result = await updateFeature("bot-brain", "bot-brain: dataset delete", (raw) => {
      const cur = readCurrent(raw);
      return {
        version: cur.version ?? null,
        trainedAt: cur.trainedAt ?? null,
        intentsCount: cur.intentsCount,
        utterancesCount: cur.utterancesCount,
        ...(cur.modelJson ? { modelJson: cur.modelJson } : {}),
        customIntents: cur.customIntents.filter((c) => c.intent !== target),
      };
    });
    invalidateBrainCache();
    return jsonOk({ deleted: true, dataset: result.customIntents });
  } catch {
    return jsonError(502, "ai.dataset.write", "Dataset gagal diperbarui. Coba lagi.");
  }
}
