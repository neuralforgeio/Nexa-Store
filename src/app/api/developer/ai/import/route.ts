import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonOk, jsonError, requireCapability, getSession, enforceMutationRateLimit } from "@/lib/api/http";
import { updateFeature } from "@/lib/site-features/store";
import { botBrainFileSchema } from "@/lib/site-features/schema";
import { invalidateBrainCache } from "@/lib/nexa-bot/engine";
import { normalizeImportItems, validateCustomIntent, PROTECTED_PREFIXES } from "../../../../../../nexa-corpus.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Panel AI Bot — impor dataset massal (v1.17.0, developer only).
 * POST { items: [...], mode: "merge" | "replace" }
 *
 * Dua format item diterima:
 *  1. Lengkap  : { intent, utterances: ["…"], answer: "…" }
 *  2. Sederhana: { q: "pertanyaan", a: "jawaban" } → intent otomatis fa.auto-N
 *
 * mode "merge"   → digabung dengan dataset lama (intent bernama sama menimpa).
 * mode "replace" → dataset lama diganti seluruhnya.
 * Maks 200 intent; jawaban boleh memakai placeholder {name} (nama pengguna).
 */

const importSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).max(500),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

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
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error?.issues?.[0];
    return jsonError(400, "validation", issue ? `${issue.path.join(".") || "root"} — ${issue.message}` : "Data impor tidak valid.");
  }
  const { mode } = parsed.data;

  // Normalisasi bentuk sederhana {q,a} → bentuk lengkap, lalu validasi ketat.
  const candidates = normalizeImportItems(parsed.data.items);
  if (candidates.length === 0) {
    return jsonError(400, "import.empty", "Tidak ada item yang bisa dibaca. Periksa format JSON-nya.");
  }
  const errors: string[] = [];
  type NormalizedIntent = { intent: string; utterances: string[]; answer: string };
  const valid: NormalizedIntent[] = [];
  for (const [i, item] of candidates.entries()) {
    const err = validateCustomIntent(item, i + 1);
    if (err) {
      errors.push(err);
      continue;
    }
    if (PROTECTED_PREFIXES.some((p: string) => item.intent.startsWith(p))) {
      errors.push(`item ke-${i + 1}: intent "${item.intent}" memakai prefiks terlindungi`);
      continue;
    }
    valid.push(item);
  }
  if (valid.length === 0) {
    return jsonError(400, "import.invalid", `Semua item ditolak:\n${errors.slice(0, 5).join("\n")}`);
  }

  try {
    const result = await updateFeature("bot-brain", "bot-brain: dataset import", (currentRaw) => {
      const current = readCurrent(currentRaw);
      const base = mode === "replace" ? [] : [...current.customIntents];
      const byIntent = new Map<string, NormalizedIntent>(base.map((c) => [c.intent, c]));
      for (const item of valid) {
        byIntent.set(item.intent, { ...item, intent: item.intent.toLowerCase() });
      }
      const next = [...byIntent.values()].sort((a, b) => a.intent.localeCompare(b.intent)).slice(0, 200);
      return {
        version: current.version ?? null,
        trainedAt: current.trainedAt ?? null,
        intentsCount: current.intentsCount,
        utterancesCount: current.utterancesCount,
        ...(current.modelJson ? { modelJson: current.modelJson } : {}),
        customIntents: next,
      };
    });
    invalidateBrainCache();
    return jsonOk({
      imported: valid.length,
      rejected: errors.length,
      errors: errors.slice(0, 10),
      datasetSize: result.customIntents.length,
      dataset: result.customIntents,
    });
  } catch {
    return jsonError(502, "ai.import.write", "Impor gagal disimpan. Coba lagi.");
  }
}
