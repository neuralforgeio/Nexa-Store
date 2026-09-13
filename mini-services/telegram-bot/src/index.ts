/**
 * Nexa Store Telegram Bot — entry point.
 * Long polling getUpdates (urut, satu per satu) + health server di :3005
 * + jembatan WebSocket chat + scheduler tugas terjadwal + watcher obrolan.
 */
import { createServer } from "node:http";
import { config, assertConfigured } from "./config";
import * as tg from "./telegram";
import { handleUpdate } from "./handlers";
import { isPaired } from "./state";
import { attachChatBridge, bridgeStats } from "./chat-bridge";
import { handleInternal } from "./internal";
import { startScheduler } from "./scheduler";
import { startChatWatcher } from "./chat-watcher";

const startedAt = Date.now();
let lastUpdateAt: number | null = null;
let pollErrors = 0;

/**
 * Guard generasi untuk `bun --hot`: re-eval modul menaikkan generasi dan
 * loop lama (poll) berhenti sendiri — tidak pernah ada dua getUpdates
 * bersamaan (Telegram 409).
 */
const gen: { __nexaPollGen?: number } = globalThis as { __nexaPollGen?: number };
gen.__nexaPollGen = (gen.__nexaPollGen ?? 0) + 1;
const myGen = gen.__nexaPollGen;

function stale(): boolean {
  return gen.__nexaPollGen !== myGen;
}

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------
// Health + internal server — kehadiran bot bisa dipantau dari panel/gateway;
// endpoint /internal/* hanya untuk aplikasi sandbox (rahasia bersama).
// ---------------------------------------------------------------------------

function startHttpServer(): void {
  const server = createServer((req, res) => {
    if (stale()) return; // generasi lama tidak melayani lagi
    const url = req.url ?? "/";
    if (url === "/health" || url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "nexastore-telegram-bot",
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          paired: isPaired(),
          lastUpdateAt,
          pollErrors,
          target: config.apiBase,
          chatBridge: bridgeStats(),
        })
      );
      return;
    }
    if (url.startsWith("/internal/")) {
      void handleInternal(req, res).catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });

  attachChatBridge(server);

  server.listen(config.port, () => {
    log(`health + chat bridge aktif di :${config.port}`);
  });
  // Tutup listener generasi lama bila ada (hot reload).
  const g = globalThis as { __nexaBotHttpServer?: ReturnType<typeof createServer> };
  if (g.__nexaBotHttpServer && g.__nexaBotHttpServer !== server) {
    try {
      g.__nexaBotHttpServer.close();
      log("listener generasi lama ditutup");
    } catch {
      // abaikan
    }
  }
  g.__nexaBotHttpServer = server;
}

// ---------------------------------------------------------------------------
// Long polling
// ---------------------------------------------------------------------------

async function pollLoop(): Promise<void> {
  let offset = 0;
  log("polling dimulai…");
  for (;;) {
    if (stale()) {
      log("poll loop generasi lama berhenti (hot reload)");
      return;
    }
    try {
      const updates = await tg.getUpdates(offset, 25);
      if (stale()) return;
      pollErrors = 0;
      for (const update of updates) {
        offset = update.update_id + 1;
        lastUpdateAt = Date.now();
        // Diproses berurutan agar state percakapan tidak balapan.
        await handleUpdate(update);
      }
    } catch (e) {
      if (stale()) return;
      pollErrors += 1;
      const msg = (e as Error).message;
      const wait = /409|Conflict/i.test(msg) ? 10_000 : Math.min(30_000, 3000 * pollErrors);
      log(`poll error (${pollErrors}x): ${msg} — jeda ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertConfigured();
  const me = await tg.getMe();
  log(`bot aktif: @${me.username} (id ${me.id})`);
  log(`target API: ${config.apiBase}`);
  log(`pairing: ${isPaired() ? "sudah terhubung" : "menunggu kode pairing"}`);
  startHttpServer();
  startScheduler();
  startChatWatcher();
  await pollLoop();
}

if (import.meta.main) {
  main().catch((e) => {
    log("FATAL:", (e as Error).message);
    process.exit(1);
  });
}

export { handleUpdate };
