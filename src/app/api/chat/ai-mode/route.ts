import { NextRequest, after } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, clientIp } from "@/lib/api/http";
import { readFeature, updateFeature } from "@/lib/site-features/store";
import { sendOwnerChatModeNotification } from "@/lib/telegram-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Saklar mode AI obrolan (v1.15.0) — dipakai tombol di widget chat.
 *
 * POST {enabled: boolean} → ubah nexaBot.autoReply di data store bot-state.
 * ON  → Nexa Bot menjawab instan.
 * OFF → hanya admin/developer yang menjawab (balasan lewat Telegram).
 *
 * Sengaja publik (permintaan pemilik): pengunjung boleh mematikan AI agar
 * dijawab manusia, dan menyalakannya kembali — dibatasi rate per-IP supaya
 * tidak dimainkan bolak-balik.
 */

const schema = z.object({ enabled: z.boolean() });

const WINDOW_MS = 5 * 60_000;
const MAX_TOGGLE = 10;
const buckets = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_TOGGLE) return false;
  hits.push(now);
  buckets.set(ip, hits);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

export async function GET() {
  const botState = (await readFeature("bot-state")) as { nexaBot?: { autoReply?: boolean } } | null;
  const aiAutoReply = botState?.nexaBot?.autoReply !== false;
  return jsonOk({ aiAutoReply });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Nilai saklar AI tidak valid.");
  }
  if (!allowed(clientIp(req))) {
    return jsonError(429, "rate-limited", "Terlalu sering mengganti mode. Tunggu sebentar.");
  }

  try {
    await updateFeature("bot-state", "ops: chat ai mode toggle", (currentRaw) => {
      const current = (typeof currentRaw === "object" && currentRaw !== null ? currentRaw : {}) as {
        nexaBot?: { autoReply?: boolean };
      };
      return { ...current, nexaBot: { ...(current.nexaBot ?? {}), autoReply: parsed.data.enabled } };
    });
  } catch {
    return jsonError(502, "chat.ai-mode-failed", "Gagal mengubah mode AI. Coba lagi.");
  }

  // Notifikasi pemilik saat pengunjung mematikan AI — admin perlu tahu bahwa
  // obrolan berikutnya menunggu jawaban manusia.
  if (!parsed.data.enabled) {
    after(() => sendOwnerChatModeNotification(false));
  }

  return jsonOk({ aiAutoReply: parsed.data.enabled });
}
