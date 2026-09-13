/**
 * Chat bridge (v1.3.0) — WebSocket cepat untuk widget chat storefront.
 *
 * Server socket.io menempel pada HTTP server yang sama dengan health server.
 * Path "/socket.io" (bukan "/") supaya endpoint /health tidak terbajak.
 * Klien memakai io("/?XTransformPort=3005") — gateway meneruskan lewat query.
 */
import { createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

const TOKEN_RE = /^[a-f0-9]{32}$/;

/** Sama dengan conversationIdForToken di aplikasi — hash token, token tak pernah disimpan. */
export function conversationIdForToken(token: string): string {
  return `c_${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}

let io: Server | null = null;

export function attachChatBridge(server: HttpServer): Server {
  if (io) return io;
  io = new Server(server, {
    path: "/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60_000,
    pingInterval: 25_000,
    maxHttpBufferSize: 1e6,
  });

  io.on("connection", (socket: Socket) => {
    socket.on("chat:join", (payload: unknown) => {
      try {
        const token = (payload as { token?: unknown })?.token;
        if (typeof token !== "string" || !TOKEN_RE.test(token)) return;
        void socket.join(conversationIdForToken(token));
      } catch {
        // payload aneh — abaikan
      }
    });
  });

  return io;
}

/** Dorong pesan baru ke perangkat pengunjung yang sedang tersambung. */
export function pushToConversation(
  conversationId: string,
  message: { id: string; from: "user" | "owner"; text: string; at: string }
): void {
  if (!io) return;
  io.to(conversationId).emit("chat:message", { conversationId, message });
}

export function bridgeStats(): { attached: boolean; clients: number } {
  return { attached: io !== null, clients: io?.sockets.sockets.size ?? 0 };
}
