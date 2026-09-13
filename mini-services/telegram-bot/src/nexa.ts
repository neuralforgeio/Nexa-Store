/**
 * Klien API Nexa Store — bot masuk sebagai DEVELOPER lalu memakai API
 * manajemen yang sama dengan dashboard. Semua validasi, deteksi konflik,
 * dan persistensi (GitHub di produksi) tetap dipegang aplikasi utama.
 */
import { config } from "./config";

export type OrderField = {
  key: string;
  label: string;
  type: "text" | "number";
  required: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type GameRecord = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  image?: string;
  categoryIds: string[];
  orderFieldSchema: OrderField[];
  enabled: boolean;
  sortOrder: number;
};

export type CategoryRecord = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
};

export type ProductRecord = {
  id: string;
  gameId: string;
  categoryId?: string;
  name: string;
  denomination: string;
  bonus?: string;
  priceIdr: number;
  currency: "IDR";
  enabled: boolean;
  sortOrder: number;
  note?: string;
};

export type GateState = {
  active: boolean;
  scope: "all" | "routes";
  routes: string[];
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type AccessState = {
  adminBlocked: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string | null;
  lockdown: GateState;
  maintenance: GateState;
  revision: string;
  fileShas: Record<string, string>;
  adapter: string;
};

export type CatalogRead = {
  games: GameRecord[];
  products: ProductRecord[];
  categories: CategoryRecord[];
  revision: string;
  fileShas: Record<string, string>;
  adapter: string;
};

export type StoreSettings = {
  storeName: string;
  whatsappNumber: string;
  currency: "IDR";
  locale: "id-ID";
  announcement?: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  supportNote?: string;
};

// ---------------------------------------------------------------------------
// Site-features (v1.3.0): promo, banner, obrolan, tugas, analitik.
// ---------------------------------------------------------------------------

export type PromoRecord = {
  id: string;
  title: string;
  scope: "global" | "game";
  gameId?: string;
  percentOff: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string;
};

export type BannerRecord = {
  id: string;
  severity: "info" | "sukses" | "peringatan" | "penting";
  title: string;
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
};

export type ScheduleRecord = {
  id: string;
  label: string;
  type: string;
  payload: Record<string, unknown>;
  runAt: string;
  status: "pending" | "done" | "failed" | "cancelled";
  createdAt: string;
  createdBy: string;
  lastResult?: string;
  completedAt?: string;
};

export type ConversationRecord = {
  id: string;
  name: string | null;
  createdAt: string;
  lastMessageAt: string;
  unreadByOwner: number;
  messageCount: number;
  lastText: string;
  lastFrom: "user" | "owner" | null;
  messages: Array<{ id: string; from: "user" | "owner"; text: string; at: string }>;
};

export type AnalyticsSummaryDto = {
  today: { views: number; uniques: number; events: Record<string, number> };
  last7: { views: number; uniques: number; events: Record<string, number> };
  live: number;
  totalViews: number;
  topPages: Array<{ path: string; views: number }>;
  topReferrers: Array<{ referrer: string; views: number }>;
  devices: Array<{ device: string; views: number }>;
};

export type CheckoutTemplate = { template: string; updatedAt?: string; updatedBy?: string };

export type Operation =
  | { type: "game.create"; payload: GameRecord }
  | { type: "game.update"; id: string; payload: GameRecord }
  | { type: "product.create"; payload: ProductRecord }
  | { type: "product.update"; id: string; payload: ProductRecord }
  | { type: "category.create"; payload: CategoryRecord }
  | { type: "category.update"; id: string; payload: CategoryRecord };

export class NexaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "NexaError";
  }
}

type Envelope = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string } };

/** Sesi cookie HMAC — satu per target API (produksi + sandbox). */
class Session {
  cookie: string | null = null;
  exp = 0;

  valid(): boolean {
    return this.cookie !== null && this.exp > Date.now() + 60_000;
  }
}

const sessions = new Map<string, Session>();

function sessionFor(base: string): Session {
  let s = sessions.get(base);
  if (!s) {
    s = new Session();
    sessions.set(base, s);
  }
  return s;
}

function parseSessionExp(cookie: string): number {
  try {
    const body = cookie.split(".")[0];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

export async function login(base: string = config.apiBase): Promise<void> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: config.devEmail, password: config.devPassword }),
  });
  const json = (await res.json()) as Envelope;
  if (!json.ok) {
    const err = json.error;
    if (res.status === 429) {
      throw new NexaError(err.code, `Login dibatasi: ${err.message}. Coba lagi nanti.`, 429, true);
    }
    throw new NexaError(err.code, `Login gagal: ${err.message}`, res.status);
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  const nexa = cookies.find((c) => c.startsWith("nexa_session="));
  if (!nexa) {
    throw new NexaError("no-cookie", "Server tidak mengirim cookie sesi.", 500);
  }
  const s = sessionFor(base);
  s.cookie = nexa.split(";")[0];
  s.exp = parseSessionExp(s.cookie);
}

async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  allowRelogin = true,
  base: string = config.apiBase
): Promise<Record<string, unknown>> {
  const s = sessionFor(base);
  if (!s.valid()) await login(base);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(s.cookie ? { cookie: s.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({ ok: false as const, error: { code: "bad-json", message: "Respons server tidak valid." } }))) as Envelope;
  if (!json.ok) {
    // Sesi kedaluwarsa di tengah jalan → login ulang sekali lalu ulang permintaan.
    if (res.status === 401 && allowRelogin) {
      s.cookie = null;
      await login(base);
      return request(method, path, body, false, base);
    }
    const err = json.error;
    throw new NexaError(err.code, err.message, res.status, res.status === 409);
  }
  return json.data;
}

/** GET/POST dengan satu kali percobaan ulang saat konflik revisi (409). */
async function withConflictRetry<T>(read: () => Promise<T>, write: (fresh: T) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const first = await read();
  try {
    return await write(first);
  } catch (e) {
    if (e instanceof NexaError && e.retryable) {
      const fresh = await read();
      return write(fresh);
    }
    throw e;
  }
}

export async function getAccess(): Promise<AccessState> {
  const data = await request("GET", "/api/developer/access");
  return data as unknown as AccessState;
}

export async function getCatalog(): Promise<CatalogRead> {
  const data = await request("GET", "/api/management/catalog");
  return data as unknown as CatalogRead;
}

export async function getSettings(): Promise<{ settings: StoreSettings; checkoutTemplate: CheckoutTemplate; revision: string; fileShas: Record<string, string> }> {
  const data = await request("GET", "/api/management/settings");
  return data as unknown as { settings: StoreSettings; checkoutTemplate: CheckoutTemplate; revision: string; fileShas: Record<string, string> };
}

export type GateKey = "lockdown" | "maintenance";

/** Aktifkan/matiakan gate (lockdown/maintenance) dengan scope + catatan. */
export async function setGate(
  gate: GateKey,
  active: boolean,
  scope: "all" | "routes",
  routes: string[],
  note?: string
): Promise<Record<string, unknown>> {
  return withConflictRetry(
    () => getAccess(),
    (fresh) =>
      request("POST", "/api/developer/access", {
        baseRevision: fresh.revision,
        baseFileShas: fresh.fileShas,
        siteControl: {
          [gate]: {
            active,
            scope,
            routes: scope === "routes" ? routes : [],
            ...(note?.trim() ? { note: note.trim() } : {}),
          },
        },
      })
  );
}

/** Blokir / buka blokir akun admin. */
export async function setAdminBlocked(blocked: boolean, reason?: string): Promise<Record<string, unknown>> {
  return withConflictRetry(
    () => getAccess(),
    (fresh) =>
      request("POST", "/api/developer/access", {
        baseRevision: fresh.revision,
        baseFileShas: fresh.fileShas,
        adminBlocked: blocked,
        ...(blocked && reason?.trim() ? { reason: reason.trim() } : {}),
      })
  );
}

/**
 * Terapkan operasi katalog (create/update game/produk/kategori).
 * Bentuk operasi divalidasi ulang oleh zod di sisi aplikasi — klien cukup
 * mengirim struktur longgar yang benar.
 */
export async function mutate(operations: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  return withConflictRetry(
    () => getCatalog(),
    (fresh) =>
      request("POST", "/api/management/catalog", {
        baseRevision: fresh.revision,
        baseFileShas: fresh.fileShas,
        operations,
      })
  );
}

/** Simpan setelan store (WA/announcement) — template checkout diteruskan apa adanya. */
export async function saveSettings(settings: StoreSettings): Promise<Record<string, unknown>> {
  return withConflictRetry(
    () => getSettings(),
    (fresh) =>
      request("POST", "/api/management/settings", {
        baseRevision: fresh.revision,
        baseFileShas: fresh.fileShas,
        settings,
        checkoutTemplate: fresh.checkoutTemplate,
      })
  );
}

/** Probe publik (tanpa sesi) — untuk cek kesehatan gate & uptime. */
export async function publicStoreStatus(): Promise<{
  lockdown: { active: boolean; scope: string; routes: string[]; reason: string | null };
  maintenance: { active: boolean; scope: string; routes: string[]; message: string | null };
}> {
  const res = await fetch(`${config.apiBase}/api/store-status`, { method: "GET" });
  const json = (await res.json()) as { ok: boolean; data?: Record<string, unknown> };
  if (!json.ok || !json.data) throw new NexaError("unhealthy", "Endpoint store-status tidak merespons dengan baik.", 502);
  return json.data as never;
}

// ---------------------------------------------------------------------------
// Site-features API (v1.3.0)
// ---------------------------------------------------------------------------

export async function getPromos(): Promise<PromoRecord[]> {
  const data = await request("GET", "/api/developer/promos");
  return (data.promos as PromoRecord[]) ?? [];
}

export async function createPromo(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("POST", "/api/developer/promos", body);
}

export async function patchPromo(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("PATCH", "/api/developer/promos", { id, ...patch });
}

export async function deletePromo(id: string): Promise<Record<string, unknown>> {
  return request("DELETE", `/api/developer/promos?id=${encodeURIComponent(id)}`);
}

export async function getBanners(): Promise<BannerRecord[]> {
  const data = await request("GET", "/api/developer/banners");
  return (data.banners as BannerRecord[]) ?? [];
}

export async function createBanner(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("POST", "/api/developer/banners", body);
}

export async function patchBanner(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("PATCH", "/api/developer/banners", { id, ...patch });
}

export async function getSchedules(): Promise<ScheduleRecord[]> {
  const data = await request("GET", "/api/developer/schedules");
  return (data.tasks as ScheduleRecord[]) ?? [];
}

export async function createSchedule(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("POST", "/api/developer/schedules", body);
}

export async function patchSchedule(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("PATCH", "/api/developer/schedules", { id, ...patch });
}

export async function deleteSchedule(id: string): Promise<Record<string, unknown>> {
  return request("DELETE", `/api/developer/schedules?id=${encodeURIComponent(id)}`);
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummaryDto> {
  return request("GET", "/api/developer/analytics") as Promise<AnalyticsSummaryDto>;
}

export async function getChatConversations(base?: string): Promise<ConversationRecord[]> {
  const data = await request("GET", "/api/developer/chat", undefined, true, base ?? config.apiBase);
  return (data.conversations as ConversationRecord[]) ?? [];
}

export async function chatReply(conversationId: string, text: string, base?: string): Promise<Record<string, unknown>> {
  return request(
    "POST",
    "/api/developer/chat",
    { action: "reply", conversationId, text },
    true,
    base ?? config.apiBase
  );
}

export async function chatMarkRead(conversationId: string, base?: string): Promise<Record<string, unknown>> {
  return request(
    "POST",
    "/api/developer/chat",
    { action: "markRead", conversationId },
    true,
    base ?? config.apiBase
  );
}

export async function chatClearOne(conversationId: string, base?: string): Promise<Record<string, unknown>> {
  return request(
    "POST",
    "/api/developer/chat",
    { action: "clearOne", conversationId },
    true,
    base ?? config.apiBase
  );
}

export async function chatClearAll(base?: string): Promise<Record<string, unknown>> {
  return request("POST", "/api/developer/chat", { action: "clearAll" }, true, base ?? config.apiBase);
}

// ---------------------------------------------------------------------------
// Pesanan terlacak (v1.6.0)
// ---------------------------------------------------------------------------

export type TrackedOrder = {
  id: string;
  summary: string;
  source: "instant" | "cart";
  items: Array<{ gameName: string; productName: string; price: number }>;
  total: number;
  status: "pending" | "processing" | "success" | "cancel";
  statusReason: string | null;
  statusUpdatedAt: string | null;
  createdAt: string;
  history: Array<{ status: "pending" | "processing" | "success" | "cancel"; at: string; reason: string | null }>;
};

/** Lacak pesanan via endpoint publik — tanpa sesi, jalan di base mana pun. */
export async function orderTrack(orderId: string, base?: string): Promise<TrackedOrder | null> {
  try {
    const res = await fetch(
      `${(base ?? config.apiBase).replace(/\/+$/, "")}/api/orders/track?id=${encodeURIComponent(orderId)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data?: TrackedOrder };
    return json.ok && json.data ? json.data : null;
  } catch {
    return null;
  }
}

/** Ubah status + keterangan pesanan (perlu sesi admin/developer). */
export async function orderSetStatus(
  orderId: string,
  status: "pending" | "processing" | "success" | "cancel",
  reason: string,
  base?: string
): Promise<Record<string, unknown>> {
  return request(
    "PATCH",
    "/api/developer/orders",
    { id: orderId, status, reason: reason || undefined },
    true,
    base ?? config.apiBase
  );
}
