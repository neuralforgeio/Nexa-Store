import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api/http";
import { conversationIdForToken, updateFeature } from "@/lib/site-features/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Langganan push notification obrolan (v1.6.0).
 * Pengunjung MENYETUJUI (opt-in) lewat tombol bel di widget chat — setelah
 * itu balasan pemilik store terkirim sebagai notifikasi browser meski tab
 * sudah ditutup. POST {action:"subscribe"|"unsubscribe", token, subscription?}.
 */

const TOKEN_RE = /^[a-f0-9]{32}$/;

const subSchema = z.object({
  action: z.literal("subscribe"),
  token: z.string().regex(TOKEN_RE),
  subscription: z.object({
    endpoint: z.string().url().max(500),
    keys: z.object({
      p256dh: z.string().min(1).max(200),
      auth: z.string().min(1).max(200),
    }),
  }),
  name: z.string().trim().max(40).optional(),
});

const unsubSchema = z.object({
  action: z.literal("unsubscribe"),
  token: z.string().regex(TOKEN_RE),
});

const schema = z.discriminatedUnion("action", [subSchema, unsubSchema]);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Data langganan tidak valid.");
  }
  const conversationId = conversationIdForToken(parsed.data.token);

  try {
    if (parsed.data.action === "subscribe") {
      const { subscription, name } = parsed.data;
      await updateFeature("push-subs", "push: subscribe", (currentRaw) => {
        const subs = (currentRaw as { subs?: Record<string, unknown> })?.subs ?? {};
        return {
          subs: {
            ...subs,
            [conversationId]: {
              endpoint: subscription.endpoint,
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
              name: name?.trim() ? name.trim() : null,
              at: new Date().toISOString(),
            },
          },
        };
      });
      return jsonOk({ subscribed: true });
    }

    await updateFeature("push-subs", "push: unsubscribe", (currentRaw) => {
      const subs = { ...((currentRaw as { subs?: Record<string, unknown> })?.subs ?? {}) };
      delete subs[conversationId];
      return { subs };
    });
    return jsonOk({ subscribed: false });
  } catch {
    return jsonError(502, "push.update-failed", "Gagal menyimpan langganan. Coba lagi.");
  }
}
