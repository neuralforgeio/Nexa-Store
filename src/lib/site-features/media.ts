import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { githubConfigFromEnv, type GitHubConfig } from "@/lib/catalog/repo/github";
import { circuitBreaker } from "@/lib/circuit-breaker";

/**
 * Penyimpanan media laporan (v1.8.0) — data/media/reports/<id>.<ext>.
 *
 * Kontrak dual-mode sama dengan site-features/store: filesystem lokal di
 * sandbox, GitHub Contents API (write-through) di produksi. Sebelum v1.8.0
 * byte media tidak pernah disimpan (hanya diteruskan ke Telegram) — mulai
 * versi ini media tersimpan permanen dan bisa dilihat di konsol laporan.
 *
 * Semua akses GitHub berjalan di bawah circuit breaker "github-api":
 * kegagalan beruntun memutus sirkuit lebih cepat daripada menunggu
 * timeout per-request, sehingga tidak menghambat request lain.
 */

const MEDIA_DIR = "data/media/reports";
const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;

const githubBreaker = circuitBreaker("github-api", { cooldownMs: 60_000 });

/** Ekstensi aman dari nama file / mime (whitelist — tidak pernah pakai input mentah). */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function reportMediaExt(fileName: string, mime: string): string {
  const fromMime = EXT_BY_MIME[mime.split(";")[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  const m = /\.([a-z0-9]{1,5})$/i.exec(fileName.trim());
  const ext = m?.[1]?.toLowerCase();
  return ext && /^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin";
}

function config(): GitHubConfig | null {
  return githubConfigFromEnv();
}

export function reportMediaMode(): "local" | "github" {
  return config() ? "github" : "local";
}

function mediaPath(id: string, ext: string): string {
  if (!/^[a-z0-9_:-]{3,40}$/i.test(id)) throw new Error("ID media tidak valid.");
  return `${MEDIA_DIR}/${id}.${ext}`;
}

async function ghFetch(path: string, init?: RequestInit): Promise<Response> {
  const cfg = config();
  if (!cfg) throw new Error("Konfigurasi GitHub tidak tersedia.");
  return githubBreaker.run(async () =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nexa-store-media",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  );
}

/** Simpan byte media laporan. Throw saat gagal — pemanggil menentukan fallback. */
export async function writeReportMedia(
  id: string,
  fileName: string,
  mime: string,
  bytes: Buffer
): Promise<void> {
  const ext = reportMediaExt(fileName, mime);
  const rel = mediaPath(id, ext);

  const cfg = config();
  if (!cfg) {
    const abs = join(process.cwd(), rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    return;
  }

  const res = await ghFetch(`/repos/${cfg.owner}/${cfg.repository}/contents/${rel}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Commit data — prefix media: di-skip vercel.json ignoreCommand.
      message: `media: report ${id}`,
      content: bytes.toString("base64"),
      branch: cfg.branch,
      committer: { name: cfg.committerName, email: cfg.committerEmail },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gagal menyimpan media laporan (HTTP ${res.status}).`);
  }
}

/** Baca byte media laporan. null bila tidak ada / tidak terbaca. */
export async function readReportMedia(id: string, fileName: string, mime: string): Promise<Buffer | null> {
  const ext = reportMediaExt(fileName, mime);
  const rel = mediaPath(id, ext);

  const cfg = config();
  if (!cfg) {
    const abs = join(process.cwd(), rel);
    if (!existsSync(abs)) return null;
    try {
      return readFileSync(abs);
    } catch {
      return null;
    }
  }

  try {
    const url = `/repos/${cfg.owner}/${cfg.repository}/contents/${rel}?ref=${encodeURIComponent(cfg.branch)}`;
    // Accept raw: file > 1MB tidak bisa lewat representasi JSON contents API.
    const res = await ghFetch(url, { headers: { Accept: "application/vnd.github.raw" } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    // breaker terbuka / jaringan gagal → media dianggap tidak tersedia dulu
    return null;
  }
}

/** Hapus file media (best-effort — laporan tetap terhapus walau ini gagal). */
export async function deleteReportMedia(id: string, fileName: string, mime: string): Promise<boolean> {
  const ext = reportMediaExt(fileName, mime);
  const rel = mediaPath(id, ext);

  const cfg = config();
  if (!cfg) {
    const abs = join(process.cwd(), rel);
    if (!existsSync(abs)) return true;
    try {
      unlinkSync(abs);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const repoPath = `/repos/${cfg.owner}/${cfg.repository}/contents/${rel}`;
    const head = await ghFetch(`${repoPath}?ref=${encodeURIComponent(cfg.branch)}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (head.status === 404) return true;
    if (!head.ok) return false;
    const meta = (await head.json()) as { sha?: string };
    if (!meta.sha) return false;

    const res = await ghFetch(repoPath, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `media: remove ${id}`,
        sha: meta.sha,
        branch: cfg.branch,
        committer: { name: cfg.committerName, email: cfg.committerEmail },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
