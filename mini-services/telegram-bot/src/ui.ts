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
      { text: "👮 Admin", callback_data: "adm" },
      { text: "📦 Katalog", callback_data: "cat" },
    ],
    [
      { text: "🚀 Deployment", callback_data: "dep" },
      { text: "⚙️ Setelan", callback_data: "set" },
    ],
  ];
}

export type StatusData = {
  healthy: boolean;
  access: AccessState | null;
  catalog: CatalogRead | null;
  latest: DeploymentInfo | null;
  version: string | null;
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
    "Perintah cepat:",
    "/menu — buka menu utama",
    "/status — ringkasan kondisi situs",
    "/cancel — batalkan langkah yang berjalan",
    "",
    "Semua tombol berlabel ❌ Batal juga membatalkan langkah aktif.",
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
