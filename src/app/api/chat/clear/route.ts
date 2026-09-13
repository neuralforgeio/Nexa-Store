import { NextRequest } from "next/server";
import { z } from "zod";
import { clientIp, jsonError, jsonOk } from "@/lib/api/http";
import { updateFeature, conversationIdForToken } from "@/lib/site-features/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Bersihkan obrolan milik pengunjung sendiri (v1.6.0).
 * Hanya menghapus PERCAKAPAN pemanggil — identitas (token) menentukan
 * percakapan mana yang boleh dihapus, tidak ada parameter id.
 */

const TOKEN_RE = /^[a-f0-9]{32}$/;
const schema = z.object({ token: z.string().regex(TOKEN_RE) });

const buckets = new Map<string, number[]>();
function clearAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 6) return false;
  hits.push(now);
  buckets.set(ip, hits);
  return true;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!clearAllowed(ip)) {
    return jsonError(429, "rate-limited", "Terlalu sering. Tunggu sebentar.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Token tidak valid.");
  }
  const conversationId = conversationIdForToken(parsed.data.token);

  try {
    await updateFeature("chat", "chat: visitor cleared", (currentRaw) => {
      const conversations = Array.isArray((currentRaw as { conversations?: unknown[] })?.conversations)
        ? (currentRaw as { conversations: unknown[] }).conversations
        : [];
      return { conversations: conversations.filter((c) => (c as { id?: string }).id !== conversationId) };
    });
  } catch {
    return jsonError(502, "chat.clear-failed", "Gagal membersihkan obrolan. Coba lagi.");
  }

  return jsonOk({ cleared: true });
}
