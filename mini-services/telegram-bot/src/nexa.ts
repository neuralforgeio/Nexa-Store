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

/** Sesi cookie HMAC — diperbarui otomatis menjelang kedaluwarsa (TTL 8 jam). */
class Session {
  cookie: string | null = null;
  exp = 0;

  valid(): boolean {
    return this.cookie !== null && this.exp > Date.now() + 60_000;
  }
}

const session = new Session();

function parseSessionExp(cookie: string): number {
  try {
    const body = cookie.split(".")[0];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

export async function login(): Promise<void> {
  const res = await fetch(`${config.apiBase}/api/auth/login`, {
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
  session.cookie = nexa.split(";")[0];
  session.exp = parseSessionExp(session.cookie);
}

async function request(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  allowRelogin = true
): Promise<Record<string, unknown>> {
  if (!session.valid()) await login();
  const res = await fetch(`${config.apiBase}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session.cookie ? { cookie: session.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({ ok: false as const, error: { code: "bad-json", message: "Respons server tidak valid." } }))) as Envelope;
  if (!json.ok) {
    // Sesi kedaluwarsa di tengah jalan → login ulang sekali lalu ulang permintaan.
    if (res.status === 401 && allowRelogin) {
      session.cookie = null;
      await login();
      return request(method, path, body, false);
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
