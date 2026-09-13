/**
 * Nexa Store Telegram Bot — entry point.
 * Long polling getUpdates (urut, satu per satu) + health server di :3005.
 */
import { createServer } from "node:http";
import { config, assertConfigured } from "./config";
import * as tg from "./telegram";
import { handleUpdate } from "./handlers";
import { isPaired } from "./state";

const startedAt = Date.now();
let lastUpdateAt: number | null = null;
let pollErrors = 0;

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------
// Health server — supaya kehadiran bot bisa dipantau dari panel/gateway.
// ---------------------------------------------------------------------------

function startHealthServer(): void {
  const server = createServer((req, res) => {
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
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  server.listen(config.port, () => {
    log(`health server aktif di :${config.port}`);
  });
}

// ---------------------------------------------------------------------------
// Long polling
// ---------------------------------------------------------------------------

async function pollLoop(): Promise<void> {
  let offset = 0;
  log("polling dimulai…");
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset, 25);
      pollErrors = 0;
      for (const update of updates) {
        offset = update.update_id + 1;
        lastUpdateAt = Date.now();
        // Diproses berurutan agar state percakapan tidak balapan.
        await handleUpdate(update);
      }
    } catch (e) {
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
  startHealthServer();
  await pollLoop();
}

if (import.meta.main) {
  main().catch((e) => {
    log("FATAL:", (e as Error).message);
    process.exit(1);
  });
}

export { handleUpdate };
