import type { CanonicalFileKey } from "../types";
import type { CatalogSnapshot } from "../schema";
import { CANONICAL_FILES } from "../types";
import { validateFile } from "../schema";
import { validateCatalogIntegrity } from "../validation";
import { createHash } from "node:crypto";
import type {
  CatalogRepository,
  FileShas,
  SnapshotRead,
  WriteResult,
  HistoryEntry,
  AdapterHealth,
} from "./types";
import { RepoError } from "./types";

/**
 * GitHub-backed persistence adapter (PRD §18, §30.3).
 * - Repo/branch/owner resolved ONLY from server env (never client input).
 * - Writes only to the canonical path allowlist.
 * - Conflict detection is CONTENT-level: per-file blob SHA comparison plus
 *   an atomic force:false ref update (PRD §18.3). The branch head moves
 *   whenever runtime write-through commits land (analytics, orders, chat,
 *   bot state) — those never touch catalog files, so a moved head alone
 *   must NOT be treated as a catalog conflict.
 * - Multi-file batch = one commit (Git Data API: blobs → tree → commit → ref).
 * - GitHub error bodies are never surfaced raw to end users.
 *
 * NOTE (A2): live GitHub calls are executed only when GITHUB_* env is fully
 * configured; unit tests exercise this adapter with injected fetch mocks.
 */

const API = "https://api.github.com";
const TIMEOUT_MS = 15000;
const ALL_KEYS = Object.keys(CANONICAL_FILES) as CanonicalFileKey[];

/**
 * Deterministic git blob SHA (`blob <len>\0<content>`) — the same value
 * GitHub reports for the stored file, computable without an extra API call.
 */
function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.from(`blob ${body.byteLength}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
}

export type GitHubConfig = {
  owner: string;
  repository: string;
  branch: string;
  token: string;
  committerName: string;
  committerEmail: string;
};

export function githubConfigFromEnv(): GitHubConfig | null {
  const owner = process.env.GITHUB_OWNER?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const branch = process.env.GITHUB_BRANCH?.trim() || "main";
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!owner || !repository || !token) return null;
  return {
    owner,
    repository,
    branch,
    token,
    committerName: process.env.GITHUB_COMMITTER_NAME?.trim() || "Nexa Store Bot",
    committerEmail: process.env.GITHUB_COMMITTER_EMAIL?.trim() || "bot@nexa-store.local",
  };
}

type GHResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
};

export class GitHubCatalogRepository implements CatalogRepository {
  readonly adapter = "github" as const;
  /** Injectable for tests (A2: no live network in automated tests). */
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: GitHubConfig,
    fetchImpl?: typeof fetch
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private async api<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<GHResponse<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${this.config.token}`,
          "User-Agent": "nexa-store-persistence",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new RepoError("network", "Koneksi ke GitHub gagal. Coba lagi sebentar lagi.");
    }

    if (res.status === 401) {
      throw new RepoError("auth", "Kredensial GitHub tidak valid atau kedaluwarsa.");
    }
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new RepoError("rate-limit", "Batas laju GitHub tercapai. Tunggu sebentar sebelum mencoba lagi.");
      }
      throw new RepoError(
        "auth",
        "Token GitHub tidak memiliki izin yang dibutuhkan untuk operasi ini."
      );
    }
    if (res.status === 404) {
      throw new RepoError(
        "not-found",
        "Repositori, cabang, atau berkas tidak ditemukan. Periksa konfigurasi GITHUB_*."
      );
    }
    if (res.status === 409) {
      throw new RepoError("conflict", "Data berubah di GitHub sejak dibaca. Muat ulang dan coba lagi.");
    }
    if (res.status >= 400) {
      throw new RepoError("network", `GitHub menolak operasi (HTTP ${res.status}).`);
    }

    const text = await res.text();
    const data = (text.length ? JSON.parse(text) : {}) as T;
    return { status: res.status, data, headers: res.headers };
  }

  private repoPath(): string {
    return `/repos/${this.config.owner}/${this.config.repository}`;
  }

  private async branchHeadSha(): Promise<string> {
    type RefResponse = { object: { sha: string } };
    const res = await this.api<RefResponse>("GET", `${this.repoPath()}/git/ref/heads/${this.config.branch}`);
    return res.data.object.sha;
  }

  async readSnapshot(): Promise<SnapshotRead> {
    const head = await this.branchHeadSha();
    const readAt = new Date().toISOString();
    const snapshot = {} as Record<CanonicalFileKey, unknown>;
    const fileShas = {} as FileShas;

    for (const key of ALL_KEYS) {
      type ContentsResponse = { sha: string; content: string; encoding: string };
      const res = await this.api<ContentsResponse>(
        "GET",
        `${this.repoPath()}/contents/${CANONICAL_FILES[key]}?ref=${encodeURIComponent(head)}`
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(res.data.content, "base64").toString("utf8"));
      } catch (e) {
        throw new RepoError("validation", `Berkas ${CANONICAL_FILES[key]} tidak berisi JSON valid.`);
      }
      const result = validateFile(key, parsed);
      if (!result.ok) {
        const first = result.issues[0];
        throw new RepoError(
          "validation",
          `${CANONICAL_FILES[key]} → ${first.recordId ? `record ${first.recordId} ` : ""}${first.field ?? ""}: ${first.reason}`
        );
      }
      snapshot[key] = result.data;
      fileShas[key] = res.data.sha; // GitHub blob SHA
    }

    const assembled = snapshot as unknown as {
      games: { games: CatalogSnapshot["games"] };
      products: { products: CatalogSnapshot["products"] };
      categories: { categories: CatalogSnapshot["categories"] };
      settings: CatalogSnapshot["settings"];
      "checkout-template": CatalogSnapshot["checkoutTemplate"];
      "access-control": CatalogSnapshot["accessControl"];
    };
    const full: CatalogSnapshot = {
      games: assembled.games.games,
      products: assembled.products.products,
      categories: assembled.categories.categories,
      settings: assembled.settings,
      checkoutTemplate: assembled["checkout-template"],
      accessControl: assembled["access-control"],
    };
    const integrity = validateCatalogIntegrity(full);
    if (!integrity.ok) {
      const first = integrity.issues[0];
      throw new RepoError(
        "validation",
        `Integritas katalog: ${first.file}${first.recordId ? ` (${first.recordId})` : ""} — ${first.reason}`
      );
    }

    return { snapshot: full, fileShas, revision: head, adapter: "github", readAt };
  }

  async writeFiles(input: {
    files: Partial<Record<CanonicalFileKey, string>>;
    baseRevision: string;
    baseFileShas: FileShas;
    message: string;
    author: { name: string; email: string };
  }): Promise<WriteResult> {
    const keys = Object.keys(input.files) as CanonicalFileKey[];
    if (keys.length === 0) throw new RepoError("validation", "Tidak ada berkas yang ditulis");

    for (const key of keys) {
      if (!(key in CANONICAL_FILES)) {
        throw new RepoError("validation", `Jalur berkas tidak diizinkan: ${key}`);
      }
      if (!input.baseFileShas[key]) {
        throw new RepoError(
          "conflict",
          `Basis revisi untuk ${CANONICAL_FILES[key]} tidak diketahui. Muat ulang data sebelum menyimpan lagi.`
        );
      }
    }

    type CommitResponse = { sha: string; tree: { sha: string } };
    type ContentsResponse = { sha: string; content: string; encoding: string };
    type BlobResponse = { sha: string };

    // Attempt loop: the branch head may move while we build the commit —
    // runtime write-through (analytics, orders, chat, bot state) commits
    // without touching catalog content. Content safety is guaranteed by
    // (1) the per-file blob SHA check below (mirrors the local adapter) and
    // (2) the atomic force:false ref update, which rejects a non-fast-forward
    // move; on that race we simply re-verify and retry on the new head.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const head = await this.branchHeadSha();

      // Content-level conflict detection for exactly the files being written.
      for (const key of keys) {
        const res = await this.api<ContentsResponse>(
          "GET",
          `${this.repoPath()}/contents/${CANONICAL_FILES[key]}?ref=${encodeURIComponent(head)}`
        );
        if (res.data.sha !== input.baseFileShas[key]) {
          throw new RepoError(
            "conflict",
            `Berkas ${CANONICAL_FILES[key]} berubah sejak dibaca. Muat ulang data sebelum menyimpan lagi.`
          );
        }
      }

      // Blobs for each changed file.
      const treeItems: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
      for (const key of keys) {
        const blob = await this.api<BlobResponse>("POST", `${this.repoPath()}/git/blobs`, {
          content: Buffer.from(input.files[key] as string, "utf8").toString("base64"),
          encoding: "base64",
        });
        treeItems.push({ path: CANONICAL_FILES[key], mode: "100644", type: "blob", sha: blob.data.sha });
      }

      // Tree based on current head tree (only changed paths are replaced).
      const headCommit = await this.api<CommitResponse>("GET", `${this.repoPath()}/git/commits/${head}`);
      const tree = await this.api<{ sha: string }>("POST", `${this.repoPath()}/git/trees`, {
        base_tree: headCommit.data.tree.sha,
        tree: treeItems,
      });

      const commit = await this.api<CommitResponse>("POST", `${this.repoPath()}/git/commits`, {
        message: input.message,
        tree: tree.data.sha,
        parents: [head],
        author: {
          name: input.author.name,
          email: input.author.email,
          date: new Date().toISOString(),
        },
      });

      try {
        await this.api<RefResponse2>("PATCH", `${this.repoPath()}/git/refs/heads/${this.config.branch}`, {
          sha: commit.data.sha,
          force: false,
        });
        // New blob SHA per written file so clients can advance their base
        // immediately instead of false-conflicting on the next save while
        // the post-save refetch is still in flight.
        const writtenFileShas: Partial<Record<CanonicalFileKey, string>> = {};
        for (const key of keys) {
          writtenFileShas[key] = gitBlobSha(input.files[key] as string);
        }
        return {
          revision: commit.data.sha,
          commitMessage: input.message,
          files: keys,
          writtenAt: new Date().toISOString(),
          writtenFileShas,
        };
      } catch (e) {
        const retryable =
          e instanceof RepoError &&
          e.kind !== "auth" &&
          e.kind !== "rate-limit" &&
          e.kind !== "validation";
        if (!retryable || attempt === maxAttempts) {
          if (retryable) {
            // The ref kept moving under us (e.g. busy runtime traffic).
            // Surface a conflict so the client reloads and re-applies.
            throw new RepoError(
              "conflict",
              "Data berubah di repository saat penyimpanan berlangsung. Muat ulang data lalu coba lagi."
            );
          }
          throw e;
        }
        // Ref moved mid-write → re-verify blob SHAs against the new head.
      }
    }

    throw new RepoError("network", "Penyimpanan tidak dapat diselesaikan. Coba lagi sebentar lagi.");
  }

  async history(limit = 20): Promise<HistoryEntry[]> {
    type CommitList = Array<{
      sha: string;
      commit: { message: string; author: { name: string; date: string } };
    }>;
    const res = await this.api<CommitList>(
      "GET",
      `${this.repoPath()}/commits?path=data&per_page=${Math.min(limit, 50)}`
    );
    return res.data.map((c) => ({
      revision: c.sha,
      message: c.commit.message.split("\n")[0],
      at: c.commit.author?.date ?? "",
      author: c.commit.author?.name ?? "unknown",
    }));
  }

  async readFileAt(ref: string, key: CanonicalFileKey): Promise<unknown> {
    if (!/^[0-9a-f]{7,40}$/i.test(ref)) {
      throw new RepoError("validation", "Referensi revisi tidak valid");
    }
    type ContentsResponse = { content: string };
    const res = await this.api<ContentsResponse>(
      "GET",
      `${this.repoPath()}/contents/${CANONICAL_FILES[key]}?ref=${ref}`
    );
    return JSON.parse(Buffer.from(res.data.content, "base64").toString("utf8"));
  }

  async health(): Promise<AdapterHealth> {
    try {
      type RepoResponse = { permissions?: { push?: boolean }; full_name: string; default_branch: string };
      const res = await this.api<RepoResponse>("GET", this.repoPath());
      const canPush = res.data.permissions?.push !== false;
      return {
        adapter: "github",
        ok: canPush,
        detail: canPush
          ? `Terhubung ke ${res.data.full_name} (cabang ${this.config.branch}) dengan akses tulis.`
          : `Terhubung ke ${res.data.full_name} tetapi token tidak memiliki izin tulis.`,
      };
    } catch (e) {
      if (e instanceof RepoError) {
        return { adapter: "github", ok: false, detail: e.message };
      }
      return { adapter: "github", ok: false, detail: "Status GitHub tidak dapat diverifikasi." };
    }
  }
}

type RefResponse2 = { object: { sha: string } };
