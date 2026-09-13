/**
 * Router update Telegram → alur percakapan → eksekusi aksi.
 * Hanya owner (user id yang sudah pairing) yang diproses.
 */
import { config, webhookUrl, routeIdFromCode } from "./config";
import * as tg from "./telegram";
import * as ui from "./ui";
import * as nexa from "./nexa";
import type { GameRecord, ProductRecord } from "./nexa";
import * as vercel from "./vercel";
import * as git from "./gitops";
import { COMMAND_TO_ROOT } from "./commands";
import {
  clearFlow,
  getSession,
  isPaired,
  ownerId,
  pairOwner,
  pairingBlocked,
  recordWrongPairing,
  chatOrigin,
  type Session,
} from "./state";

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

/**
 * Parse waktu WIB ke depan: "+6" (jam dari sekarang), "21:00" (jam berikutnya),
 * atau "2026-03-01 21:00" / "2026-03-01T21:00". Mengembalikan ISO + label.
 */
function parseFutureWib(input: string): { iso: string; label: string } | null {
  const t = input.trim().replace(/^\s*(?:pada|jam|pukul)\s+/i, "").toLowerCase();
  const now = Date.now();

  // +N (jam dari sekarang)
  const rel = /^\+\s*(\d+(?:[.,]\d+)?)\s*(?:j|jam|h)?$/.exec(t);
  if (rel) {
    const hours = Number.parseFloat(rel[1].replace(",", "."));
    if (hours > 0 && hours <= 24 * 90) {
      const iso = new Date(now + hours * 3600_000).toISOString();
      return { iso, label: fmtWibLabel(iso) };
    }
    return null;
  }

  // HH:MM — jam WIB berikutnya (hari ini, atau besok bila sudah lewat)
  const hm = /^(\d{1,2})[:.](\d{2})$/.exec(t);
  if (hm) {
    const h = Number.parseInt(hm[1], 10);
    const m = Number.parseInt(hm[2], 10);
    if (h > 23 || m > 59) return null;
    const wib = new Date(now + 7 * 3600_000);
    const target = new Date(wib);
    target.setUTCHours(h, m, 0, 0);
    if (target.getTime() <= wib.getTime()) target.setUTCDate(target.getUTCDate() + 1);
    const iso = new Date(target.getTime() - 7 * 3600_000).toISOString();
    return { iso, label: fmtWibLabel(iso) };
  }

  // YYYY-MM-DD HH:MM (atau dengan T)
  const full = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2})[:.](\d{2})$/.exec(t);
  if (full) {
    const [, y, mo, d, h, mi] = full;
    const wib = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
    if (Number.isNaN(wib.getTime())) return null;
    const iso = new Date(wib.getTime() - 7 * 3600_000).toISOString();
    if (wib.getTime() <= now) return null;
    return { iso, label: fmtWibLabel(iso) };
  }

  return null;
}

function fmtWibLabel(iso: string): string {
  const t = new Date(Date.parse(iso) + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} WIB`;
}

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  if (!Number.isFinite(value) || value < 0 || value > 9_999_999_999) return null;
  return value;
}

function fieldKeyFromLabel(label: string): string {
  // camelCase seperti konvensi seed: riotId, playerId, serverId.
  const words = label
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "field";
  const key = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  return /^[a-z]/.test(key) ? key : `f${key}`;
}

async function sendMenu(chatId: number): Promise<void> {
  const version = await git.fetchAppVersion().catch(() => null);
  await tg.sendMessage(chatId, ui.mainMenuText(undefined, version), ui.mainMenuKeyboard());
}

async function withSyncNote(): Promise<string | null> {
  // Runtime webhook Vercel tidak punya repo lokal — sinkronisasi tidak relevan.
  if (process.env.VERCEL) return null;
  const res = await git.syncSandbox();
  return res.ok ? `tersinkron (${res.detail})` : `gagal sinkron — ${res.detail}`;
}

function backHome(): tg.InlineKeyboard {
  return [[{ text: "⬅️ Menu", callback_data: "menu" }]];
}

/**
 * Dispatch menu akar untuk perintah teks (/lockdown, /promo, …).
 * Isi sama dengan tombol — dikirim sebagai pesan baru (tak ada tombol untuk diedit).
 */
async function dispatchRoot(chatId: number, s: Session, data: string): Promise<void> {
  const send = (text: string, keyboard?: tg.InlineKeyboard): Promise<void> =>
    tg.sendMessage(chatId, text, keyboard).then(() => undefined);
  switch (data) {
    case "lk":
    case "mt": {
      const gate = data === "lk" ? "lockdown" : "maintenance";
      clearFlow(s);
      const access = await nexa.getAccess();
      const g = gate === "lockdown" ? access.lockdown : access.maintenance;
      await send(ui.gateMenuText(gate, g), ui.gateMenuKeyboard(gate, g.active));
      return;
    }
    case "adm": {
      clearFlow(s);
      const access = await nexa.getAccess();
      await send(ui.adminMenuText(access), ui.adminMenuKeyboard(access.adminBlocked));
      return;
    }
    case "cat": {
      clearFlow(s);
      const catalog = await nexa.getCatalog();
      await send(ui.catalogMenuText(catalog), ui.catalogMenuKeyboard());
      return;
    }
    case "set": {
      clearFlow(s);
      const { settings } = await nexa.getSettings();
      await send(ui.settingsMenuText(settings), ui.settingsMenuKeyboard());
      return;
    }
    case "dep": {
      clearFlow(s);
      const latest = await vercel.latestProductionDeployment().catch(() => null);
      await send(ui.deploymentMenuText(latest), ui.deploymentMenuKeyboard());
      return;
    }
    case "cht": {
      clearFlow(s);
      const conversations = await nexa.getChatConversations().catch(() => []);
      const local = await nexa.getChatConversations(config.localBase).catch(() => []);
      const all = [...local.map((c) => ({ ...c, id: c.id })), ...conversations];
      s.lists.conversations = all;
      await send(ui.chatMenuText(all), ui.chatMenuKeyboard(all.length));
      return;
    }
    case "prm": {
      clearFlow(s);
      const [promos, catalog] = await Promise.all([
        nexa.getPromos().catch(() => []),
        nexa.getCatalog().catch(() => null),
      ]);
      const gameNames = new Map((catalog?.games ?? []).map((g) => [g.id, g.name]));
      s.lists.promos = promos;
      await send(ui.promoMenuText(promos, gameNames), ui.promoMenuKeyboard(promos.length));
      return;
    }
    case "bnr": {
      clearFlow(s);
      const banners = await nexa.getBanners().catch(() => []);
      s.lists.banners = banners;
      await send(ui.bannerMenuText(banners), ui.bannerMenuKeyboard(banners.length));
      return;
    }
    case "stx": {
      clearFlow(s);
      const summary = await nexa.getAnalyticsSummary().catch(() => null);
      if (!summary) {
        await send("📊 Analitik tidak dapat dibaca. Coba beberapa saat lagi.", backHome());
        return;
      }
      await send(ui.analyticsText(summary), ui.analyticsKeyboard());
      return;
    }
    case "tsk": {
      clearFlow(s);
      const tasks = await nexa.getSchedules().catch(() => []);
      s.lists.tasks = tasks;
      const pending = tasks.filter((t) => t.status === "pending");
      await send(ui.taskMenuText(tasks), ui.taskMenuKeyboard(pending.length, tasks.length));
      return;
    }
    case "rt": {
      clearFlow(s);
      const info = await tg.getWebhookInfo().catch(() => null);
      await send(
        ui.runtimeMenuText({
          webhookUrl: info?.url ?? null,
          pendingUpdates: info?.pending_update_count ?? null,
          lastError: info?.last_error_message ?? null,
        }),
        ui.runtimeMenuKeyboard(Boolean(info?.url))
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point — dipanggil oleh poller (dan simulator pengujian).
// ---------------------------------------------------------------------------

export async function handleUpdate(update: tg.TelegramUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      await onCallback(update.callback_query);
      return;
    }
    if (update.message) {
      await onMessage(update.message);
      return;
    }
  } catch (e) {
    log("ERROR handleUpdate:", (e as Error).message);
    // Usahakan kabari owner kalau pesan tidak bisa dikirim (mis. chat simulasi).
    const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chat && ownerId()) {
      await tg.sendMessage(chat, `⚠️ Terjadi kesalahan: <code>${tg.esc((e as Error).message)}</code>`).catch(() => undefined);
    }
  }
}

async function onCallback(q: NonNullable<tg.TelegramUpdate["callback_query"]>): Promise<void> {
  const userId = q.from.id;
  const chatId = q.message?.chat.id;
  const messageId = q.message?.message_id;
  if (!chatId || !messageId) {
    await tg.answerCallbackQuery(q.id).catch(() => undefined);
    return;
  }
  if (!isPaired() || userId !== ownerId()) {
    await tg.answerCallbackQuery(q.id, "⛔").catch(() => undefined);
    return;
  }
  const s = getSession(chatId);
  const data = q.data ?? "";

  const edit = (text: string, keyboard?: tg.InlineKeyboard): Promise<void> =>
    tg.editMessageText(chatId, messageId, text, keyboard).then(() => undefined);
  const send = (text: string, keyboard?: tg.InlineKeyboard): Promise<void> =>
    tg.sendMessage(chatId, text, keyboard).then(() => undefined);
  const ok = (note?: string): Promise<void> => tg.answerCallbackQuery(q.id, note).then(() => undefined);

  try {
    switch (true) {
      // ----- navigasi utama -----
      case data === "menu": {
        clearFlow(s);
        const version = await git.fetchAppVersion().catch(() => null);
        await edit(ui.mainMenuText(q.from.first_name, version), ui.mainMenuKeyboard());
        return;
      }
      case data === "status": {
        clearFlow(s);
        await ok("Memuat…");
        await edit(...(await buildStatus()));
        return;
      }

      // ----- lockdown / maintenance -----
      case data === "lk" || data === "mt": {
        clearFlow(s);
        const gate = data === "lk" ? "lockdown" : "maintenance";
        const access = await nexa.getAccess();
        await edit(ui.gateMenuText(gate, gate === "lockdown" ? access.lockdown : access.maintenance), ui.gateMenuKeyboard(gate, (gate === "lockdown" ? access.lockdown : access.maintenance).active));
        return;
      }
      case data === "lk:on:all" || data === "mt:on:all": {
        const gate = data.startsWith("lk") ? "lockdown" : "maintenance";
        clearFlow(s);
        s.gate = gate;
        s.stage = "input";
        s.input = gate === "lockdown" ? "lockdown-reason" : "maintenance-reason";
        await send(ui.inputPromptText(s.input));
        return;
      }
      case data === "lk:on:rt" || data === "mt:on:rt": {
        const gate = data.startsWith("lk") ? "lockdown" : "maintenance";
        clearFlow(s);
        s.gate = gate;
        s.stage = "routes";
        s.routes = [];
        await edit(ui.routePickerText(gate), ui.routePickerKeyboard(s.routes));
        return;
      }
      case data === "lk:off" || data === "mt:off": {
        const gate = data.startsWith("lk") ? "lockdown" : "maintenance";
        clearFlow(s);
        s.stage = "confirm";
        s.pending = { type: "gate-off", gate };
        await edit(ui.gateOffConfirmText(gate), ui.confirmKeyboard(gate === "lockdown" ? "🟢 Ya, angkat lockdown" : "🟢 Ya, akhiri perbaikan"));
        return;
      }
      case data.startsWith("rt:") && data !== "rt:next": {
        const code = data.slice(3);
        const routeId = routeIdFromCode(code);
        if (routeId && s.stage === "routes") {
          s.routes = s.routes.includes(routeId) ? s.routes.filter((r) => r !== routeId) : [...s.routes, routeId];
          await edit(ui.routePickerText(s.gate ?? "lockdown"), ui.routePickerKeyboard(s.routes));
        }
        await ok();
        return;
      }
      case data === "rt:next": {
        if (s.stage !== "routes") return void (await ok());
        if (s.routes.length === 0) {
          await ok("Pilih minimal satu rute dulu.");
          return;
        }
        s.stage = "input";
        s.input = s.gate === "lockdown" ? "lockdown-reason" : "maintenance-reason";
        await send(ui.inputPromptText(s.input));
        return;
      }

      // ----- admin -----
      case data === "adm": {
        clearFlow(s);
        const access = await nexa.getAccess();
        await edit(ui.adminMenuText(access), ui.adminMenuKeyboard(access.adminBlocked));
        return;
      }
      case data === "adm:ban": {
        clearFlow(s);
        s.stage = "input";
        s.input = "ban-reason";
        await send(ui.inputPromptText("ban-reason"));
        return;
      }
      case data === "adm:unban": {
        clearFlow(s);
        s.stage = "confirm";
        s.pending = { type: "unban" };
        await edit("✅ <b>KONFIRMASI BUKA BLOKIR</b>\n\nAdmin akan bisa login dan mengelola dashboard kembali.", ui.confirmKeyboard("✅ Ya, buka blokir"));
        return;
      }

      // ----- katalog -----
      case data === "cat": {
        clearFlow(s);
        const catalog = await nexa.getCatalog();
        await edit(ui.catalogMenuText(catalog), ui.catalogMenuKeyboard());
        return;
      }
      case data === "cat:game": {
        clearFlow(s);
        const catalog = await nexa.getCatalog();
        await edit(ui.gamesMenuText(catalog.games, catalog.products), ui.gamesMenuKeyboard());
        return;
      }
      case data === "cat:game:add": {
        clearFlow(s);
        s.stage = "input";
        s.input = "game-name";
        await send(ui.inputPromptText("game-name"));
        return;
      }
      case data === "cat:game:tog": {
        clearFlow(s);
        const catalog = await nexa.getCatalog();
        s.lists.games = catalog.games;
        s.pickFor = "toggle-game";
        await edit(ui.gamePickerText("mengaktifkan / menonaktifkan game"), ui.gamePickerKeyboard(catalog.games));
        return;
      }
      case data === "cat:cat": {
        clearFlow(s);
        const catalog = await nexa.getCatalog();
        await edit(ui.categoriesMenuText(catalog), ui.categoriesMenuKeyboard());
        return;
      }
      case data === "cat:cat:add": {
        clearFlow(s);
        s.stage = "input";
        s.input = "category-name";
        await send(ui.inputPromptText("category-name"));
        return;
      }
      case data === "cat:prod": {
        clearFlow(s);
        await edit(ui.productsMenuText(), ui.productsMenuKeyboard());
        return;
      }
      case data === "cat:prod:add" || data === "cat:prod:price" || data === "cat:prod:tog": {
        clearFlow(s);
        const catalog = await nexa.getCatalog();
        s.lists.games = catalog.games;
        s.pickFor = data === "cat:prod:add" ? "add-product" : data === "cat:prod:price" ? "price" : "toggle-product";
        const purpose =
          s.pickFor === "add-product" ? "menambah produk" : s.pickFor === "price" ? "mengubah harga produk" : "mengaktifkan / menonaktifkan produk";
        await edit(ui.gamePickerText(purpose), ui.gamePickerKeyboard(catalog.games));
        return;
      }
      case data.startsWith("pick:g:"): {
        const gameId = data.slice(7);
        const game = (s.lists.games ?? []).find((g) => g.id === gameId);
        if (!game) return void (await ok("Game tidak ditemukan."));
        if (s.pickFor === "promo-game") {
          s.promoDraft.gameId = game.id;
          s.input = "promo-duration";
          await edit(`Game promo: <b>${tg.esc(game.name)}</b>\n\n` + ui.inputPromptText("promo-duration"));
          return;
        }
        if (s.pickFor === "toggle-game") {
          s.stage = "confirm";
          s.pending = { type: "game-toggle", gameId };
          await edit(ui.toggleConfirmText(`Game ${game.name}`, !game.enabled), ui.confirmKeyboard());
          return;
        }
        if (s.pickFor === "add-product") {
          s.gameDraft = { gameId: game.id };
          s.stage = "input";
          s.input = "product-name";
          await send(`Game terpilih: <b>${tg.esc(game.name)}</b>\n\n` + ui.inputPromptText("product-name"));
          return;
        }
        // price / toggle-product → pilih produk dari game ini
        const catalog = await nexa.getCatalog();
        const products = catalog.products.filter((p) => p.gameId === gameId);
        s.lists.products = products;
        await edit(
          ui.productPickerText(game.name, products, s.pickFor === "price" ? "ubah harga" : "aktif / nonaktif"),
          ui.productPickerKeyboard(products)
        );
        return;
      }
      case data.startsWith("pick:p:"): {
        const productId = data.slice(7);
        const product = (s.lists.products ?? []).find((p) => p.id === productId);
        if (!product) return void (await ok("Produk tidak ditemukan."));
        if (s.pickFor === "price") {
          s.gameDraft.productId = product.id;
          s.stage = "input";
          s.input = "price-new";
          await send(ui.priceNewPrompt(product));
          return;
        }
        s.stage = "confirm";
        s.pending = { type: "product-toggle", productId };
        await edit(ui.toggleConfirmText(`${product.name} — ${product.denomination}`, !product.enabled), ui.confirmKeyboard());
        return;
      }

      // ----- setelan -----
      case data === "set": {
        clearFlow(s);
        const { settings } = await nexa.getSettings();
        await edit(ui.settingsMenuText(settings), ui.settingsMenuKeyboard());
        return;
      }
      case data === "set:wa": {
        clearFlow(s);
        s.stage = "input";
        s.input = "whatsapp-number";
        await send(ui.inputPromptText("whatsapp-number"));
        return;
      }
      case data === "set:ann": {
        clearFlow(s);
        s.stage = "input";
        s.input = "announcement-text";
        await send(ui.inputPromptText("announcement-text"));
        return;
      }
      case data === "set:tpl": {
        clearFlow(s);
        const { checkoutTemplate } = await nexa.getSettings();
        await edit(ui.templateText(checkoutTemplate.template, checkoutTemplate.updatedAt), backHome());
        return;
      }

      // ----- deployment -----
      case data === "dep": {
        clearFlow(s);
        const latest = await vercel.latestProductionDeployment().catch(() => null);
        await edit(ui.deploymentMenuText(latest), ui.deploymentMenuKeyboard());
        return;
      }
      case data === "dep:latest": {
        clearFlow(s);
        await ok("Mengambil commit terbaru…");
        const commits = await git.listCommits(1);
        const head = commits[0];
        if (!head) return void (await send("⚠️ Commit tidak dapat dibaca."));
        s.stage = "confirm";
        s.pending = { type: "deploy-sha", sha: head.sha, label: head.title };
        await edit(ui.deployConfirmText(head.sha, `${head.title} (HEAD)`), ui.confirmKeyboard("🚀 Ya, deploy"));
        return;
      }
      case data === "dep:commits": {
        clearFlow(s);
        await ok("Memuat…");
        const commits = await git.listCommits(10);
        s.lists.commits = commits;
        await edit(ui.commitsListText(commits), ui.commitsListKeyboard(commits));
        return;
      }
      case data.startsWith("dep:go:"): {
        const idx = Number.parseInt(data.slice(7), 10);
        const commit = s.lists.commits?.[idx];
        if (!commit) return void (await ok("Commit tidak ditemukan."));
        s.stage = "confirm";
        s.pending = { type: "deploy-sha", sha: commit.sha, label: commit.title };
        await edit(ui.deployConfirmText(commit.sha, commit.title), ui.confirmKeyboard("🚀 Ya, deploy"));
        return;
      }
      case data === "dep:list": {
        clearFlow(s);
        await ok("Memuat…");
        const deps = await vercel.listProductionDeployments(6);
        s.lists.deployments = deps;
        await edit(ui.deploymentsListText(deps), ui.deploymentsListKeyboard(deps));
        return;
      }
      case data.startsWith("dep:re:"): {
        const idx = Number.parseInt(data.slice(7), 10);
        const dep = s.lists.deployments?.[idx];
        if (!dep) return void (await ok("Deployment tidak ditemukan."));
        s.stage = "confirm";
        s.pending = { type: "deploy-sha", sha: dep.sha, label: dep.commitTitle };
        await edit(ui.deployConfirmText(dep.sha, dep.commitTitle), ui.confirmKeyboard("🚀 Ya, deploy"));
        return;
      }

      // ----- v1.3.0: obrolan -----
      case data === "cht": {
        clearFlow(s);
        await ok("Memuat…");
        const conversations = await nexa.getChatConversations().catch(() => []);
        // Percakapan sandbox lokal ikut ditampilkan bila ada.
        const local = await nexa.getChatConversations(config.localBase).catch(() => []);
        const all = [...local.map((c) => ({ ...c, id: c.id })), ...conversations];
        s.lists.conversations = all;
        await edit(ui.chatMenuText(all), ui.chatMenuKeyboard(all.length));
        return;
      }
      case data.startsWith("cht:v:"): {
        const idx = Number.parseInt(data.slice(6), 10);
        const conv = s.lists.conversations?.[idx];
        if (!conv) return void (await ok("Percakapan tidak ditemukan."));
        await edit(ui.chatThreadText(conv, chatOrigin(conv.id)), ui.chatThreadKeyboard(conv.id));
        return;
      }
      case data.startsWith("cht:rd:"): {
        const id = data.slice(7);
        const origin = chatOrigin(id);
        try {
          await nexa.chatMarkRead(id, origin === "local" ? config.localBase : undefined);
          await ok("Ditandai dibaca.");
        } catch (e) {
          await ok(`Gagal: ${(e as Error).message.slice(0, 80)}`);
        }
        return;
      }
      case data.startsWith("cht:rp:"): {
        const id = data.slice(7);
        const origin = chatOrigin(id);
        let name: string | null = null;
        const conv = (s.lists.conversations ?? []).find((c) => c.id === id);
        if (!conv) {
          const all = await nexa.getChatConversations(origin === "local" ? config.localBase : undefined).catch(() => []);
          name = all.find((c) => c.id === id)?.name ?? null;
        } else {
          name = conv.name;
        }
        clearFlow(s);
        s.chatCtx = { conversationId: id, origin, name };
        s.stage = "input";
        s.input = "chat-reply";
        await send(ui.inputPromptText("chat-reply"));
        return;
      }

      // ----- v1.3.0: promo -----
      case data === "prm": {
        clearFlow(s);
        await ok("Memuat…");
        const [promos, catalog] = await Promise.all([
          nexa.getPromos().catch(() => []),
          nexa.getCatalog().catch(() => null),
        ]);
        const gameNames = new Map((catalog?.games ?? []).map((g) => [g.id, g.name]));
        s.lists.promos = promos;
        await edit(ui.promoMenuText(promos, gameNames), ui.promoMenuKeyboard(promos.length));
        return;
      }
      case data === "prm:new": {
        clearFlow(s);
        s.stage = "input";
        s.input = "promo-title";
        await send(ui.inputPromptText("promo-title"));
        return;
      }
      case data === "prm:sc:global" || data === "prm:sc:game": {
        if (s.stage !== "input") return void (await ok());
        s.promoDraft.scope = data === "prm:sc:global" ? "global" : "game";
        if (data === "prm:sc:global") {
          s.stage = "input";
          s.input = "promo-duration";
          await edit(ui.inputPromptText("promo-duration"));
        } else {
          const catalog = await nexa.getCatalog();
          s.lists.games = catalog.games;
          s.pickFor = "promo-game";
          await edit("🎮 Pilih <b>game</b> untuk promo ini:", ui.gamePickerKeyboard(catalog.games));
        }
        return;
      }
      case data.startsWith("prm:off:"): {
        const idx = Number.parseInt(data.slice(8), 10);
        const promo = s.lists.promos?.[idx];
        if (!promo) return void (await ok("Promo tidak ditemukan."));
        clearFlow(s);
        s.stage = "confirm";
        s.pending = { type: "promo-toggle", promoId: promo.id, active: !promo.active };
        await edit(ui.toggleConfirmText(`Promo ${promo.title} (-${promo.percentOff}%)`, !promo.active), ui.confirmKeyboard());
        return;
      }

      // ----- v1.3.0: banner -----
      case data === "bnr": {
        clearFlow(s);
        await ok("Memuat…");
        const banners = await nexa.getBanners().catch(() => []);
        s.lists.banners = banners;
        await edit(ui.bannerMenuText(banners), ui.bannerMenuKeyboard(banners.length));
        return;
      }
      case data === "bnr:new": {
        clearFlow(s);
        s.bannerDraft = {};
        s.stage = "input";
        await edit(
          [
            "📣 <b>BANNER BARU</b>",
            "",
            "Pilih <b>level</b> (warna pita di storefront):",
          ].join("\n"),
          [
            [
              { text: "ℹ️ Info", callback_data: "bnr:sv:info" },
              { text: "✅ Sukses", callback_data: "bnr:sv:sukses" },
            ],
            [
              { text: "⚠️ Peringatan", callback_data: "bnr:sv:peringatan" },
              { text: "🚨 Penting", callback_data: "bnr:sv:penting" },
            ],
            [{ text: "❌ Batal", callback_data: "cancel" }],
          ]
        );
        return;
      }
      case data.startsWith("bnr:sv:"): {
        if (s.stage !== "input") return void (await ok());
        s.bannerDraft.severity = data.slice(7) as "info" | "sukses" | "peringatan" | "penting";
        s.input = "banner-title";
        await send(ui.inputPromptText("banner-title"));
        return;
      }
      case data.startsWith("bnr:off:"): {
        const idx = Number.parseInt(data.slice(8), 10);
        const banner = s.lists.banners?.[idx];
        if (!banner) return void (await ok("Banner tidak ditemukan."));
        clearFlow(s);
        s.stage = "confirm";
        s.pending = { type: "banner-toggle", bannerId: banner.id, enabled: !banner.enabled };
        await edit(ui.toggleConfirmText(`Banner "${banner.title}"`, !banner.enabled), ui.confirmKeyboard());
        return;
      }

      // ----- v1.3.0: analitik -----
      case data === "stx": {
        clearFlow(s);
        await ok("Memuat…");
        const summary = await nexa.getAnalyticsSummary().catch(() => null);
        if (!summary) {
          await edit("📊 Analitik tidak dapat dibaca. Coba beberapa saat lagi.", backHome());
          return;
        }
        await edit(ui.analyticsText(summary), ui.analyticsKeyboard());
        return;
      }

      // ----- v1.3.0: tugas terjadwal -----
      case data === "tsk": {
        clearFlow(s);
        await ok("Memuat…");
        const tasks = await nexa.getSchedules().catch(() => []);
        s.lists.tasks = tasks;
        const pending = tasks.filter((t) => t.status === "pending");
        await edit(ui.taskMenuText(tasks), ui.taskMenuKeyboard(pending.length, tasks.length));
        return;
      }
      case data === "tsk:new": {
        clearFlow(s);
        s.taskDraft = {};
        await edit(ui.taskTypePickText(), ui.taskTypeKeyboard());
        return;
      }
      case data.startsWith("tsk:t:"): {
        const type = data.slice(6);
        clearFlow(s);
        s.taskDraft.type = type;
        s.stage = "input";
        s.input = "task-label";
        await send(ui.inputPromptText("task-label"));
        return;
      }
      case data.startsWith("tsk:cancel:"): {
        const idx = Number.parseInt(data.slice(11), 10);
        const pending = (s.lists.tasks ?? []).filter((t) => t.status === "pending");
        const task = pending[idx];
        if (!task) return void (await ok("Tugas tidak ditemukan."));
        s.stage = "confirm";
        s.pending = { type: "task-cancel", taskId: task.id };
        await edit(`🚫 <b>Batalkan tugas?</b>\n\n${tg.esc(task.label)} — ${tg.esc(task.type)}`, ui.confirmKeyboard("🚫 Ya, batalkan"));
        return;
      }
      case data.startsWith("tsk:pick:"): {
        const idx = Number.parseInt(data.slice(9), 10);
        const type = s.taskDraft.type ?? "";
        if (type === "banner-on" || type === "banner-off") {
          const banner = s.lists.banners?.[idx];
          if (!banner) return void (await ok("Banner tidak ditemukan."));
          s.taskDraft.targetId = banner.id;
          confirmTask(s);
          await edit(ui.taskConfirmText(s.taskDraft.label ?? "?", type, fmtWibLabel(s.taskDraft.runAt ?? ""), `banner: ${banner.title}`), ui.confirmKeyboard("⏰ Ya, jadwalkan"));
          return;
        }
        const promo = s.lists.promos?.[idx];
        if (!promo) return void (await ok("Promo tidak ditemukan."));
        s.taskDraft.targetId = promo.id;
        confirmTask(s);
        await edit(ui.taskConfirmText(s.taskDraft.label ?? "?", type, fmtWibLabel(s.taskDraft.runAt ?? ""), `promo: ${promo.title} (-${promo.percentOff}%)`), ui.confirmKeyboard("⏰ Ya, jadwalkan"));
        return;
      }
      case data === "tsk:clean": {
        clearFlow(s);
        await ok("Membersihkan…");
        const tasks = await nexa.getSchedules().catch(() => []);
        let removed = 0;
        for (const t of tasks) {
          if (t.status !== "pending") {
            const res = await nexa.deleteSchedule(t.id).catch(() => null);
            if (res) removed++;
          }
        }
        await edit(`🧹 <b>Pembersihan selesai.</b>\n\n${removed} tugas riwayat dihapus.`, backHome());
        return;
      }

      // ----- v1.4.0: runtime panel ⇄ vercel -----
      case data === "rt": {
        clearFlow(s);
        await ok("Memuat…");
        const info = await tg.getWebhookInfo().catch(() => null);
        await edit(
          ui.runtimeMenuText({
            webhookUrl: info?.url ?? null,
            pendingUpdates: info?.pending_update_count ?? null,
            lastError: info?.last_error_message ?? null,
          }),
          ui.runtimeMenuKeyboard(Boolean(info?.url))
        );
        return;
      }
      case data === "rt:tovercel": {
        clearFlow(s);
        await ok("Memeriksa Vercel…");
        // Webhook Telegram wajib URL publik HTTPS — mode target sandbox tidak bisa.
        if (!/^https:\/\//i.test(config.apiBase)) {
          await send(
            [
              "🚧 <b>TIDAK BISA PINDAH DARI MODE SANDBOX</b>",
              "",
              `Bot sedang mengendalikan pratinjau lokal: <code>${tg.esc(config.apiBase)}</code>`,
              "Webhook Telegram wajib menunjuk URL publik HTTPS.",
              "",
              "Ubah <code>NEXA_API_BASE</code> di <code>mini-services/telegram-bot/.env</code> ke alamat produksi, isi kredensial developer produksi, lalu restart layanan bot.",
            ].join("\n"),
            backHome()
          );
          return;
        }
        if (!config.webhookSecret) {
          await send(
            "🚧 <code>TELEGRAM_WEBHOOK_SECRET</code> belum diisi di .env bot panel — kode rahasia ini wajib sama di kedua sisi.",
            backHome()
          );
          return;
        }
        // Probe kesiapan endpoint webhook di produksi (dilindungi kode rahasia).
        let reason = "";
        try {
          const res = await fetch(webhookUrl(), {
            headers: { "x-telegram-bot-api-secret-token": config.webhookSecret },
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            const json = (await res.json()) as { ok: boolean; data?: { configured?: boolean } };
            if (json.ok && json.data?.configured) {
              await tg.setWebhook(webhookUrl(), config.webhookSecret);
              const info = await tg.getWebhookInfo().catch(() => null);
              await edit(
                [
                  "🚀 <b>BOT SEKARANG BERJALAN DI VERCEL</b>",
                  "",
                  `Webhook: <code>${tg.esc(info?.url || webhookUrl())}</code>`,
                  "",
                  "Polling layanan panel otomatis standby — tidak akan ada konflik 409.",
                  "Runtime ini tahan restart panel: aktif 24/7 dari serverless produksi.",
                  "",
                  "Catatan: bila ini pairing pertama di runtime Vercel, kirim /start lalu kode pairing — pairing tersimpan permanen di data store produksi.",
                ].join("\n"),
                backHome()
              );
              return;
            }
            reason = "Endpoint webhook merespons tetapi env belum lengkap di Vercel.";
          } else {
            reason = `Endpoint webhook menjawab HTTP ${res.status}.`;
          }
        } catch (e) {
          reason = `Tidak dapat menjangkau ${webhookUrl()} — ${(e as Error).message}`;
        }
        await send(ui.runtimeSetupText(reason), backHome());
        return;
      }
      case data === "rt:topanel": {
        clearFlow(s);
        await ok("Melepas webhook…");
        await tg.deleteWebhook();
        await edit(
          [
            "🏠 <b>KEMBALI KE PANEL</b>",
            "",
            "Webhook dilepas — polling layanan panel mengambil alih otomatis dalam ≤60 detik.",
            "Tugas terjadwal, notifikasi chat instan, dan digest harian aktif kembali.",
          ].join("\n"),
          backHome()
        );
        return;
      }

      // ----- konfirmasi -----
      case data === "confirm:yes": {
        const pending = s.pending;
        if (!pending || s.stage !== "confirm") {
          await ok("Tidak ada aksi tertunda.");
          return;
        }
        s.stage = "idle";
        s.pending = undefined;
        await ok("Menjalankan…");
        await executePending(chatId, messageId, pending, s);
        return;
      }
      case data === "confirm:no" || data === "cancel": {
        clearFlow(s);
        await edit("🚫 <b>Dibatalkan.</b>", ui.mainMenuKeyboard());
        return;
      }

      default:
        await ok();
        return;
    }
  } catch (e) {
    log("ERROR onCallback:", data, (e as Error).message);
    await tg
      .sendMessage(chatId, `⚠️ <b>Gagal memproses.</b>\n<code>${tg.esc((e as Error).message)}</code>`, backHome())
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Pesan teks & foto
// ---------------------------------------------------------------------------

async function onMessage(msg: NonNullable<tg.TelegramUpdate["message"]>): Promise<void> {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  if (userId === undefined) return;

  // ----- pairing -----
  if (!isPaired()) {
    const text = (msg.text ?? "").trim();
    if (!text) return;
    if (pairingBlocked(userId)) {
      log(`pairing: user ${userId} diblokir sementara`);
      return;
    }
    if (text.startsWith("/start")) {
      await tg.sendMessage(
        chatId,
        [
          "🤖 <b>BOT KENDALI NEXA STORE</b>",
          "",
          "Bot ini privat dan hanya untuk pemilik store.",
          "",
          "Masukkan <b>kode pairing</b> untuk menghubungkan akun Telegram kamu:",
        ].join("\n")
      );
      return;
    }
    if (text.replace(/\s+/g, "").toUpperCase() === config.pairingCode.replace(/\s+/g, "").toUpperCase() && config.pairingCode) {
      pairOwner(userId, chatId);
      log(`pairing BERHASIL: user ${userId} chat ${chatId}`);
      await tg.sendMessage(chatId, "✅ <b>Terhubung.</b> Akun Telegram ini sekarang pemilik kendali bot.", ui.mainMenuKeyboard());
      await sendMenu(chatId);
      return;
    }
    const res = recordWrongPairing(userId);
    log(`pairing GAGAL: user ${userId}`);
    if (res.blocked) {
      await tg.sendMessage(chatId, "⛔ Terlalu banyak percobaan salah. Coba lagi dalam 1 jam.").catch(() => undefined);
      return;
    }
    await tg.sendMessage(chatId, `❌ Kode salah. Sisa percobaan: <b>${res.remaining}</b>.`).catch(() => undefined);
    return;
  }

  // ----- hanya owner -----
  if (userId !== ownerId()) {
    log(`pesan ditolak dari user ${userId}`);
    await tg.sendMessage(chatId, "⛔ Akses ditolak.").catch(() => undefined);
    return;
  }

  const s = getSession(chatId);
  const text = (msg.text ?? "").trim();

  // foto untuk langkah ikon game
  if (msg.photo?.length) {
    await onPhoto(chatId, s, msg);
    return;
  }
  if (!text) return;

  // perintah (bisa datang sebagai /start@botname)
  const command = text.split("@")[0].split(" ")[0].toLowerCase();
  if (command === "/start" || command === "/menu") {
    clearFlow(s);
    await sendMenu(chatId);
    return;
  }
  if (command === "/status") {
    clearFlow(s);
    const [t, k] = await buildStatus();
    await tg.sendMessage(chatId, t, k);
    return;
  }
  if (command === "/cancel") {
    clearFlow(s);
    await tg.sendMessage(chatId, "🚫 <b>Dibatalkan.</b>", ui.mainMenuKeyboard());
    return;
  }
  if (command === "/help") {
    await tg.sendMessage(chatId, ui.helpText());
    return;
  }

  // Alias perintah → menu akar yang sama dengan tombol (v1.4.0).
  const root = COMMAND_TO_ROOT[command];
  if (root) {
    clearFlow(s);
    await dispatchRoot(chatId, s, root);
    return;
  }

  if (s.stage === "input" && s.input) {
    await onInputText(chatId, s, s.input, text);
    return;
  }

  await tg.sendMessage(chatId, "Ketuk /menu untuk membuka menu kendali — atau ketik / untuk melihat semua perintah.");
}

async function onPhoto(chatId: number, s: Session, msg: NonNullable<tg.TelegramUpdate["message"]>): Promise<void> {
  if (s.stage !== "input" || s.input !== "game-icon") {
    await tg.sendMessage(chatId, "Bot ini tidak menerima foto pada langkah ini. Ketik /menu untuk mulai dari awal.");
    return;
  }
  const photos = [...(msg.photo ?? [])].sort((a, b) => a.width * a.height - b.width * b.height);
  let chosen = photos[photos.length - 1];
  for (const p of photos) {
    if (p.file_size === undefined || p.file_size <= 400_000) chosen = p;
  }
  try {
    const file = await tg.getFile(chosen.file_id);
    if (!file.file_path) throw new Error("file_path kosong.");
    const buf = await tg.downloadFile(file.file_path);
    if (buf.byteLength > 600_000) {
      await tg.sendMessage(chatId, "⚠️ Foto terlalu besar (maks ±600 KB). Coba kirim foto yang lebih kecil, atau ketik - untuk tanpa ikon.");
      return;
    }
    const mime = /\.png$/i.test(file.file_path) ? "image/png" : "image/jpeg";
    s.gameDraft.image = `data:${mime};base64,${buf.toString("base64")}`;
    await confirmGameCreate(chatId, s);
  } catch (e) {
    log("ERROR onPhoto:", (e as Error).message);
    await tg.sendMessage(chatId, `⚠️ Gagal memproses foto: <code>${tg.esc((e as Error).message)}</code>`);
  }
}


/** Rakit pending task-create dari draft sesi. */
function confirmTask(s: Session): void {
  const d = s.taskDraft;
  s.stage = "confirm";
  const type = d.type ?? "";
  const payload: Record<string, unknown> = {};
  if (d.note) payload.note = d.note;
  if (d.text) payload.text = d.text;
  if ((type === "banner-on" || type === "banner-off") && d.targetId) payload.bannerId = d.targetId;
  if ((type === "promo-on" || type === "promo-off") && d.targetId) payload.promoId = d.targetId;
  s.pending = {
    type: "task-create",
    body: {
      label: d.label ?? "Tugas",
      type,
      runAt: d.runAt ?? new Date(Date.now() + 3600_000).toISOString(),
      payload,
    },
  };
}

// ---------------------------------------------------------------------------
// Input teks per langkah
// ---------------------------------------------------------------------------

async function onInputText(chatId: number, s: Session, kind: string, text: string): Promise<void> {
  const send = (t: string, k?: tg.InlineKeyboard) => tg.sendMessage(chatId, t, k).then(() => undefined);

  switch (kind) {
    case "lockdown-reason":
    case "maintenance-reason": {
      const note = text.trim();
      if (note.length < 3 || note.length > 300) {
        await send("⚠️ Tulis 3–300 karakter ya.");
        return;
      }
      const gate = s.gate ?? "lockdown";
      s.stage = "confirm";
      s.pending = {
        type: "lockdown-on",
        gate,
        scope: s.routes.length > 0 ? "routes" : "all",
        routes: s.routes,
        note,
      };
      await send(
        ui.gateConfirmText(gate, s.routes.length > 0 ? "routes" : "all", s.routes, note),
        ui.confirmKeyboard(gate === "lockdown" ? "🔴 Ya, aktifkan lockdown" : "🟡 Ya, mulai perbaikan")
      );
      return;
    }

    case "ban-reason": {
      const reason = text.trim();
      if (reason.length < 3 || reason.length > 300) {
        await send("⚠️ Tulis 3–300 karakter ya.");
        return;
      }
      s.stage = "confirm";
      s.pending = { type: "ban", reason };
      await send(ui.banConfirmText(reason), ui.confirmKeyboard("⛔ Ya, blokir admin"));
      return;
    }

    // ----- game -----
    case "game-name": {
      const name = text.trim();
      if (name.length < 2 || name.length > 60) {
        await send("⚠️ Nama game 2–60 karakter.");
        return;
      }
      s.gameDraft.name = name;
      s.gameDraft.slug = slugify(name);
      s.stage = "input";
      s.input = "game-slug";
      await send(`Saran slug: <code>${tg.esc(s.gameDraft.slug)}</code>\n\n` + ui.inputPromptText("game-slug"));
      return;
    }
    case "game-slug": {
      let slug = text.toLowerCase();
      if (slug === "ok" || slug === "ok.") slug = s.gameDraft.slug ?? "";
      slug = slugify(slug);
      if (!isValidSlug(slug)) {
        await send("⚠️ Slug harus kebab-case (huruf kecil, angka, tanda hubung) — contoh: <code>point-blank</code>.");
        return;
      }
      const catalog = await nexa.getCatalog();
      if (catalog.games.some((g) => g.slug === slug)) {
        await send("⚠️ Slug ini sudah dipakai game lain. Tulis slug lain.");
        return;
      }
      s.gameDraft.slug = slug;
      s.stage = "input";
      s.input = "game-desc";
      await send(ui.inputPromptText("game-desc"));
      return;
    }
    case "game-desc": {
      s.gameDraft.description = text === "-" ? undefined : text.trim().slice(0, 300);
      s.stage = "input";
      s.input = "game-fields";
      await send(ui.inputPromptText("game-fields"));
      return;
    }
    case "game-fields": {
      let labels: string[];
      if (text.toLowerCase() === "ok" || text.toLowerCase() === "ok.") {
        labels = ["User ID"];
      } else {
        labels = text
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 4);
        if (labels.length === 0) {
          await send("⚠️ Tulis label dipisah koma, atau ketik ok untuk default.");
          return;
        }
      }
      const keys = new Set<string>();
      s.gameDraft.orderFields = labels.map((label) => {
        let key = fieldKeyFromLabel(label);
        while (keys.has(key)) key = `${key}_`;
        keys.add(key);
        return { key, label: label.slice(0, 40), type: "text" as const, required: true, maxLength: 64 };
      });
      s.stage = "input";
      s.input = "game-icon";
      await send(ui.inputPromptText("game-icon"));
      return;
    }

    // ----- kategori -----
    case "category-name": {
      const name = text.trim();
      if (name.length < 2 || name.length > 40) {
        await send("⚠️ Nama kategori 2–40 karakter.");
        return;
      }
      s.gameDraft.name = name;
      s.gameDraft.slug = slugify(name);
      s.stage = "input";
      s.input = "category-slug";
      await send(`Saran slug: <code>${tg.esc(s.gameDraft.slug)}</code>\n\n` + ui.inputPromptText("category-slug"));
      return;
    }
    case "category-slug": {
      let slug = text.toLowerCase();
      if (slug === "ok" || slug === "ok.") slug = s.gameDraft.slug ?? "";
      slug = slugify(slug);
      if (!isValidSlug(slug)) {
        await send("⚠️ Slug harus kebab-case — contoh: <code>populer</code>.");
        return;
      }
      const catalog = await nexa.getCatalog();
      if (catalog.categories.some((c) => c.slug === slug)) {
        await send("⚠️ Slug kategori ini sudah dipakai. Tulis lain.");
        return;
      }
      s.gameDraft.slug = slug;
      s.stage = "input";
      s.input = "category-desc";
      await send(ui.inputPromptText("category-desc"));
      return;
    }
    case "category-desc": {
      const description = text === "-" ? undefined : text.trim().slice(0, 300);
      const name = s.gameDraft.name ?? "";
      const slug = s.gameDraft.slug ?? "";
      s.stage = "confirm";
      s.pending = {
        type: "category-create",
        payload: {
          id: slug,
          slug,
          name,
          ...(description ? { description } : {}),
          enabled: true,
          sortOrder: -1, // dihitung ulang saat eksekusi
        },
      };
      await send(ui.categorySummaryText(name, slug, description), ui.confirmKeyboard());
      return;
    }

    // ----- produk -----
    case "product-name": {
      const name = text.trim();
      if (name.length < 1 || name.length > 40) {
        await send("⚠️ Nama produk 1–40 karakter.");
        return;
      }
      s.gameDraft.name = name;
      s.stage = "input";
      s.input = "product-denom";
      await send(ui.inputPromptText("product-denom"));
      return;
    }
    case "product-denom": {
      const denom = text.trim();
      if (denom.length < 1 || denom.length > 40) {
        await send("⚠️ Nominal 1–40 karakter.");
        return;
      }
      s.gameDraft.denomination = denom;
      s.stage = "input";
      s.input = "product-price";
      await send(ui.inputPromptText("product-price"));
      return;
    }
    case "product-price": {
      const price = parsePrice(text);
      if (price === null) {
        await send("⚠️ Harga harus angka Rupiah — contoh: <code>56000</code>.");
        return;
      }
      s.gameDraft.priceIdr = price;
      s.stage = "input";
      s.input = "product-bonus";
      await send(ui.inputPromptText("product-bonus"));
      return;
    }
    case "product-bonus": {
      const bonus = text === "-" ? undefined : text.trim().slice(0, 80);
      const d = s.gameDraft;
      const catalog = await nexa.getCatalog();
      const chosen = catalog.games.find((g) => g.id === d.gameId);
      if (!chosen) {
        await send("⚠️ Game tidak dikenal. Mulai ulang dari /menu.");
        return;
      }
      const base = `${chosen.id}-${slugify(d.denomination ?? "")}` || `${chosen.id}-item`;
      let id = base;
      let n = 2;
      while (catalog.products.some((p) => p.id === id)) id = `${base}-${n++}`;
      s.stage = "confirm";
      s.pending = {
        type: "product-create",
        payload: {
          id,
          gameId: chosen.id,
          name: d.name,
          denomination: d.denomination,
          ...(bonus ? { bonus } : {}),
          priceIdr: d.priceIdr,
          currency: "IDR",
          enabled: true,
          sortOrder: -1, // dihitung ulang saat eksekusi
        },
      };
      await send(ui.productSummaryText(chosen.name, d.name ?? "?", d.denomination ?? "?", d.priceIdr ?? 0, bonus), ui.confirmKeyboard());
      return;
    }

    // ----- harga baru -----
    case "price-new": {
      const price = parsePrice(text);
      if (price === null) {
        await send("⚠️ Harga harus angka Rupiah — contoh: <code>61000</code>.");
        return;
      }
      const product = (s.lists.products ?? []).find((p) => p.id === s.gameDraft.productId);
      if (!product) {
        await send("⚠️ Produk tidak dikenal. Mulai ulang dari /menu.");
        return;
      }
      s.stage = "confirm";
      s.pending = { type: "product-price", productId: product.id, newPrice: price };
      await send(ui.priceChangeConfirmText(`${product.name} — ${product.denomination}`, product.priceIdr, price), ui.confirmKeyboard("💲 Ya, simpan harga"));
      return;
    }

    // ----- setelan -----
    case "whatsapp-number": {
      const value = text.trim();
      if (value.length < 7 || value.length > 25 || !/^\+?[0-9\s-]+$/.test(value)) {
        await send("⚠️ Format nomor belum benar — contoh: <code>+628886567888</code>.");
        return;
      }
      s.stage = "confirm";
      s.pending = { type: "settings-whatsapp", value };
      await send(`📱 Nomor baru: <b>${tg.esc(value)}</b>\n\nNomor WhatsApp dipakai untuk semua pemesanan checkout.`, ui.confirmKeyboard("✅ Ya, simpan"));
      return;
    }
    case "announcement-text": {
      const value = text === "-" ? null : text.trim().slice(0, 200);
      s.stage = "confirm";
      s.pending = { type: "settings-announcement", value };
      await send(`📣 Announcement baru:\n\n${value ? tg.esc(value) : "<i>(dihapus)</i>"}`, ui.confirmKeyboard("✅ Ya, simpan"));
      return;
    }

    case "game-icon": {
      // teks pada langkah ikon: URL atau "-"
      if (text === "-") {
        s.gameDraft.image = undefined;
        await confirmGameCreate(chatId, s);
        return;
      }
      if (/^https?:\/\/\S+$/i.test(text) && text.length <= 500) {
        s.gameDraft.image = text;
        await confirmGameCreate(chatId, s);
        return;
      }
      await send("⚠️ Kirim FOTO, tempel URL gambar (http/https), atau ketik - untuk tanpa ikon.");
      return;
    }

    // ----- v1.3.0: obrolan -----
    case "chat-reply": {
      const text2 = text.trim();
      if (text2.length < 1 || text2.length > 800) {
        await send("\u26a0\ufe0f Tulis 1\u2013800 karakter ya.");
        return;
      }
      const ctx = s.chatCtx;
      if (!ctx) {
        await send("\u26a0\ufe0f Tidak ada percakapan aktif. Buka /menu \u2192 Obrolan dulu.");
        return;
      }
      s.stage = "confirm";
      s.pending = { type: "chat-reply", conversationId: ctx.conversationId, origin: ctx.origin, text: text2 };
      await send(
        [
          "\ud83d\udcac <b>KONFIRMASI BALASAN</b>",
          "",
          `Kepada: <b>${tg.esc(ctx.name ?? "Pengunjung")}</b> (${ctx.origin === "local" ? "sandbox" : "produksi"})`,
          "",
          tg.esc(text2.length > 200 ? `${text2.slice(0, 200)}\u2026` : text2),
        ].join("\n"),
        ui.confirmKeyboard("\ud83d\uddac Ya, kirim balasan")
      );
      return;
    }

    // ----- v1.3.0: promo -----
    case "promo-title": {
      const title = text.trim();
      if (title.length < 3 || title.length > 60) {
        await send("\u26a0\ufe0f Nama promo 3\u201360 karakter.");
        return;
      }
      s.promoDraft.title = title;
      s.stage = "input";
      s.input = "promo-percent";
      await send(ui.inputPromptText("promo-percent"));
      return;
    }
    case "promo-percent": {
      const digits = text.replace(/[^0-9]/g, "");
      const percent = digits ? Number.parseInt(digits, 10) : 0;
      if (percent < 1 || percent > 90) {
        await send("\u26a0\ufe0f Diskon harus 1\u201390 persen \u2014 contoh: <code>10</code>.");
        return;
      }
      s.promoDraft.percentOff = percent;
      await send(
        [
          "\ud83c\udfaf Pilih <b>cakupan</b> promo:",
          "",
          "\u2022 <b>Semua game</b> \u2014 diskon di seluruh katalog",
          "\u2022 <b>Satu game</b> \u2014 hanya game terpilih",
        ].join("\n"),
        [
          [
            { text: "\ud83c\udf10 Semua game", callback_data: "prm:sc:global" },
            { text: "\ud83c\udfae Satu game", callback_data: "prm:sc:game" },
          ],
          [{ text: "\u274c Batal", callback_data: "cancel" }],
        ]
      );
      return;
    }
    case "promo-duration": {
      if (text.trim() === "-") {
        s.promoDraft.endsAt = null;
      } else {
        const parsed = parseFutureWib(text);
        if (!parsed) {
          await send("\u26a0\ufe0f Format waktu belum benar \u2014 contoh: <code>+6</code>, <code>21:00</code>, <code>2026-03-01 21:00</code>, atau <code>-</code>.");
          return;
        }
        s.promoDraft.endsAt = parsed.iso;
      }
      const d = s.promoDraft;
      const scopeLabel = d.scope === "game" ? `khusus ${(s.lists.games ?? []).find((g) => g.id === d.gameId)?.name ?? "?"}` : "semua game";
      s.stage = "confirm";
      s.pending = {
        type: "promo-create",
        body: {
          title: d.title,
          scope: d.scope ?? "global",
          ...(d.scope === "game" && d.gameId ? { gameId: d.gameId } : {}),
          percentOff: d.percentOff,
          startsAt: null,
          endsAt: d.endsAt ?? null,
        },
      };
      await send(
        ui.promoConfirmText(d.title ?? "?", d.percentOff ?? 0, scopeLabel, d.endsAt ? fmtWibLabel(d.endsAt) : null),
        ui.confirmKeyboard("\ud83c\udff7 Ya, buat promo")
      );
      return;
    }

    // ----- v1.3.0: banner -----
    case "banner-title": {
      const title = text.trim();
      if (title.length < 3 || title.length > 80) {
        await send("\u26a0\ufe0f Judul 3\u201380 karakter.");
        return;
      }
      s.bannerDraft.title = title;
      s.stage = "input";
      s.input = "banner-message";
      await send(ui.inputPromptText("banner-message"));
      return;
    }
    case "banner-message": {
      const message = text.trim();
      if (message.length < 3 || message.length > 300) {
        await send("\u26a0\ufe0f Pesan 3\u2013300 karakter.");
        return;
      }
      s.bannerDraft.message = message;
      s.stage = "input";
      s.input = "banner-cta-label";
      await send(ui.inputPromptText("banner-cta-label"));
      return;
    }
    case "banner-cta-label": {
      if (text.trim() === "-") {
        s.stage = "input";
        s.input = "banner-duration";
        await send(ui.inputPromptText("banner-duration"));
        return;
      }
      const label = text.trim();
      if (label.length < 2 || label.length > 30) {
        await send("\u26a0\ufe0f Teks tombol 2\u201330 karakter, atau <code>-</code> untuk tanpa tombol.");
        return;
      }
      s.bannerDraft.ctaLabel = label;
      s.stage = "input";
      s.input = "banner-cta-href";
      await send(ui.inputPromptText("banner-cta-href"));
      return;
    }
    case "banner-cta-href": {
      const href = text.trim();
      if (!href.startsWith("/") && !/^https?:\/\//i.test(href)) {
        await send("\u26a0\ufe0f Tautan harus diawali <code>/</code> atau URL http(s) lengkap.");
        return;
      }
      s.bannerDraft.ctaHref = href.slice(0, 300);
      s.stage = "input";
      s.input = "banner-duration";
      await send(ui.inputPromptText("banner-duration"));
      return;
    }
    case "banner-duration": {
      if (text.trim() === "-") {
        s.bannerDraft.endsAt = null;
      } else {
        const parsed = parseFutureWib(text);
        if (!parsed) {
          await send("\u26a0\ufe0f Format waktu belum benar \u2014 contoh: <code>+6</code>, <code>21:00</code>, <code>2026-03-01 21:00</code>, atau <code>-</code>.");
          return;
        }
        s.bannerDraft.endsAt = parsed.iso;
      }
      const d = s.bannerDraft;
      s.stage = "confirm";
      s.pending = {
        type: "banner-create",
        body: {
          severity: d.severity ?? "info",
          title: d.title,
          message: d.message,
          ...(d.ctaLabel && d.ctaHref ? { ctaLabel: d.ctaLabel, ctaHref: d.ctaHref } : {}),
          startsAt: null,
          endsAt: d.endsAt ?? null,
        },
      };
      await send(
        ui.bannerConfirmText(d.severity ?? "info", d.title ?? "?", d.message ?? "?", d.ctaLabel ?? null, d.ctaHref ?? null, d.endsAt ? fmtWibLabel(d.endsAt) : null),
        ui.confirmKeyboard("\ud83d\udce3 Ya, terbitkan")
      );
      return;
    }

    // ----- v1.3.0: tugas terjadwal -----
    case "task-label": {
      const label = text.trim();
      if (label.length < 3 || label.length > 80) {
        await send("\u26a0\ufe0f Nama tugas 3\u201380 karakter.");
        return;
      }
      s.taskDraft.label = label;
      s.stage = "input";
      s.input = "task-time";
      await send(ui.inputPromptText("task-time"));
      return;
    }
    case "task-time": {
      const parsed = parseFutureWib(text);
      if (!parsed) {
        await send("\u26a0\ufe0f Format waktu belum benar \u2014 contoh: <code>+2</code>, <code>02:00</code>, atau <code>2026-03-01 02:00</code>.");
        return;
      }
      s.taskDraft.runAt = parsed.iso;
      const type = s.taskDraft.type ?? "";
      if (type === "reminder" || type === "announcement-set") {
        s.stage = "input";
        s.input = "task-text";
        await send(ui.inputPromptText("task-text"));
        return;
      }
      if (type === "maintenance-on" || type === "lockdown-on") {
        s.stage = "input";
        s.input = "task-note";
        await send(ui.inputPromptText("task-note"));
        return;
      }
      if (type === "banner-on" || type === "banner-off") {
        const banners = await nexa.getBanners().catch(() => []);
        if (banners.length === 0) {
          await send("\u26a0\ufe0f Belum ada banner tersimpan. Buat banner dulu lewat menu \ud83d\udce3 Banner.");
          return;
        }
        s.lists.banners = banners;
        const rows: tg.InlineKeyboard = banners.slice(0, 8).map((b, i) => [
          { text: `${b.enabled ? "\ud83d\udfe2" : "\u26aa\ufe0f"} ${b.title.slice(0, 24)}`, callback_data: `tsk:pick:${i}` },
        ]);
        rows.push([{ text: "\u274c Batal", callback_data: "cancel" }]);
        await send("\ud83d\udce3 Pilih <b>banner</b> untuk tugas ini:", rows);
        return;
      }
      if (type === "promo-on" || type === "promo-off") {
        const promos = await nexa.getPromos().catch(() => []);
        if (promos.length === 0) {
          await send("\u26a0\ufe0f Belum ada promo tersimpan. Buat promo dulu lewat menu \ud83c\udff7 Promo.");
          return;
        }
        s.lists.promos = promos;
        const rows: tg.InlineKeyboard = promos.slice(0, 8).map((p, i) => [
          { text: `${p.active ? "\ud83d\udfe2" : "\u26aa\ufe0f"} ${p.title.slice(0, 24)} -${p.percentOff}%`, callback_data: `tsk:pick:${i}` },
        ]);
        rows.push([{ text: "\u274c Batal", callback_data: "cancel" }]);
        await send("\ud83c\udff7 Pilih <b>promo</b> untuk tugas ini:", rows);
        return;
      }
      confirmTask(s);
      await send(ui.taskConfirmText(s.taskDraft.label ?? "?", type, fmtWibLabel(parsed.iso), null), ui.confirmKeyboard("\u23f0 Ya, jadwalkan"));
      return;
    }
    case "task-note": {
      const note = text.trim() === "-" ? undefined : text.trim().slice(0, 300);
      if (note) s.taskDraft.note = note;
      confirmTask(s);
      await send(
        ui.taskConfirmText(s.taskDraft.label ?? "?", s.taskDraft.type ?? "?", fmtWibLabel(s.taskDraft.runAt ?? ""), note ?? null),
        ui.confirmKeyboard("\u23f0 Ya, jadwalkan")
      );
      return;
    }
    case "task-text": {
      const body = text.trim().slice(0, 500);
      if (body.length < 3) {
        await send("\u26a0\ufe0f Tulis minimal 3 karakter.");
        return;
      }
      s.taskDraft.text = body;
      confirmTask(s);
      await send(
        ui.taskConfirmText(s.taskDraft.label ?? "?", s.taskDraft.type ?? "?", fmtWibLabel(s.taskDraft.runAt ?? ""), body),
        ui.confirmKeyboard("\u23f0 Ya, jadwalkan")
      );
      return;
    }

    default:
      await send("Langkah tidak dikenal. Ketik /menu untuk mulai ulang.");
      return;
  }
}

// ---------------------------------------------------------------------------
// Konfirmasi & eksekusi
// ---------------------------------------------------------------------------

async function confirmGameCreate(chatId: number, s: Session): Promise<void> {
  const d = s.gameDraft;
  if (!d.name || !d.slug) {
    await tg.sendMessage(chatId, "⚠️ Data game belum lengkap. Mulai ulang dari /menu.");
    return;
  }
  const catalog = await nexa.getCatalog();
  s.stage = "confirm";
  s.pending = {
    type: "game-create",
    payload: {
      id: d.slug,
      slug: d.slug,
      name: d.name,
      ...(d.description ? { description: d.description } : {}),
      ...(d.image ? { image: d.image } : {}),
      categoryIds: [],
      orderFieldSchema: d.orderFields ?? [{ key: "userId", label: "User ID", type: "text", required: true }],
      enabled: true,
      sortOrder: Math.max(0, ...catalog.games.map((g) => g.sortOrder)) + 1,
    },
  };
  await tg.sendMessage(chatId, ui.gameSummaryText(d), ui.confirmKeyboard("✅ Ya, tambahkan game"));
}

async function executePending(chatId: number, messageId: number, pending: NonNullable<Session["pending"]>, s: Session): Promise<void> {
  const edit = (text: string, keyboard?: tg.InlineKeyboard) => tg.editMessageText(chatId, messageId, text, keyboard).then(() => undefined);
  const send = (text: string, keyboard?: tg.InlineKeyboard) => tg.sendMessage(chatId, text, keyboard).then(() => undefined);
  const failKeyboard = backHome();

  try {
    switch (pending.type) {
      case "lockdown-on": {
        const r = await nexa.setGate(pending.gate, true, pending.scope, pending.routes, pending.note);
        const sync = await withSyncNote();
        await edit(ui.gateSuccessText(pending.gate, true, (r.commitMessage as string) ?? null, sync), [
          [{ text: pending.gate === "lockdown" ? "🔴 Kontrol lockdown" : "🛠 Kontrol perbaikan", callback_data: pending.gate === "lockdown" ? "lk" : "mt" }],
          [{ text: "⬅️ Menu", callback_data: "menu" }],
        ]);
        return;
      }
      case "gate-off": {
        const r = await nexa.setGate(pending.gate, false, "all", []);
        const sync = await withSyncNote();
        await edit(ui.gateSuccessText(pending.gate, false, (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "ban": {
        const r = await nexa.setAdminBlocked(true, pending.reason);
        const sync = await withSyncNote();
        await edit(
          [
            "⛔ <b>ADMIN DIBLOKIR</b>",
            "",
            `Alasan: ${tg.esc(pending.reason)}`,
            "",
            "Sesi admin aktif langsung dicabut.",
            (r.commitMessage as string) ? `\nCommit: <code>${tg.esc(r.commitMessage as string)}</code>` : "",
            sync ? `\nRepo sandbox: ${tg.esc(sync)}` : "",
          ].join("\n"),
          backHome()
        );
        return;
      }
      case "unban": {
        const r = await nexa.setAdminBlocked(false);
        const sync = await withSyncNote();
        await edit(
          [
            "✅ <b>BLOKIR ADMIN DIBUKA</b>",
            "",
            "Admin bisa login kembali sekarang.",
            (r.commitMessage as string) ? `\nCommit: <code>${tg.esc(r.commitMessage as string)}</code>` : "",
            sync ? `\nRepo sandbox: ${tg.esc(sync)}` : "",
          ].join("\n"),
          backHome()
        );
        return;
      }
      case "category-create": {
        const catalog = await nexa.getCatalog();
        const payload = {
          ...(pending.payload as Record<string, unknown>),
          sortOrder: catalog.categories.length + 1,
        };
        const r = await nexa.mutate([{ type: "category.create", payload }]);
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText("KATEGORI DITAMBAHKAN", (r.diff as { lines?: string[] })?.lines ?? [], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "game-create": {
        const r = await nexa.mutate([{ type: "game.create", payload: pending.payload }]);
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText("GAME DITAMBAHKAN", (r.diff as { lines?: string[] })?.lines ?? [], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "product-create": {
        const catalog = await nexa.getCatalog();
        const payload = {
          ...(pending.payload as Record<string, unknown>),
          sortOrder: catalog.products.length + 1,
        };
        const r = await nexa.mutate([{ type: "product.create", payload: payload }]);
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText("PRODUK DITAMBAHKAN", (r.diff as { lines?: string[] })?.lines ?? [], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "product-price": {
        const catalog = await nexa.getCatalog();
        const product = catalog.products.find((p) => p.id === pending.productId);
        if (!product) throw new Error("Produk tidak ditemukan (mungkin baru dihapus).");
        const r = await nexa.mutate([
          { type: "product.update", id: product.id, payload: { ...product, priceIdr: pending.newPrice } },
        ]);
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText("HARGA TERSIMPAN", (r.diff as { lines?: string[] })?.lines ?? [], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "game-toggle": {
        const catalog = await nexa.getCatalog();
        const game = catalog.games.find((g) => g.id === pending.gameId);
        if (!game) throw new Error("Game tidak ditemukan.");
        const r = await nexa.mutate([{ type: "game.update", id: game.id, payload: { ...game, enabled: !game.enabled } }]);
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText(game.enabled ? "GAME DINONAKTIFKAN" : "GAME DIAKTIFKAN", (r.diff as { lines?: string[] })?.lines ?? [], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "product-toggle": {
        const catalog = await nexa.getCatalog();
        const product = catalog.products.find((p) => p.id === pending.productId);
        if (!product) throw new Error("Produk tidak ditemukan.");
        const r = await nexa.mutate([
          { type: "product.update", id: product.id, payload: { ...product, enabled: !product.enabled } },
        ]);
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText(product.enabled ? "PRODUK DINONAKTIFKAN" : "PRODUK DIAKTIFKAN", (r.diff as { lines?: string[] })?.lines ?? [], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "settings-whatsapp": {
        const { settings } = await nexa.getSettings();
        const r = await nexa.saveSettings({ ...settings, whatsappNumber: pending.value });
        const sync = await withSyncNote();
        await edit(ui.writeSuccessText("NOMOR WHATSAPP TERSIMPAN", [`${settings.whatsappNumber} → ${pending.value}`], (r.commitMessage as string) ?? null, sync), backHome());
        return;
      }
      case "settings-announcement": {
        const { settings } = await nexa.getSettings();
        const r = await nexa.saveSettings({
          ...settings,
          ...(pending.value ? { announcement: pending.value } : {}),
        });
        const sync = await withSyncNote();
        await edit(
          ui.writeSuccessText("ANNOUNCEMENT TERSIMPAN", [pending.value ?? "(dihapus)"], (r.commitMessage as string) ?? null, sync),
          backHome()
        );
        return;
      }
      case "deploy-sha": {
        const uid = await vercel.deployFromSha(pending.sha);
        await edit(ui.deployStartedText(uid, pending.sha), backHome());
        // Pantau di latar belakang — hasil dikirim sebagai pesan baru.
        void vercel
          .waitUntilDone(uid)
          .then((res) => send(ui.deployDoneText(res.state, pending.sha, res.url), ui.mainMenuKeyboard()))
          .catch((e) => send(`⚠️ Gagal memantau deployment: <code>${tg.esc((e as Error).message)}</code>`));
        return;
      }
      case "chat-reply": {
        try {
          await nexa.chatReply(
            pending.conversationId,
            pending.text,
            pending.origin === "local" ? config.localBase : undefined
          );
          await edit(
            [
              "\u2705 <b>BALASAN TERKIRIM</b>",
              "",
              `Kepada: <b>${tg.esc((s.chatCtx?.name ?? "Pengunjung"))}</b>`,
              `Sumber: ${pending.origin === "local" ? "sandbox" : "produksi"}`,
              "",
              "Pengunjung melihat balasan ini di widget chat dalam sekejap.",
            ].join("\n"),
            [[{ text: "\ud83d\uddac Semua obrolan", callback_data: "cht" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]
          );
        } finally {
          s.chatCtx = undefined;
        }
        return;
      }
      case "promo-create": {
        await nexa.createPromo(pending.body);
        const sync = await withSyncNote();
        await edit(
          [
            "\ud83c\udff7 <b>PROMO DIBUAT</b>",
            "",
            "Harga storefront menyusul dalam \u226430 detik \u2014 tanpa deploy.",
            sync ? `\nRepo sandbox: ${tg.esc(sync)}` : "",
          ].join("\n"),
          [[{ text: "\ud83c\udff7 Event Promo", callback_data: "prm" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]
        );
        return;
      }
      case "promo-toggle": {
        await nexa.patchPromo(pending.promoId, { active: pending.active });
        await edit(
          pending.active ? "\u2705 <b>PROMO DIAKTIFKAN</b>" : "\u26a0\ufe0f <b>PROMO DIMATIKAN</b>",
          [[{ text: "\ud83c\udff7 Event Promo", callback_data: "prm" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]
        );
        return;
      }
      case "banner-create": {
        await nexa.createBanner(pending.body);
        await edit(
          [
            "\ud83d\udce3 <b>BANNER DITERBITKAN</b>",
            "",
            "Tampil di seluruh storefront dalam \u226430 detik.",
          ].join("\n"),
          [[{ text: "\ud83d\udce3 Banner", callback_data: "bnr" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]
        );
        return;
      }
      case "banner-toggle": {
        await nexa.patchBanner(pending.bannerId, { enabled: pending.enabled });
        await edit(
          pending.enabled ? "\u2705 <b>BANNER DITERBITKAN</b>" : "\u26a0\ufe0f <b>BANNER DISSEMBUNYIKAN</b>",
          [[{ text: "\ud83d\udce3 Banner", callback_data: "bnr" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]
        );
        return;
      }
      case "task-create": {
        await nexa.createSchedule(pending.body);
        await edit(
          [
            "\u23f0 <b>TUGAS DIJADWALKAN</b>",
            "",
            "Eksekutor bot berjalan 24/7 \u2014 hasilnya diberitahu ke Telegram.",
          ].join("\n"),
          [[{ text: "\u23f0 Tugas", callback_data: "tsk" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]
        );
        return;
      }
      case "task-cancel": {
        await nexa.patchSchedule(pending.taskId, { status: "cancelled", lastResult: "dibatalkan dari Telegram" });
        await edit("\ud83d\uded1 <b>Tugas dibatalkan.</b>", [[{ text: "\u23f0 Tugas", callback_data: "tsk" }], [{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }]]);
        return;
      }
      default:
        await send("Aksi tidak dikenal.");
    }
  } catch (e) {
    log("ERROR executePending:", (e as Error).message);
    await edit(
      `⚠️ <b>Aksi gagal.</b>\n<code>${tg.esc((e as Error).message)}</code>\n\nData tidak berubah — coba lagi atau cek /status.`,
      failKeyboard
    ).catch(() => send(`⚠️ <b>Aksi gagal.</b>\n<code>${tg.esc((e as Error).message)}</code>`, failKeyboard));
  }
}

// ---------------------------------------------------------------------------
// Status view
// ---------------------------------------------------------------------------

async function buildStatus(): Promise<[string, tg.InlineKeyboard]> {
  const [pub, access, catalog, latest, version, analytics, tasks] = await Promise.allSettled([
    nexa.publicStoreStatus(),
    nexa.getAccess(),
    nexa.getCatalog(),
    vercel.latestProductionDeployment(),
    git.fetchAppVersion(),
    nexa.getAnalyticsSummary(),
    nexa.getSchedules(),
  ]);
  const text = ui.statusText({
    healthy: pub.status === "fulfilled",
    access: access.status === "fulfilled" ? access.value : null,
    catalog: catalog.status === "fulfilled" ? catalog.value : null,
    latest: latest.status === "fulfilled" ? latest.value : null,
    version: version.status === "fulfilled" ? version.value : null,
    analytics: analytics.status === "fulfilled" ? analytics.value : null,
    pendingTasks: tasks.status === "fulfilled"
      ? (tasks.value as { status: string }[]).filter((t) => t.status === "pending").length
      : null,
  });
  return [text, ui.statusKeyboard()];
}
