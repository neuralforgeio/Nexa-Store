/**
 * Endpoint internal (v1.3.0) — dipanggil oleh aplikasi sandbox untuk:
 *   POST /internal/chat-notify     → pesan baru dari pengunjung (instant ping)
 *   POST /internal/chat-owner-reply → pemilik membalas dari panel dev (dorong WS)
 *
 * Dilindungi header rahasia bersama (BOT_INTERNAL_SECRET). Tanpa env itu,
 * endpoint membalas 404 — sama halnya dengan /api/bot-service di produksi.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config";
import { rememberChatOrigin } from "./state";
import { pushToConversation } from "./chat-bridge";
import { notifyOwner } from "./owner";
import { chatNotifyKeyboard, chatNotifyText } from "./ui";

const MAX_BODY = 100_000;

type ChatNotifyBody = {
  conversationId: string;
  name: string | null;
  text: string;
  messageCount: number;
  origin: "local" | string;
};

type OwnerReplyBody = {
  conversationId: string;
  text: string;
  message?: { id: string; from: "user" | "owner"; text: string; at: string };
  origin: "local" | string;
};

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body terlalu besar"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleInternal(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!config.internalSecret) {
    send(res, 404, { ok: false });
    return;
  }
  const auth = req.headers["x-nexa-internal"];
  if (auth !== config.internalSecret) {
    send(res, 404, { ok: false });
    return;
  }
  const url = req.url ?? "";
  if (req.method !== "POST" || !url.startsWith("/internal/")) {
    send(res, 404, { ok: false });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;

    if (url === "/internal/chat-notify") {
      const payload = body as unknown as ChatNotifyBody;
      if (payload?.origin === "local" && payload.conversationId) {
        rememberChatOrigin(payload.conversationId, "local");
      }
      await notifyOwner(
        chatNotifyText(payload.name ?? null, payload.text ?? "", payload.origin === "local"),
        chatNotifyKeyboard(payload.conversationId)
      );
      send(res, 200, { ok: true });
      return;
    }

    if (url === "/internal/chat-owner-reply") {
      const payload = body as unknown as OwnerReplyBody;
      if (payload?.conversationId && payload.message) {
        pushToConversation(payload.conversationId, payload.message);
      }
      send(res, 200, { ok: true });
      return;
    }

    send(res, 404, { ok: false });
  } catch (e) {
    send(res, 400, { ok: false, error: (e as Error).message });
  }
}
