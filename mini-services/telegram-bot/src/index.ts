/**
 * Nexa Store Telegram Bot — entry point.
 * Long polling getUpdates (urut, satu per satu) + health server di :3005
 * + jembatan WebSocket chat + scheduler tugas terjadwal + watcher obrolan.
 *
 * v1.4.0: menu perintah "/" didaftarkan otomatis; bila webhook Vercel aktif,
 * poller masuk mode standby (cek tiap 60 dtk) dan otomatis mengambil alih
 * kembali begitu webhook dilepas — dua runtime, satu bot, tanpa konflik 409.
 */
import { createServer } from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { config, assertConfigured, webhookUrl } from "./config";
import * as tg from "./telegram";
import { BOT_COMMANDS } from "./commands";
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
  if (config.headless) {
    log("mode headless — tanpa server HTTP/WS (polling Telegram + scheduler + watcher tetap aktif)");
    return;
  }
  const g = globalThis as { __nexaBotHttpServer?: ReturnType<typeof createServer> };

  const boot = (): void => {
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
    server.on("error", (e) => log(`http server error: ${(e as Error).message}`));
    server.listen(config.port, () => {
      log(`health + chat bridge aktif di :${config.port}`);
    });
    g.__nexaBotHttpServer = server;
  };

  // Hot reload: tutup dulu listener generasi lama sampai benar-benar lepas,
  // BARU bind yang baru — bind bareng port lama bikin EADDRINUSE senyap.
  const old = g.__nexaBotHttpServer;
  if (old && typeof old.close === "function") {
    let booted = false;
    try {
      old.close(() => {
        booted = true;
        if (!stale()) boot();
      });
      log("listener generasi lama ditutup");
    } catch {
      // abaikan — lanjut boot
    }
    // close() tanpa koneksi aktif memanggil callback-nya sinkron; bila 2 dtk
    // juga belum (koneksi keep-alive nyangkut), boot paksa agar port tetap hidup.
    setTimeout(() => {
      if (!booted && !stale()) {
        log("listener lama lambat dilepas — bind paksa");
        boot();
      }
    }, 2000);
  } else {
    boot();
  }
}

// ---------------------------------------------------------------------------
// Long polling + standby webhook
// ---------------------------------------------------------------------------

/**
 * Mode standby: webhook aktif di Vercel → poller berhenti mengambil update,
 * tapi tetap hidup dan memeriksa tiap 60 detik. Begitu webhook dilepas
 * (perintah "kembali ke panel"), polling dilanjutkan otomatis.
 */
async function standby(url: string): Promise<void> {
  let current = url;
  for (;;) {
    await new Promise((r) => setTimeout(r, 60_000));
    if (stale()) return;
    const info = await tg.getWebhookInfo().catch(() => null);
    if (!info) continue;
    if (!info.url) {
      log("webhook dilepas — polling dilanjutkan");
      return;
    }
    if (info.url !== current) {
      log(`webhook berpindah (${info.url}) — tetap standby`);
      current = info.url;
    }
  }
}

async function pollLoop(): Promise<void> {
  let offset = 0;
  // Bila webhook sedang aktif, jangan menyentuh getUpdates — langsung standby.
  const initial = await tg.getWebhookInfo().catch(() => null);
  if (initial?.url) {
    log(`webhook aktif (${initial.url}) — poller standby`);
    await standby(initial.url);
  }
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
      const msg = (e as Error).message;
      // Webhook aktif = runtime Vercel yang bekerja → bukan error, pindah standby.
      if (/409|Conflict|webhook/i.test(msg)) {
        const info = await tg.getWebhookInfo().catch(() => null);
        if (info?.url) {
          log(`webhook aktif (${info.url}) — poller standby`);
          await standby(info.url);
          continue;
        }
      }
      pollErrors += 1;
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
  log(`webhook target: ${webhookUrl()}`);
  // Menu perintah — mengetik "/" memunculkan seluruh pilihan berdeskripsi.
  const registered = await tg.setMyCommands(BOT_COMMANDS).then(
    () => true,
    (e) => {
      log(`setMyCommands gagal: ${(e as Error).message}`);
      return false;
    }
  );
  if (registered) log(`menu perintah terdaftar (${BOT_COMMANDS.length} perintah)`);
  // PID file — launcher aplikasi memakai ini untuk menghindari dobel proses.
  try {
    writeFileSync(new URL("../.bot.pid", import.meta.url).pathname, `${process.pid}\n`, "utf8");
  } catch {
    // non-fatal
  }
  startHttpServer();
  startScheduler();
  startChatWatcher();
  await pollLoop();
}

if (import.meta.main) {
  main().catch((e) => {
    log("FATAL:", (e as Error).message);
    try {
      unlinkSync(new URL("../.bot.pid", import.meta.url).pathname);
    } catch {
      // abaikan
    }
    process.exit(1);
  });
}

export { handleUpdate };
