import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonOk, jsonError, requireCapability } from "@/lib/api/http";
import { nexaBotAnswer } from "@/lib/nexa-bot/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Panel AI Bot — konsol uji (v1.17.0, developer only).
 * POST { text, userName? } → jalankan pipeline penuh bot (otak aktif saat
 * ini: overlay kustom + model kustom/bundled) dan kembalikan intent/skor/
 * jawaban — persis yang akan diterima pengunjung.
 */

const testSchema = z.object({
  text: z.string().trim().min(1).max(800),
  userName: z.string().trim().max(40).optional(),
});

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "botAi.manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Teks uji tidak valid (1-800 karakter).");
  }
  try {
    const reply = await nexaBotAnswer(parsed.data.text, { userName: parsed.data.userName ?? null });
    return jsonOk({ text: parsed.data.text, intent: reply.intent, score: reply.score, answer: reply.answer });
  } catch {
    return jsonError(502, "ai.test.failed", "Engine bot gagal menjawab. Coba lagi.");
  }
}
