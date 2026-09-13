import type { CanonicalFileKey } from "../types";
import type { CatalogSnapshot } from "../schema";

/**
 * CatalogRepository boundary (PRD §55). The storefront depends on this
 * interface, never on adapter internals — GitHub can later become Postgres
 * without touching UI (PRD §54).
 */

export type FileShas = Record<CanonicalFileKey, string>;

export type SnapshotRead = {
  snapshot: CatalogSnapshot;
  fileShas: FileShas;
  /** Opaque revision token — the optimistic-concurrency base for mutations. */
  revision: string;
  adapter: "local" | "github";
  readAt: string;
};

export type WriteResult = {
  revision: string;
  commitMessage: string;
  files: CanonicalFileKey[];
  writtenAt: string;
};

export type HistoryEntry = {
  revision: string;
  message: string;
  at: string;
  author: string;
};

export type AdapterHealth = {
  adapter: "local" | "github";
  ok: boolean;
  detail: string;
};

export type RepoErrorKind =
  | "conflict"
  | "auth"
  | "not-found"
  | "rate-limit"
  | "network"
  | "validation"
  | "io";

export class RepoError extends Error {
  constructor(
    public readonly kind: RepoErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "RepoError";
  }
}

export interface CatalogRepository {
  readonly adapter: "local" | "github";

  /** Reads + validates (Zod + integrity) all canonical files. */
  readSnapshot(): Promise<SnapshotRead>;

  /**
   * Writes the given canonical files as one logical commit.
   * Fails with RepoError(conflict) when the store changed since the caller's
   * read (baseRevision mismatch or per-file SHA drift). Never overwrites silently.
   */
  writeFiles(input: {
    files: Partial<Record<CanonicalFileKey, string>>;
    baseRevision: string;
    baseFileShas: FileShas;
    message: string;
    author: { name: string; email: string };
  }): Promise<WriteResult>;

  /** Recent commits touching catalog data (developer tooling). */
  history(limit?: number): Promise<HistoryEntry[]>;

  /** Reads one canonical file at a historical revision (rollback inspection, PRD §43). */
  readFileAt(ref: string, key: CanonicalFileKey): Promise<unknown>;

  health(): Promise<AdapterHealth>;
}
