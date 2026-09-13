/**
 * Router update Telegram → alur percakapan → eksekusi aksi.
 * Hanya owner (user id yang sudah pairing) yang diproses.
 */
import { config, routeIdFromCode } from "./config";
import * as tg from "./telegram";
import * as ui from "./ui";
import * as nexa from "./nexa";
import type { GameRecord, ProductRecord } from "./nexa";
import * as vercel from "./vercel";
import * as git from "./gitops";
import {
  clearFlow,
  getSession,
  isPaired,
  ownerId,
  pairOwner,
  pairingBlocked,
  recordWrongPairing,
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
  const res = await git.syncSandbox();
  return res.ok ? `tersinkron (${res.detail})` : `gagal sinkron — ${res.detail}`;
}

function backHome(): tg.InlineKeyboard {
  return [[{ text: "⬅️ Menu", callback_data: "menu" }]];
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

  if (s.stage === "input" && s.input) {
    await onInputText(chatId, s, s.input, text);
    return;
  }

  await tg.sendMessage(chatId, "Ketuk /menu untuk membuka menu kendali.");
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
  const [pub, access, catalog, latest, version] = await Promise.allSettled([
    nexa.publicStoreStatus(),
    nexa.getAccess(),
    nexa.getCatalog(),
    vercel.latestProductionDeployment(),
    git.fetchAppVersion(),
  ]);
  const text = ui.statusText({
    healthy: pub.status === "fulfilled",
    access: access.status === "fulfilled" ? access.value : null,
    catalog: catalog.status === "fulfilled" ? catalog.value : null,
    latest: latest.status === "fulfilled" ? latest.value : null,
    version: version.status === "fulfilled" ? version.value : null,
  });
  return [text, ui.statusKeyboard()];
}
