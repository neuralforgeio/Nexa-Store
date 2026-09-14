import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { githubConfigFromEnv, type GitHubConfig } from "@/lib/catalog/repo/github";
import { circuitBreaker, CircuitOpenError } from "@/lib/circuit-breaker";
import {
  EMPTY_ANALYTICS,
  EMPTY_BANNERS,
  EMPTY_BOT_STATE,
  EMPTY_CHAT,
  EMPTY_ORDERS,
  EMPTY_PROMOS,
  EMPTY_PUSH_SUBS,
  EMPTY_REPORTS,
  EMPTY_SCHEDULES,
  parseAnalytics,
  parseBanners,
  parseChat,
  parsePromos,
  parseSchedules,
  analyticsFileSchema,
  bannersFileSchema,
  botStateFileSchema,
  chatFileSchema,
  ordersFileSchema,
  promosFileSchema,
  pushSubsFileSchema,
  reportsFileSchema,
  schedulesFileSchema,
} from "./schema";
import type { AnalyticsFile } from "./types";
import type { BannersFile, ChatFile, PromosFile, SchedulesFile } from "./schema";

/**
 * Site-features persistence (v1.3.0).
 *
 * Same dual-mode contract as the catalog repository: local filesystem in the
 * sandbox, GitHub Contents API (write-through) in production. Unlike the
 * catalog, unknown/absent files bootstrap to safe defaults — a bad analytics
 * day must never take the storefront down.
 *
 * All commits are prefixed store:/chat:/analytics:/ops: so vercel.json's
 * ignoreCommand skips rebuilds (data is read at runtime, no rebuild needed).
 */

export type FeatureKey =
  | "promos"
  | "banners"
  | "schedules"
  | "chat"
  | "analytics"
  | "bot-state"
  | "reports"
  | "orders"
  | "push-subs";

const FILES: Record<FeatureKey, string> = {
  promos: "data/store/promos.json",
  banners: "data/store/banners.json",
  schedules: "data/store/schedules.json",
  chat: "data/store/chat.json",
  analytics: "data/store/analytics.json",
  "bot-state": "data/store/bot-state.json",
  reports: "data/store/reports.json",
  orders: "data/store/orders.json",
  "push-subs": "data/store/push-subs.json",
};

const API = "https://api.github.com";
const TIMEOUT_MS = 12000;
const READ_CACHE_TTL_MS = 3000;

/**
 * Circuit breaker GitHub (v1.8.0): kegagalan beruntun memutus sirkuit —
 * request berikutnya fail-fast tanpa menunggu timeout 12 dtk, sehingga
 * masalah di GitHub tidak menjalar memperlambat seluruh website.
 */
const githubBreaker = circuitBreaker("github-api", { cooldownMs: 60_000 });

export type FeaturesBundle = {
  promos: PromosFile;
  banners: BannersFile;
  schedules: SchedulesFile;
  chat: ChatFile;
  analytics: AnalyticsFile;
};

export class FeatureStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeatureStoreError";
  }
}

// ---------------------------------------------------------------------------
// GitHub transport (contents API, ETag-aware)
// ---------------------------------------------------------------------------

type CachedFile = { raw: string; sha: string | null; etag: string | null; at: number };
const fileCache = new Map<FeatureKey, CachedFile>();

function ghConfig(): GitHubConfig | null {
  return githubConfigFromEnv();
}

export function featuresMode(): "local" | "github" {
  return ghConfig() ? "github" : "local";
}

async function ghFetch(cfg: GitHubConfig, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await githubBreaker.run(() =>
      fetch(`${API}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${cfg.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nexa-store-features",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    );
  } catch (e) {
    if (e instanceof CircuitOpenError) throw e;
    throw new FeatureStoreError("Koneksi ke GitHub gagal. Coba lagi sebentar lagi.");
  }
}

async function readRaw(key: FeatureKey, forceFresh = false): Promise<CachedFile> {
  const cfg = ghConfig();
  const path = FILES[key];

  if (!cfg) {
    const abs = join(process.cwd(), path);
    if (!existsSync(abs)) return { raw: "", sha: null, etag: null, at: Date.now() };
    return { raw: readFileSync(abs, "utf8"), sha: null, etag: null, at: Date.now() };
  }

  const cached = fileCache.get(key);
  if (!forceFresh && cached && Date.now() - cached.at < READ_CACHE_TTL_MS) return cached;

  const repoPath = `/repos/${cfg.owner}/${cfg.repository}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await ghFetch(cfg, repoPath, {
    headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
  });
  if (res.status === 304 && cached) {
    const refreshed = { ...cached, at: Date.now() };
    fileCache.set(key, refreshed);
    return refreshed;
  }
  if (res.status === 404) {
    const fresh: CachedFile = { raw: "", sha: null, etag: null, at: Date.now() };
    fileCache.set(key, fresh);
    return fresh;
  }
  if (res.status === 401 || res.status === 403) {
    throw new FeatureStoreError("Token GitHub ditolak untuk membaca data fitur.");
  }
  if (!res.ok) {
    throw new FeatureStoreError(`GitHub menolak pembacaan data (HTTP ${res.status}).`);
  }
  type ContentsResponse = { sha: string; content: string; encoding: string };
  const data = (await res.json()) as ContentsResponse;
  const raw = data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : data.content;
  const fresh: CachedFile = { raw, sha: data.sha, etag: res.headers.get("etag"), at: Date.now() };
  fileCache.set(key, fresh);
  return fresh;
}

async function writeRaw(key: FeatureKey, raw: string, message: string, expectSha: string | null): Promise<string | null> {
  const cfg = ghConfig();
  const path = FILES[key];

  if (!cfg) {
    const abs = join(process.cwd(), path);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, raw, "utf8");
    renameSync(tmp, abs);
    return null;
  }

  const res = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repository}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(raw, "utf8").toString("base64"),
      branch: cfg.branch,
      committer: { name: cfg.committerName, email: cfg.committerEmail },
      ...(expectSha ? { sha: expectSha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new FeatureStoreError("conflict");
  }
  if (res.status === 401 || res.status === 403) {
    throw new FeatureStoreError("Token GitHub tidak memiliki izin tulis untuk data fitur.");
  }
  if (!res.ok) {
    throw new FeatureStoreError(`GitHub menolak penulisan data (HTTP ${res.status}).`);
  }
  type PutResponse = { content: { sha: string } };
  const data = (await res.json()) as PutResponse;
  return data.content.sha;
}

function validate(key: FeatureKey, raw: string): void {
  const data = JSON.parse(raw);
  const check =
    key === "promos"
      ? promosFileSchema.safeParse(data)
      : key === "banners"
        ? bannersFileSchema.safeParse(data)
        : key === "schedules"
          ? schedulesFileSchema.safeParse(data)
          : key === "chat"
            ? chatFileSchema.safeParse(data)
            : key === "bot-state"
              ? botStateFileSchema.safeParse(data)
              : key === "reports"
                ? reportsFileSchema.safeParse(data)
                : key === "orders"
                  ? ordersFileSchema.safeParse(data)
                  : key === "push-subs"
                    ? pushSubsFileSchema.safeParse(data)
                    : analyticsFileSchema.safeParse(data);
  if (!check.success) {
    const issue = check.error?.issues?.[0];
    throw new FeatureStoreError(
      `Data fitur ${key} tidak valid: ${issue ? `${issue.path.join(".") || "root"} — ${issue.message}` : "tidak diketahui"}`
    );
  }
}

/**
 * Read-modify-write with one conflict retry (GitHub sha / local best-effort).
 * The mutation function receives the parsed current value and returns the next.
 */
export async function updateFeature<T>(
  key: FeatureKey,
  message: string,
  mutate: (current: unknown) => T,
  validateResult = true
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readRaw(key, attempt > 0);
    let parsed: unknown;
    try {
      parsed = current.raw ? JSON.parse(current.raw) : defaultFor(key);
    } catch {
      parsed = defaultFor(key);
    }
    const next = mutate(parsed);
    const raw = `${JSON.stringify(next, null, 2)}\n`;
    if (validateResult) validate(key, raw);
    try {
      const sha = await writeRaw(key, raw, message, current.sha);
      fileCache.set(key, { raw, sha, etag: null, at: Date.now() });
      return next;
    } catch (e) {
      if (e instanceof FeatureStoreError && e.message === "conflict" && attempt === 0) continue;
      throw e;
    }
  }
  throw new FeatureStoreError("Data fitur berubah di tengah penulisan. Coba lagi.");
}

function defaultFor(key: FeatureKey): unknown {
  switch (key) {
    case "promos":
      return EMPTY_PROMOS;
    case "banners":
      return EMPTY_BANNERS;
    case "schedules":
      return EMPTY_SCHEDULES;
    case "chat":
      return EMPTY_CHAT;
    case "analytics":
      return EMPTY_ANALYTICS;
    case "bot-state":
      return EMPTY_BOT_STATE;
    case "reports":
      return EMPTY_REPORTS;
    case "orders":
      return EMPTY_ORDERS;
    case "push-subs":
      return EMPTY_PUSH_SUBS;
  }
}

/** Parsed read of one feature file (missing/broken/GitHub down → safe default). */
export async function readFeature(key: FeatureKey): Promise<unknown> {
  // v1.8.0: pembacaan TIDAK PERNAH melempar error ke pemanggil — saat GitHub
  // down / circuit breaker terbuka, kembalikan default aman agar storefront
  // tetap hidup (kegagalan diisolasi, tidak merambat ke halaman). Penulisan
  // tetap melempar error agar request mutasi gagal secara eksplisit.
  let file: Awaited<ReturnType<typeof readRaw>>;
  try {
    file = await readRaw(key);
  } catch {
    return defaultFor(key);
  }
  try {
    return file.raw ? JSON.parse(file.raw) : defaultFor(key);
  } catch {
    return defaultFor(key);
  }
}

export async function readFeatures(): Promise<FeaturesBundle> {
  const [promos, banners, schedules, chat, analytics] = await Promise.all([
    readFeature("promos"),
    readFeature("banners"),
    readFeature("schedules"),
    readFeature("chat"),
    readFeature("analytics"),
  ]);
  return {
    promos: parsePromos(promos),
    banners: parseBanners(banners),
    schedules: parseSchedules(schedules),
    chat: parseChat(chat),
    analytics: parseAnalytics(analytics),
  };
}

// ---------------------------------------------------------------------------
// Ids + tokens
// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  return `${prefix}_${createHash("sha256")
    .update(`${Date.now()}:${Math.random()}:${process.pid}`)
    .digest("hex")
    .slice(0, 10)}`;
}

/** Conversation id = deterministic hash of the visitor token (never store raw). */
export function conversationIdForToken(token: string): string {
  return `c_${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}
