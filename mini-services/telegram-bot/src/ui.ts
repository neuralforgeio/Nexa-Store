/**
 * Semua teks & keyboard bot — satu tempat agar nada & istilah konsisten
 * dengan copywriting aplikasi utama (Indonesian, lugas, tanpa templating kosong).
 */
import { esc } from "./telegram";
import { config, LOCKABLE_ROUTES } from "./config";
import type { AccessState, CatalogRead, GateState, GameRecord, ProductRecord, StoreSettings } from "./nexa";
import type { CommitInfo } from "./gitops";
import type { DeploymentInfo } from "./vercel";
import type { Session } from "./state";

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = InlineButton[][];

// ---------------------------------------------------------------------------
// Utilitas tampilan
// ---------------------------------------------------------------------------

export function fmtIdr(value: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(value)}`;
}

export function relTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "baru saja";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

function gateLines(gate: GateState, gatePath: string): string {
  if (!gate.active) return "🟢 <b>NONAKTIF</b>";
  const scope = gate.scope === "all" ? "SEMUA HALAMAN PUBLIK" : `${gate.routes.length} rute (${gate.routes.join(", ")})`;
  const note = gate.note ? `\nPesan: ${esc(gate.note)}` : "";
  const meta = gate.updatedAt ? `\nDiubah ${relTime(Date.parse(gate.updatedAt))} · oleh ${esc(gate.updatedBy ?? "?")}` : "";
  return `🔴 <b>AKTIF — ${scope}</b>${note}${meta}\n\nPengunjung dialihkan ke ${gatePath}`;
}

function menuHomeRow(): InlineButton[] {
  return [{ text: "⬅️ Menu", callback_data: "menu" }];
}

// ---------------------------------------------------------------------------
// Menu utama & status
// ---------------------------------------------------------------------------

export function mainMenuText(name: string | undefined, version: string | null): string {
  const hello = name ? `Halo, ${esc(name)}.` : "Halo.";
  const ver = version ? ` · v${esc(version)}` : "";
  return [
    "⚡ <b>NEXA STORE — CONTROL CENTER</b>",
    "",
    `${hello}`,
    `Bot terhubung ke produksi: ${esc(config.apiBase)}${ver}`,
    "",
    "Semua aksi di bawah berlaku ke situs live.",
  ].join("\n");
}

export function mainMenuKeyboard(): InlineKeyboard {
  return [
    [{ text: "📊 Status", callback_data: "status" }],
    [
      { text: "🔒 Lockdown", callback_data: "lk" },
      { text: "🛠 Perbaikan", callback_data: "mt" },
    ],
    [
      { text: "💬 Obrolan", callback_data: "cht" },
      { text: "🏷 Promo", callback_data: "prm" },
    ],
    [
      { text: "📣 Banner", callback_data: "bnr" },
      { text: "📊 Analitik", callback_data: "stx" },
    ],
    [
      { text: "⏰ Tugas", callback_data: "tsk" },
      { text: "👮 Admin", callback_data: "adm" },
    ],
    [
      { text: "📦 Katalog", callback_data: "cat" },
      { text: "🚀 Deployment", callback_data: "dep" },
    ],
    [
      { text: "⚙️ Setelan", callback_data: "set" },
      { text: "⚡ Runtime", callback_data: "rt" },
    ],
  ];
}

export type StatusData = {
  healthy: boolean;
  access: AccessState | null;
  catalog: CatalogRead | null;
  latest: DeploymentInfo | null;
  version: string | null;
  analytics: {
    today: { views: number; uniques: number; events: Record<string, number> };
    last7: { views: number; uniques: number; events: Record<string, number> };
    live: number;
    topPages: Array<{ path: string; views: number }>;
  } | null;
  pendingTasks: number | null;
};

export function statusText(d: StatusData): string {
  const gates = d.access;
  const lines = [
    "📊 <b>STATUS NEXA STORE</b>",
    "",
    `🌐 Produksi: ${esc(config.apiBase)} — ${d.healthy ? "🟢 sehat" : "🔴 tidak merespons"}`,
    `🔒 Lockdown: ${gates ? (gates.lockdown.active ? "<b>AKTIF</b>" : "nonaktif") : "?"}`,
    `🛠 Perbaikan: ${gates ? (gates.maintenance.active ? "<b>AKTIF</b>" : "nonaktif") : "?"}`,
    `👮 Admin: ${gates ? (gates.adminBlocked ? "<b>DIBLOKIR</b>" : "aktif") : "?"}`,
  ];
  if (gates?.lockdown.active && gates.lockdown.note) {
    lines.push(`   ↳ Lockdown: ${esc(gates.lockdown.note)}`);
  }
  if (gates?.maintenance.active && gates.maintenance.note) {
    lines.push(`   ↳ Perbaikan: ${esc(gates.maintenance.note)}`);
  }
  if (d.catalog) {
    lines.push(
      `📦 Katalog: ${d.catalog.games.length} game · ${d.catalog.products.length} produk · ${d.catalog.categories.length} kategori`
    );
  }
  if (d.analytics) {
    lines.push(
      `🟢 Online: <b>${d.analytics.live}</b> · 👀 Hari ini: ${d.analytics.today.views} views (${d.analytics.today.uniques} unik)`
    );
  }
  if (d.pendingTasks !== null) {
    lines.push(`⏰ Tugas menunggu: ${d.pendingTasks}`);
  }
  if (d.version) lines.push(`🏷 Versi app: v${esc(d.version)}`);
  if (d.latest) {
    const icon = d.latest.state === "READY" ? "✅" : d.latest.state === "ERROR" ? "❌" : "🟡";
    lines.push(`🚀 Build terakhir: ${icon} ${d.latest.state} · ${esc(d.latest.commitTitle)} · ${relTime(d.latest.createdMs)}`);
  }
  return lines.join("\n");
}

export function statusKeyboard(): InlineKeyboard {
  return [
    [{ text: "🔄 Muat ulang", callback_data: "status" }],
    [menuHomeRow()[0]],
  ];
}

// ---------------------------------------------------------------------------
// Lockdown & Perbaikan (maintenance)
// ---------------------------------------------------------------------------

export function gateMenuText(gate: "lockdown" | "maintenance", state: GateState): string {
  const head = gate === "lockdown" ? "🔒 KONTROL LOCKDOWN" : "🛠 KONTROL PERBAIKAN";
  const path = gate === "lockdown" ? "/lockdown" : "/maintenance";
  const onBtn = gate === "lockdown" ? "🔴 Lockdown total" : "🟡 Perbaikan menyeluruh";
  const onRute = gate === "lockdown" ? "🎯 Lockdown rute tertentu" : "🎯 Perbaikan rute tertentu";
  return [
    `<b>${head}</b>`,
    "",
    `Status: ${gateLines(state, path)}`,
  ].join("\n");
}

export function gateMenuKeyboard(gate: "lockdown" | "maintenance", active: boolean): InlineKeyboard {
  const k = gate === "lockdown" ? "lk" : "mt";
  const rows: InlineKeyboard = [
    [
      { text: gate === "lockdown" ? "🔴 Lockdown total" : "🟡 Perbaikan menyeluruh", callback_data: `${k}:on:all` },
    ],
    [{ text: "🎯 Rute tertentu", callback_data: `${k}:on:rt` }],
  ];
  if (active) {
    rows.push([{ text: gate === "lockdown" ? "🟢 Angkat lockdown" : "🟢 Akhiri perbaikan", callback_data: `${k}:off` }]);
  }
  rows.push([menuHomeRow()[0]]);
  return rows;
}

export function routePickerText(gate: "lockdown" | "maintenance"): string {
  const noun = gate === "lockdown" ? "dikunci" : "diperbaiki";
  return [
    "🎯 <b>PILIH RUTE</b>",
    "",
    `Tandai halaman publik yang akan ${noun}. Ketuk untuk menandai / menghapus tandangan.`,
    "Halaman staf (/login, dashboard) tidak bisa dikunci supaya aksi tetap bisa dibuka.",
  ].join("\n");
}

export function routePickerKeyboard(selected: string[]): InlineKeyboard {
  const rows: InlineKeyboard = LOCKABLE_ROUTES.map((r) => {
    const on = selected.includes(r.id);
    return [{ text: `${on ? "✅" : "⚪️"} ${r.label}  (${r.id})`, callback_data: `rt:${r.code}` }];
  });
  rows.push([
    { text: "➡️ Lanjut ke alasan", callback_data: "rt:next" },
    { text: "❌ Batal", callback_data: "cancel" },
  ]);
  return rows;
}

export function gateConfirmText(
  gate: "lockdown" | "maintenance",
  scope: "all" | "routes",
  routes: string[],
  note: string
): string {
  const head = gate === "lockdown" ? "🔴 KONFIRMASI LOCKDOWN" : "🟡 KONFIRMASI PERBAIKAN";
  const cakupan = scope === "all" ? "Semua halaman publik" : routes.join(", ");
  const noteLabel = gate === "lockdown" ? "Alasan" : "Pesan";
  const effect =
    gate === "lockdown"
      ? "Pengunjung non-staff langsung dialihkan ke halaman /lockdown."
      : "Pengunjung non-staff langsung dialihkan ke halaman /maintenance.";
  return [
    `<b>${head}</b>`,
    "",
    `Cakupan: <b>${esc(cakupan)}</b>`,
    `${noteLabel}: ${esc(note)}`,
    "",
    effect,
  ].join("\n");
}

export function gateOffConfirmText(gate: "lockdown" | "maintenance"): string {
  return [
    gate === "lockdown" ? "🟢 <b>ANGKAT LOCKDOWN</b>" : "🟢 <b>AKHIRI PERBAIKAN</b>",
    "",
    gate === "lockdown"
      ? "Situs langsung bisa diakses publik kembali seperti sediakala."
      : "Situs langsung bisa diakses publik kembali seperti sediakala.",
  ].join("\n");
}

export function gateSuccessText(
  gate: "lockdown" | "maintenance",
  active: boolean,
  commitMessage: string | null,
  syncNote: string | null
): string {
  const head =
    gate === "lockdown"
      ? active
        ? "✅ LOCKDOWN AKTIF"
        : "✅ LOCKDOWN DIBUKA"
      : active
        ? "✅ PERBAIKAN AKTIF"
        : "✅ PERBAIKAN SELESAI";
  const detail =
    gate === "lockdown"
      ? active
        ? "Pengunjung non-staff sekarang diarahkan ke /lockdown."
        : "Halaman publik kembali bisa diakses."
      : active
        ? "Pengunjung non-staff sekarang diarahkan ke /maintenance."
        : "Halaman publik kembali bisa diakses.";
  const lines = [`<b>${head}</b>`, "", detail];
  if (commitMessage) lines.push("", `Commit: <code>${esc(commitMessage)}</code>`);
  if (syncNote) lines.push("", `Repo sandbox: ${esc(syncNote)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function adminMenuText(a: AccessState): string {
  const status = a.adminBlocked ? "<b>⛔ DIBLOKIR</b>" : "<b>🟢 AKTIF</b>";
  const lines = ["👮 <b>KONTROL ADMIN</b>", "", `Akses admin: ${status}`];
  if (a.adminBlocked && a.reason) lines.push(`Alasan: ${esc(a.reason)}`);
  if (a.updatedAt) lines.push(`Diubah ${relTime(Date.parse(a.updatedAt))} · oleh ${esc(a.updatedBy ?? "?")}`);
  lines.push("", "Admin yang diblokir otomatis dikeluarkan dari dashboard dan tidak bisa masuk lagi.");
  return lines.join("\n");
}

export function adminMenuKeyboard(blocked: boolean): InlineKeyboard {
  const rows: InlineKeyboard = blocked
    ? [[{ text: "✅ Buka blokir admin", callback_data: "adm:unban" }]]
    : [[{ text: "⛔ Blokir admin…", callback_data: "adm:ban" }]];
  rows.push([menuHomeRow()[0]]);
  return rows;
}

export function banConfirmText(reason: string): string {
  return [
    "⛔ <b>KONFIRMASI BLOKIR ADMIN</b>",
    "",
    `Alasan: ${esc(reason)}`,
    "",
    "Sesi admin aktif langsung dicabut dan login berikutnya ditolak sampai blokir dibuka.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

export function catalogMenuText(c: CatalogRead): string {
  return [
    "📦 <b>KATALOG</b>",
    "",
    `${c.games.length} game · ${c.products.length} produk · ${c.categories.length} kategori`,
    "",
    "Perubahan langsung tersimpan ke repo dan tampil di produksi.",
  ].join("\n");
}

export function catalogMenuKeyboard(): InlineKeyboard {
  return [
    [
      { text: "🎮 Game", callback_data: "cat:game" },
      { text: "🏷 Kategori", callback_data: "cat:cat" },
    ],
    [{ text: "💠 Produk", callback_data: "cat:prod" }],
    [menuHomeRow()[0]],
  ];
}

export function gamesMenuText(games: GameRecord[], products: ProductRecord[]): string {
  const counted = productCountFor(games, products);
  const list = counted.length
    ? counted.map(({ g, n }) => `${g.enabled ? "🟢" : "⚪️"} ${esc(g.name)} · ${n} produk`).join("\n")
    : "Belum ada game.";
  return ["🎮 <b>GAME</b>", "", list].join("\n");
}

function productCountFor(games: GameRecord[], products: ProductRecord[]): Array<{ g: GameRecord; n: number }> {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.gameId, (counts.get(p.gameId) ?? 0) + 1);
  return games.map((g) => ({ g, n: counts.get(g.id) ?? 0 }));
}

export function gamesMenuKeyboard(): InlineKeyboard {
  return [
    [
      { text: "➕ Tambah game", callback_data: "cat:game:add" },
      { text: "⏯ Aktif/nonaktif", callback_data: "cat:game:tog" },
    ],
    [{ text: "⬅️ Katalog", callback_data: "cat" }],
  ];
}

export function categoriesMenuText(c: CatalogRead): string {
  const list = c.categories.length
    ? c.categories.map((x) => `${x.enabled ? "🟢" : "⚪️"} ${esc(x.name)} (${esc(x.slug)})`).join("\n")
    : "Belum ada kategori — game saat ini tampil tanpa pengelompokan.";
  return ["🏷 <b>KATEGORI</b>", "", list].join("\n");
}

export function categoriesMenuKeyboard(): InlineKeyboard {
  return [
    [{ text: "➕ Tambah kategori", callback_data: "cat:cat:add" }],
    [{ text: "⬅️ Katalog", callback_data: "cat" }],
  ];
}

export function productsMenuText(): string {
  return [
    "💠 <b>PRODUK</b>",
    "",
    "Tambah nominal top-up, ubah harga, atau sembunyikan produk.",
  ].join("\n");
}

export function productsMenuKeyboard(): InlineKeyboard {
  return [
    [{ text: "➕ Tambah produk", callback_data: "cat:prod:add" }],
    [
      { text: "💲 Ubah harga", callback_data: "cat:prod:price" },
      { text: "⏯ Aktif/nonaktif", callback_data: "cat:prod:tog" },
    ],
    [{ text: "⬅️ Katalog", callback_data: "cat" }],
  ];
}

export function gamePickerText(purpose: string): string {
  return ["🎮 <b>PILIH GAME</b>", "", `Untuk: ${esc(purpose)}`, "", "Ketuk game di bawah."].join("\n");
}

export function gamePickerKeyboard(games: GameRecord[]): InlineKeyboard {
  const rows: InlineKeyboard = games.slice(0, 24).map((g) => [
    { text: `${g.enabled ? "🟢" : "⚪️"} ${g.name}`, callback_data: `pick:g:${g.id}` },
  ]);
  rows.push([{ text: "❌ Batal", callback_data: "cancel" }]);
  return rows;
}

export function productPickerText(gameName: string, products: ProductRecord[], purpose: string): string {
  const list = products
    .slice(0, 16)
    .map((p) => `${p.enabled ? "🟢" : "⚪️"} ${esc(p.denomination)} — ${fmtIdr(p.priceIdr)}`)
    .join("\n");
  return ["💠 <b>PILIH PRODUK</b>", "", `Game: ${esc(gameName)} · ${purpose}`, "", list || "Belum ada produk."].join("\n");
}

export function productPickerKeyboard(products: ProductRecord[]): InlineKeyboard {
  const rows: InlineKeyboard = products.slice(0, 16).map((p) => [
    { text: `${p.enabled ? "🟢" : "⚪️"} ${p.denomination} · ${fmtIdr(p.priceIdr)}`, callback_data: `pick:p:${p.id}` },
  ]);
  rows.push([{ text: "❌ Batal", callback_data: "cancel" }]);
  return rows;
}

// ---------------------------------------------------------------------------
// Setelan store
// ---------------------------------------------------------------------------

export function settingsMenuText(s: StoreSettings): string {
  return [
    "⚙️ <b>SETELAN STORE</b>",
    "",
    `📱 WhatsApp: ${esc(s.whatsappNumber)}`,
    `📣 Announcement: ${s.announcement ? esc(s.announcement) : "—"}`,
    `🏪 Nama store: ${esc(s.storeName)}`,
  ].join("\n");
}

export function settingsMenuKeyboard(): InlineKeyboard {
  return [
    [
      { text: "📱 Ubah WhatsApp", callback_data: "set:wa" },
      { text: "📣 Ubah announcement", callback_data: "set:ann" },
    ],
    [{ text: "👁 Template checkout", callback_data: "set:tpl" }],
    [menuHomeRow()[0]],
  ];
}

export function templateText(template: string, updatedAt?: string): string {
  return [
    "👁 <b>TEMPLATE CHECKOUT</b>",
    "",
    `<code>${esc(template)}</code>`,
    "",
    updatedAt ? `Terakhir diubah: ${relTime(Date.parse(updatedAt))}` : "",
    "",
    "Template hanya bisa diubah dari dashboard (ada validasi placeholder).",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export function deploymentMenuText(latest: DeploymentInfo | null): string {
  const lines = ["🚀 <b>DEPLOYMENT</b>", "", `Produksi: ${esc(config.apiBase)}`];
  if (latest) {
    const icon = latest.state === "READY" ? "✅" : latest.state === "ERROR" ? "❌" : "🟡";
    lines.push(`Build terakhir: ${icon} ${latest.state} — ${esc(latest.commitTitle)} · ${relTime(latest.createdMs)}`);
  } else {
    lines.push("Build terakhir: tidak diketahui.");
  }
  lines.push("", "Deploy commit lama memutar balik kode saat itu — data katalog tetap dibaca live dari repo.");
  return lines.join("\n");
}

export function deploymentMenuKeyboard(): InlineKeyboard {
  return [
    [{ text: "🔄 Deploy ulang terbaru", callback_data: "dep:latest" }],
    [{ text: "📚 Commit terbaru", callback_data: "dep:commits" }],
    [{ text: "🖥 Daftar deployment", callback_data: "dep:list" }],
    [menuHomeRow()[0]],
  ];
}

export function commitsListText(commits: CommitInfo[]): string {
  const lines = ["📚 <b>COMMIT TERBARU</b>", "", "Pilih commit yang mau dideploy ulang ke produksi:"];
  commits.forEach((c, i) => {
    lines.push(`${i + 1}. <code>${c.sha.slice(0, 7)}</code> ${esc(c.title)} · ${relTime(Date.parse(c.date))}`);
  });
  return lines.join("\n");
}

export function commitsListKeyboard(commits: CommitInfo[]): InlineKeyboard {
  const rows: InlineKeyboard = commits.map((c, i) => [
    { text: `🚀 ${c.sha.slice(0, 7)} · ${c.title.slice(0, 24)}`, callback_data: `dep:go:${i}` },
  ]);
  rows.push([{ text: "❌ Tutup", callback_data: "dep" }]);
  return rows;
}

export function deploymentsListText(deps: DeploymentInfo[]): string {
  const lines = ["🖥 <b>DEPLOYMENT PRODUKSI</b>", "", "Ketuk untuk deploy ulang commit milik deployment itu:"];
  deps.forEach((d) => {
    const icon = d.state === "READY" ? "✅" : d.state === "ERROR" ? "❌" : "🟡";
    lines.push(`${icon} ${d.commitTitle.slice(0, 40)} · ${relTime(d.createdMs)}`);
  });
  return lines.join("\n");
}

export function deploymentsListKeyboard(deps: DeploymentInfo[]): InlineKeyboard {
  const rows: InlineKeyboard = deps.map((d, i) => [
    { text: `🚀 ${d.commitTitle.slice(0, 28)}`, callback_data: `dep:re:${i}` },
  ]);
  rows.push([{ text: "❌ Tutup", callback_data: "dep" }]);
  return rows;
}

export function deployConfirmText(sha: string, label: string): string {
  return [
    "🚀 <b>KONFIRMASI DEPLOY</b>",
    "",
    `Commit: <code>${esc(sha.slice(0, 7))}</code> — ${esc(label)}`,
    "",
    "Vercel akan membangun produksi dari commit ini. Butuh ± 1 menit.",
  ].join("\n");
}

export function deployStartedText(uid: string, sha: string): string {
  return [
    "⏳ <b>DEPLOYMENT DIMULAI</b>",
    "",
    `Commit: <code>${esc(sha.slice(0, 7))}</code>`,
    `Deployment: <code>${esc(uid.slice(0, 26))}…</code>`,
    "",
    "Aku pantau progresnya dan memberi kabar begitu selesai.",
  ].join("\n");
}

export function deployDoneText(state: string, sha: string, url: string | null): string {
  const ok = state === "READY";
  const icon = ok ? "✅" : "❌";
  const lines = [
    `${icon} <b>${ok ? "DEPLOYMENT SELESAI" : `DEPLOYMENT ${state}`}</b>`,
    "",
    `Commit: <code>${esc(sha.slice(0, 7))}</code> · Status: <b>${esc(state)}</b>`,
  ];
  if (ok && url) {
    lines.push("", `Preview build: <code>${esc(url)}</code>`, "", `Produksi aktif di: ${esc(config.apiBase)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Prompt input & konfirmasi umum
// ---------------------------------------------------------------------------

export function inputPromptText(kind: string): string {
  const prompts: Record<string, string> = {
    "lockdown-reason":
      "🔒 Tulis <b>alasan lockdown</b> yang akan dilihat pengunjung di halaman /lockdown (maks 300 karakter).\n\nKirim /cancel untuk batal.",
    "maintenance-reason":
      "🛠 Tulis <b>pesan perbaikan</b> yang akan dilihat pengunjung di halaman /maintenance (maks 300 karakter).\n\nKirim /cancel untuk batal.",
    "ban-reason":
      "⛔ Tulis <b>alasan pemblokiran</b> admin (maks 300 karakter). Alasan ini tampil di layar pemblokiran.\n\nKirim /cancel untuk batal.",
    "game-name": "🎮 <b>Nama game</b> — contoh: <i>Point Blank</i>.\n\n/cancel untuk batal.",
    "game-slug": "🔗 <b>Slug URL</b> (kebab-case).\n\nKetik <code>ok</code> untuk memakai saran, atau tulis sendiri.\n\n/cancel untuk batal.",
    "game-desc": "📝 <b>Deskripsi singkat</b> game (tampil di katalog).\n\nKetik <code>-</code> untuk lewati.\n\n/cancel untuk batal.",
    "game-fields":
      "🧾 <b>Data pemesan</b> yang diminta saat checkout.\n\nTulis label dipisah koma — contoh: <code>User ID, Zone</code>.\nKetik <code>ok</code> untuk default (User ID).\n\n/cancel untuk batal.",
    "game-icon":
      "🖼 <b>Ikon game</b>.\n\nKirim <b>FOTO</b> sekarang, atau tempel URL gambar, atau ketik <code>-</code> untuk tanpa ikon (huruf awal jadi ikon).\n\n/cancel untuk batal.",
    "category-name": "🏷 <b>Nama kategori</b> — contoh: <i>Populer</i>.\n\n/cancel untuk batal.",
    "category-slug": "🔗 <b>Slug kategori</b> (kebab-case).\n\nKetik <code>ok</code> untuk saran, atau tulis sendiri.\n\n/cancel untuk batal.",
    "category-desc": "📝 <b>Deskripsi kategori</b> (opsional).\n\nKetik <code>-</code> untuk lewati.\n\n/cancel untuk batal.",
    "product-name": "💠 <b>Nama produk</b> — contoh: <i>Points</i> atau <i>Diamond</i>.\n\n/cancel untuk batal.",
    "product-denom": "🔢 <b>Nominal</b> — contoh: <code>475</code> atau <code>86 Diamond</code>.\n\n/cancel untuk batal.",
    "product-price": "💰 <b>Harga</b> dalam Rupiah, angka saja — contoh: <code>56000</code>.\n\n/cancel untuk batal.",
    "product-bonus": "🎁 <b>Bonus</b> (opsional) — contoh: <i>+50 bonus</i>.\n\nKetik <code>-</code> untuk tanpa bonus.\n\n/cancel untuk batal.",
    "price-new": "💰 <b>Harga baru</b> dalam Rupiah, angka saja — contoh: <code>61000</code>.\n\n/cancel untuk batal.",
    "whatsapp-number":
      "📱 <b>Nomor WhatsApp baru</b> lengkap kode negara — contoh: <code>+628886567888</code>.\n\n/cancel untuk batal.",
    "announcement-text":
      "📣 <b>Announcement baru</b> (tampil di storefront).\n\nKetik <code>-</code> untuk menghapus.\n\n/cancel untuk batal.",
    "chat-reply":
      "💬 Tulis <b>balasanmu</b> — pesan ini tampil langsung di widget chat pengunjung (maks 800 karakter).\n\n/cancel untuk batal.",
    "promo-title": "🏷 <b>Nama promo</b> — contoh: <i>Promo Gajian</i>.\n\n/cancel untuk batal.",
    "promo-percent":
      "💰 <b>Besar diskon</b> dalam persen (1–90) — contoh: <code>10</code>.\n\n/cancel untuk batal.",
    "promo-duration":
      "⏳ <b>Berakhir kapan</b> (opsional).\n\nFormat: <code>+6</code> (6 jam lagi), <code>21:00</code> (jam WIB berikutnya), <code>2026-03-01 21:00</code>, atau <code>-</code> tanpa batas.\n\n/cancel untuk batal.",
    "banner-title": "📣 <b>Judul banner</b> — contoh: <i>Libur sementara</i>.\n\n/cancel untuk batal.",
    "banner-message":
      "📝 <b>Pesan banner</b> yang tampil di seluruh storefront (maks 300 karakter).\n\n/cancel untuk batal.",
    "banner-cta-label":
      "🔗 <b>Teks tombol CTA</b> (opsional) — contoh: <i>Lihat promo</i>.\n\nKetik <code>-</code> untuk tanpa tombol.\n\n/cancel untuk batal.",
    "banner-cta-href":
      "🌐 <b>Tautan tujuan tombol</b> — rute internal (<code>/games</code>) atau URL lengkap.\n\n/cancel untuk batal.",
    "banner-duration":
      "⏳ <b>Berakhir kapan</b> (opsional).\n\nFormat: <code>+6</code> (6 jam), <code>21:00</code>, <code>2026-03-01 21:00</code>, atau <code>-</code> tanpa batas.\n\n/cancel untuk batal.",
    "task-label": "⏰ <b>Nama tugas</b> — contoh: <i>Maintenance tengah malam</i>.\n\n/cancel untuk batal.",
    "task-time":
      "🕒 <b>Kapan tugas dijalankan</b> (WIB).\n\nFormat: <code>+2</code> (2 jam lagi), <code>02:00</code> (jam WIB berikutnya), atau <code>2026-03-01 02:00</code>.\n\n/cancel untuk batal.",
    "task-text": "📝 <b>Isi teks</b> untuk pengingat/announcement (maks 500 karakter).\n\n/cancel untuk batal.",
    "task-note": "🛠 <b>Pesan/alasan</b> yang tampil ke pengunjung (opsional, maks 300 karakter).\n\nKetik <code>-</code> untuk default.\n\n/cancel untuk batal.",
  };
  return prompts[kind] ?? "Masukkan nilai:";
}

export function confirmKeyboard(yesLabel = "✅ Ya, lanjutkan"): InlineKeyboard {
  return [
    [{ text: yesLabel, callback_data: "confirm:yes" }],
    [{ text: "❌ Batal", callback_data: "confirm:no" }],
  ];
}

export function gameSummaryText(d: Session["gameDraft"]): string {
  const fields = (d.orderFields ?? []).map((f) => f.label).join(", ") || "—";
  const cats = (d.categoryIds ?? []).join(", ") || "—";
  return [
    "🎮 <b>KONFIRMASI GAME BARU</b>",
    "",
    `Nama: <b>${esc(d.name ?? "?")}</b>`,
    `Slug: <code>${esc(d.slug ?? "?")}</code>`,
    `Deskripsi: ${d.description ? esc(d.description) : "—"}`,
    `Kategori: ${esc(cats)}`,
    `Data pemesan: ${esc(fields)}`,
    `Ikon: ${d.image ? "ada" : "tanpa ikon (huruf awal)"}`,
    "",
    "Game langsung aktif dan tampil di produksi.",
  ].join("\n");
}

export function categorySummaryText(name: string, slug: string, description?: string): string {
  return [
    "🏷 <b>KONFIRMASI KATEGORI BARU</b>",
    "",
    `Nama: <b>${esc(name)}</b>`,
    `Slug: <code>${esc(slug)}</code>`,
    `Deskripsi: ${description ? esc(description) : "—"}`,
  ].join("\n");
}

export function productSummaryText(
  gameName: string,
  name: string,
  denomination: string,
  priceIdr: number,
  bonus?: string
): string {
  return [
    "💠 <b>KONFIRMASI PRODUK BARU</b>",
    "",
    `Game: ${esc(gameName)}`,
    `Produk: <b>${esc(name)} — ${esc(denomination)}</b>`,
    `Harga: <b>${fmtIdr(priceIdr)}</b>`,
    `Bonus: ${bonus ? esc(bonus) : "—"}`,
    "",
    "Produk langsung aktif dan bisa dipesan.",
  ].join("\n");
}

export function priceChangeConfirmText(title: string, current: number, next: number): string {
  return [
    "💲 <b>KONFIRMASI UBAH HARGA</b>",
    "",
    `Produk: ${esc(title)}`,
    `Harga kini: ${fmtIdr(current)}`,
    `Harga baru: <b>${fmtIdr(next)}</b>`,
  ].join("\n");
}

export function toggleConfirmText(label: string, enabling: boolean): string {
  return [
    "⏯ <b>KONFIRMASI</b>",
    "",
    `${esc(label)} akan di<b>${enabling ? "aktifkan" : "nonaktifkan"}</b>.`,
    enabling ? "Item langsung tampil lagi di store." : "Item disembunyikan dari store (data tetap aman).",
  ].join("\n");
}

export function writeSuccessText(head: string, diffLines: string[], commitMessage: string | null, syncNote: string | null): string {
  const lines = [`✅ <b>${head}</b>`];
  if (diffLines.length) {
    lines.push("", ...diffLines.slice(0, 8).map((l) => `• ${esc(l)}`));
  }
  if (commitMessage) lines.push("", `Commit: <code>${esc(commitMessage)}</code>`);
  if (syncNote) lines.push("", `Repo sandbox: ${esc(syncNote)}`);
  return lines.join("\n");
}

export function helpText(): string {
  return [
    "ℹ️ <b>BOT KENDALI NEXA STORE</b>",
    "",
    "Ketik <b>/</b> untuk melihat seluruh perintah berikut:",
    "/menu — buka menu utama",
    "/status — ringkasan kondisi situs",
    "/lockdown — kunci situs (total / rute)",
    "/maintenance — mode perbaikan",
    "/promo — event diskon storefront",
    "/banner — banner pengumuman",
    "/chat — obrolan pelanggan",
    "/tasks — tugas terjadwal",
    "/analytics — statistik pengunjung",
    "/admin — blokir / buka blokir admin",
    "/catalog — game, produk, kategori",
    "/deploy — deploy & rollback Vercel",
    "/settings — nomor WA & announcement",
    "/runtime — pindah bot: panel ⇄ Vercel",
    "/cancel — batalkan langkah berjalan",
    "",
    "Semua tombol berlabel ❌ Batal juga membatalkan langkah aktif.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// v1.4.0 — Runtime: panel (polling) ⇄ Vercel (webhook).
// ---------------------------------------------------------------------------

export type RuntimeInfo = {
  webhookUrl: string | null;
  pendingUpdates: number | null;
  lastError: string | null;
};

export function runtimeMenuText(info: RuntimeInfo): string {
  const onVercel = Boolean(info.webhookUrl);
  const lines = [
    "⚡ <b>RUNTIME BOT</b>",
    "",
    `Sekarang: ${onVercel ? "🚀 Vercel (webhook produksi)" : "🏠 Panel (polling layanan)"}`,
    `Target API: ${esc(config.apiBase)}`,
  ];
  if (onVercel && info.webhookUrl) {
    lines.push(`Webhook: <code>${esc(info.webhookUrl)}</code>`);
  } else {
    lines.push("Webhook: belum dipasang");
  }
  if (info.pendingUpdates !== null && info.pendingUpdates > 0) {
    lines.push(`Update menunggu di webhook: ${info.pendingUpdates}`);
  }
  if (info.lastError) {
    lines.push(`⚠️ Error terakhir webhook: ${esc(info.lastError)}`);
  }
  lines.push(
    "",
    "<b>Dua runtime, satu bot:</b>",
    "🏠 <b>Panel</b> — lengkap: tugas terjadwal, notifikasi chat instan, digest harian. Hidup selama layanan panel menyala.",
    "🚀 <b>Vercel</b> — webhook di serverless produksi: selalu hidup 24/7, tahan restart panel.",
    "",
    "Berpindah otomatis: polling panel standby saat webhook aktif, dan sebaliknya."
  );
  return lines.join("\n");
}

export function runtimeMenuKeyboard(onVercel: boolean): InlineKeyboard {
  return onVercel
    ? [
        [{ text: "🏠 Kembali ke panel (polling)", callback_data: "rt:topanel" }],
        [{ text: "⬅️ Menu", callback_data: "menu" }],
      ]
    : [
        [{ text: "🚀 Pindah ke Vercel (webhook)", callback_data: "rt:tovercel" }],
        [{ text: "⬅️ Menu", callback_data: "menu" }],
      ];
}

/** Petunjuk saat webhook Vercel belum siap (env belum diisi). */
export function runtimeSetupText(reason: string): string {
  return [
    "🚧 <b>VERCEL BELUM SIAP</b>",
    "",
    esc(reason),
    "",
    "Aktifkan sekali di dashboard Vercel (Project → Settings → Environment Variables):",
    "1. <code>TELEGRAM_BOT_TOKEN</code> — token dari @BotFather",
    "2. <code>TELEGRAM_WEBHOOK_SECRET</code> — kode rahasia webhook (sama dengan .env bot panel)",
    "3. <code>NEXA_DEV_EMAIL</code> / <code>NEXA_DEV_PASSWORD</code> — kredensial developer produksi",
    "",
    "Lalu redeploy, dan jalankan /runtime lagi dari panel.",
  ].join("\n");
}

export function priceNewPrompt(product: { name: string; denomination: string; priceIdr: number }): string {
  return [
    "💲 <b>UBAH HARGA</b>",
    "",
    `Produk: ${esc(product.name)} — ${esc(product.denomination)}`,
    `Harga kini: ${fmtIdr(product.priceIdr)}`,
    "",
    "Ketik harga baru (angka Rupiah, contoh: <code>61000</code>).",
    "",
    "Kirim /cancel untuk batal.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// v1.3.0 — Obrolan, Promo, Banner, Analitik, Tugas Terjadwal.
// ---------------------------------------------------------------------------

export function chatNotifyKeyboard(conversationId: string): InlineKeyboard {
  return [
    [
      { text: "💬 Balas", callback_data: `cht:rp:${conversationId}` },
      { text: "✅ Tandai dibaca", callback_data: `cht:rd:${conversationId}` },
    ],
    [{ text: "📬 Semua obrolan", callback_data: "cht" }],
  ];
}

export function chatNotifyText(name: string | null, text: string, isLocal: boolean): string {
  const preview = text.length > 180 ? `${text.slice(0, 180)}…` : text;
  return [
    "💬 <b>PESAN BARU DARI PENGGUNA</b>",
    "",
    `Nama: <b>${esc(name ?? "Tanpa nama")}</b>`,
    `Sumber: ${isLocal ? "pratinjau sandbox" : "produksi"}`,
    "",
    esc(preview),
    "",
    "Balas lewat tombol di bawah — pesanmu tampil di widget chat pengunjung.",
  ].join("\n");
}

export function chatMenuText(conversations: Array<{ name: string | null; lastMessageAt: string; unreadByOwner: number; lastText: string }>): string {
  if (conversations.length === 0) {
    return [
      "💬 <b>OBROLAN LANGSUNG</b>",
      "",
      "Belum ada percakapan. Pengunjung memulai obrolan lewat tombol chat di pojok kanan bawah storefront.",
    ].join("\n");
  }
  const rows = conversations.slice(0, 8).map((c, i) => {
    const unread = c.unreadByOwner > 0 ? ` 🔴${c.unreadByOwner}` : "";
    const preview = c.lastText.length > 40 ? `${c.lastText.slice(0, 40)}…` : c.lastText;
    return `${i + 1}. <b>${esc(c.name ?? "Tanpa nama")}</b>${unread} — ${esc(preview)} (${relTime(Date.parse(c.lastMessageAt))})`;
  });
  return [
    "💬 <b>OBROLAN LANGSUNG</b>",
    "",
    ...rows,
    "",
    `Total: ${conversations.length} percakapan · ketuk tombol untuk membuka alurnya.`,
  ].join("\n");
}

export function chatMenuKeyboard(count: number): InlineKeyboard {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < Math.min(count, 8); i++) {
    rows.push([{ text: `💬 Percakapan ${i + 1}`, callback_data: `cht:v:${i}` }]);
  }
  rows.push([{ text: "🔄 Muat ulang", callback_data: "cht" }, { text: "⬅️ Menu", callback_data: "menu" }]);
  return rows;
}

export function chatThreadText(
  conv: { name: string | null; messages: Array<{ from: "user" | "owner"; text: string; at: string }> },
  origin: "local" | "prod"
): string {
  const tail = conv.messages.slice(-8);
  const lines = tail.map(
    (m) => `${m.from === "user" ? "👤" : "🛡"} <b>${m.from === "user" ? esc(conv.name ?? "Pengunjung") : "Kamu"}:</b> ${esc(m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text)} <i>(${relTime(Date.parse(m.at))})</i>`
  );
  return [
    `💬 <b>${esc(conv.name ?? "Tanpa nama")}</b>`,
    `Sumber: ${origin === "local" ? "pratinjau sandbox" : "produksi"}`,
    "",
    ...lines,
  ].join("\n");
}

export function chatThreadKeyboard(conversationId: string): InlineKeyboard {
  return [
    [{ text: "💬 Balas", callback_data: `cht:rp:${conversationId}` }],
    [
      { text: "✅ Tandai dibaca", callback_data: `cht:rd:${conversationId}` },
      { text: "⬅️ Obrolan", callback_data: "cht" },
    ],
  ];
}

export function promoMenuText(promos: Array<{ title: string; scope: string; gameId?: string; percentOff: number; active: boolean; endsAt: string | null }>, gameNames: Map<string, string>): string {
  if (promos.length === 0) {
    return [
      "🏷 <b>EVENT PROMO</b>",
      "",
      "Belum ada promo. Promo aktif otomatis mengubah harga di seluruh storefront —",
      "kartu produk, keranjang, dan pesan WhatsApp — tanpa deploy.",
    ].join("\n");
  }
  const now = Date.now();
  const rows = promos.slice(0, 10).map((p, i) => {
    const scope = p.scope === "global" ? "semua game" : `khusus ${esc(gameNames.get(p.gameId ?? "") ?? "?")}`;
    const expired = p.endsAt && Date.parse(p.endsAt) <= now;
    const state = p.active && !expired ? "🟢" : "⚪️";
    const end = p.endsAt ? ` · s.d. ${relTime(Date.parse(p.endsAt))}` : "";
    return `${state} ${i + 1}. <b>${esc(p.title)}</b> -${p.percentOff}% (${scope})${end}`;
  });
  return ["🏷 <b>EVENT PROMO</b>", "", ...rows].join("\n");
}

export function promoMenuKeyboard(count: number): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "➕ Promo baru", callback_data: "prm:new" }]];
  for (let i = 0; i < Math.min(count, 10); i++) {
    rows.push([{ text: `#${i + 1} aktif/nonaktif`, callback_data: `prm:off:${i}` }]);
  }
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return rows;
}

export function promoConfirmText(title: string, percent: number, scopeLabel: string, endsAt: string | null): string {
  return [
    "🏷 <b>KONFIRMASI PROMO BARU</b>",
    "",
    `Nama: <b>${esc(title)}</b>`,
    `Diskon: <b>${percent}%</b> (harga dibulatkan ke bawah per Rp500)`,
    `Cakupan: ${esc(scopeLabel)}`,
    `Berakhir: ${endsAt ? esc(endsAt) : "tanpa batas waktu"}`,
    "",
    "Harga storefront menyusul dalam ≤30 detik. Tanpa deploy.",
  ].join("\n");
}

export function bannerMenuText(banners: Array<{ severity: string; title: string; message: string; enabled: boolean }>): string {
  if (banners.length === 0) {
    return [
      "📣 <b>BANNER PENGUMUMAN</b>",
      "",
      "Belum ada banner. Banner tampil sebagai pita berwarna di seluruh storefront",
      "dengan tombol ajakan opsional — terbit dalam ≤30 detik.",
    ].join("\n");
  }
  const icon: Record<string, string> = { info: "ℹ️", sukses: "✅", peringatan: "⚠️", penting: "🚨" };
  const rows = banners.slice(0, 10).map(
    (b, i) => `${b.enabled ? "🟢" : "⚪️"} ${i + 1}. ${icon[b.severity] ?? "ℹ️"} <b>${esc(b.title)}</b> — ${esc(b.message.length > 60 ? `${b.message.slice(0, 60)}…` : b.message)}`
  );
  return ["📣 <b>BANNER PENGUMUMAN</b>", "", ...rows].join("\n");
}

export function bannerMenuKeyboard(count: number): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "➕ Banner baru", callback_data: "bnr:new" }]];
  for (let i = 0; i < Math.min(count, 10); i++) {
    rows.push([{ text: `#${i + 1} tampil/sembunyi`, callback_data: `bnr:off:${i}` }]);
  }
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return rows;
}

export function bannerConfirmText(severity: string, title: string, message: string, ctaLabel: string | null, ctaHref: string | null, endsAt: string | null): string {
  return [
    "📣 <b>KONFIRMASI BANNER BARU</b>",
    "",
    `Level: <b>${esc(severity)}</b>`,
    `Judul: <b>${esc(title)}</b>`,
    `Pesan: ${esc(message)}`,
    ctaLabel && ctaHref ? `Tombol: ${esc(ctaLabel)} → <code>${esc(ctaHref)}</code>` : "Tanpa tombol CTA",
    `Berakhir: ${endsAt ? esc(endsAt) : "tanpa batas waktu"}`,
    "",
    "Tampil di seluruh storefront dalam ≤30 detik.",
  ].join("\n");
}

export function analyticsText(d: {
  today: { views: number; uniques: number; events: Record<string, number> };
  last7: { views: number; uniques: number; events: Record<string, number> };
  live: number;
  totalViews: number;
  topPages: Array<{ path: string; views: number }>;
  topReferrers: Array<{ referrer: string; views: number }>;
  devices: Array<{ device: string; views: number }>;
}): string {
  const top3 = d.topPages.slice(0, 3).map((p) => `   • <code>${esc(p.path)}</code> — ${p.views} views`) || ["   • —"];
  const ref = d.topReferrers.slice(0, 3).map((r) => `   • ${esc(r.referrer)} — ${r.views}`) || ["   • —"];
  const dev = d.devices.map((x) => `${esc(x.device)} ${x.views}`).join(" · ") || "—";
  return [
    "📊 <b>ANALITIK PENGUNJUNG</b>",
    "",
    `🟢 Online sekarang: <b>${d.live}</b>`,
    `👀 Hari ini: ${d.today.views} views · ${d.today.uniques} unik`,
    `📅 7 hari: ${d.last7.views} views · ${d.last7.uniques} unik`,
    `💬 Chat dibuka (7h): ${d.last7.events["chat_open"] ?? 0}`,
    `🛒 Lanjut order (7h): ${d.last7.events["order_click"] ?? 0} · ke WA: ${d.last7.events["wa_handoff"] ?? 0}`,
    "",
    "Halaman populer (30 hari):",
    ...top3,
    "Sumber trafik (30 hari):",
    ...ref,
    `Perangkat: ${dev}`,
    "",
    "Digest harian otomatis terkirim 21:00 WIB.",
  ].join("\n");
}

export function analyticsKeyboard(): InlineKeyboard {
  return [
    [{ text: "🔄 Muat ulang", callback_data: "stx" }],
    [{ text: "⬅️ Menu", callback_data: "menu" }],
  ];
}

export function taskMenuText(tasks: Array<{ label: string; type: string; runAt: string; status: string; lastResult?: string }>): string {
  if (tasks.length === 0) {
    return [
      "⏰ <b>TUGAS TERJADWAL</b>",
      "",
      "Belum ada tugas. Contoh: nyalakan maintenance malam ini jam 02:00,",
      "aktifkan promo besok pagi, atau pengingat ke Telegram.",
    ].join("\n");
  }
  const icon: Record<string, string> = { pending: "🕓", done: "✅", failed: "❌", cancelled: "🚫" };
  const typeLabel: Record<string, string> = {
    "maintenance-on": "maintenance ON", "maintenance-off": "maintenance OFF",
    "lockdown-on": "lockdown ON", "lockdown-off": "lockdown OFF",
    "banner-on": "banner ON", "banner-off": "banner OFF",
    "promo-on": "promo ON", "promo-off": "promo OFF",
    "announcement-set": "set announcement", reminder: "pengingat",
  };
  const rows = tasks.slice(0, 10).map((t) => {
    const ms = Date.parse(t.runAt) - Date.now();
    const when = t.status === "pending" && ms > 0
      ? ms < 3600_000
        ? `${Math.round(ms / 60_000)} menit lagi`
        : `${Math.floor(ms / 3600_000)} jam ${Math.round((ms % 3600_000) / 60_000)} menit lagi`
      : relTime(Date.parse(t.runAt));
    return `${icon[t.status] ?? "🕓"} <b>${esc(t.label)}</b> — ${typeLabel[t.type] ?? t.type} · ${when}`;
  });
  return ["⏰ <b>TUGAS TERJADWAL</b>", "", ...rows].join("\n");
}

export function taskMenuKeyboard(pendingCount: number, total: number): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "➕ Tugas baru", callback_data: "tsk:new" }]];
  for (let i = 0; i < Math.min(pendingCount, 10); i++) {
    rows.push([{ text: `Batal #${i + 1}`, callback_data: `tsk:cancel:${i}` }]);
  }
  if (total > 0) rows.push([{ text: "🗑 Bersihkan selesai", callback_data: "tsk:clean" }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return rows;
}

export function taskTypeKeyboard(): InlineKeyboard {
  return [
    [
      { text: "🛠 Maintenance ON", callback_data: "tsk:t:maintenance-on" },
      { text: "🟢 Maintenance OFF", callback_data: "tsk:t:maintenance-off" },
    ],
    [
      { text: "🔒 Lockdown ON", callback_data: "tsk:t:lockdown-on" },
      { text: "🔓 Lockdown OFF", callback_data: "tsk:t:lockdown-off" },
    ],
    [
      { text: "📣 Banner ON", callback_data: "tsk:t:banner-on" },
      { text: "🔕 Banner OFF", callback_data: "tsk:t:banner-off" },
    ],
    [
      { text: "🏷 Promo ON", callback_data: "tsk:t:promo-on" },
      { text: "💸 Promo OFF", callback_data: "tsk:t:promo-off" },
    ],
    [
      { text: "📢 Set announcement", callback_data: "tsk:t:announcement-set" },
      { text: "⏰ Pengingat", callback_data: "tsk:t:reminder" },
    ],
    [{ text: "❌ Batal", callback_data: "cancel" }],
  ];
}

export function taskTypePickText(): string {
  return [
    "⏰ <b>TUGAS TERJADWAL</b>",
    "",
    "Pilih <b>jenis tugas</b>:",
  ].join("\n");
}

export function taskConfirmText(label: string, type: string, runAt: string, extra: string | null): string {
  return [
    "⏰ <b>KONFIRMASI TUGAS</b>",
    "",
    `Nama: <b>${esc(label)}</b>`,
    `Jenis: ${esc(type)}`,
    `Jalan: <b>${esc(runAt)}</b> (WIB)`,
    extra ? `Detail: ${esc(extra)}` : "",
    "",
    "Eksekusi otomatis oleh layanan bot — hasil diberitahu ke Telegram.",
  ].filter(Boolean).join("\n");
}

export function taskDoneText(task: { label: string }, ok: boolean, result: string): string {
  return [
    ok ? "✅ <b>TUGAS SELESAI</b>" : "❌ <b>TUGAS GAGAL</b>",
    "",
    `Nama: <b>${esc(task.label)}</b>`,
    `Hasil: ${esc(result)}`,
  ].join("\n");
}

export function digestText(d: {
  today: { views: number; uniques: number; events: Record<string, number> };
  last7: { views: number; uniques: number; events: Record<string, number> };
  live: number;
  topPages: Array<{ path: string; views: number }>;
}): string {
  const top = d.topPages.slice(0, 3).map((p) => `   • <code>${esc(p.path)}</code> — ${p.views} views`);
  return [
    "📊 <b>DIGEST HARIAN — NEXA STORE</b>",
    "21:00 WIB",
    "",
    `👀 Views hari ini: <b>${d.today.views}</b> (${d.today.uniques} pengunjung unik)`,
    `🟢 Sedang online: ${d.live}`,
    `📅 7 hari: ${d.last7.views} views · ${d.last7.uniques} unik`,
    `💬 Chat dibuka: ${d.last7.events["chat_open"] ?? 0} · 🛒 Order: ${d.last7.events["order_click"] ?? 0} · WhatsApp: ${d.last7.events["wa_handoff"] ?? 0}`,
    "",
    "Halaman terpopuler:",
    ...(top.length ? top : ["   • belum ada data"]),
    "",
    "Sampai besok — jaga kesehatan. 🌙",
  ].join("\n");
}
