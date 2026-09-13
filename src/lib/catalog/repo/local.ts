import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { CanonicalFileKey, ValidationIssue } from "../types";
import type { CatalogSnapshot } from "../schema";
import { CANONICAL_FILES } from "../types";
import { validateFile, type CatalogSnapshot as Snapshot } from "../schema";
import { validateCatalogIntegrity } from "../validation";
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
 * Local filesystem adapter — sandbox/development persistence mode (A2).
 * Conflict detection: sha256 of serialized content + revision ledger.
 * Atomic writes via tmp+rename. Every write snapshots to .history for
 * rollback inspection (PRD §43).
 *
 * Canonical serialization keeps diffs reviewable and hashes deterministic.
 */

const HISTORY_LIMIT = 40;
const ALL_KEYS = Object.keys(CANONICAL_FILES) as CanonicalFileKey[];

type Ledger = {
  revision: number;
  lastSyncAt: string | null;
  lastCommitMessage: string | null;
};

export class LocalCatalogRepository implements CatalogRepository {
  readonly adapter = "local" as const;

  constructor(private readonly root: string = process.cwd()) {}

  private path(rel: string): string {
    return join(this.root, rel);
  }

  private ledgerPath(): string {
    return this.path("data/store/.sync.json");
  }

  private historyDir(): string {
    return this.path("data/store/.history");
  }

  private readLedger(): Ledger {
    try {
      const raw = readFileSync(this.ledgerPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<Ledger>;
      if (typeof parsed.revision === "number") {
        return {
          revision: parsed.revision,
          lastSyncAt: parsed.lastSyncAt ?? null,
          lastCommitMessage: parsed.lastCommitMessage ?? null,
        };
      }
    } catch {
      // absent ledger → bootstrap below
    }
    return { revision: 1, lastSyncAt: null, lastCommitMessage: null };
  }

  private writeLedger(ledger: Ledger): void {
    const dir = dirname(this.ledgerPath());
    mkdirSync(dir, { recursive: true });
    atomicWrite(this.ledgerPath(), `${JSON.stringify(ledger, null, 2)}\n`);
  }

  async readSnapshot(): Promise<SnapshotRead> {
    const readAt = new Date().toISOString();
    const snapshot = {} as Record<CanonicalFileKey, unknown>;
    const fileShas = {} as FileShas;

    for (const key of ALL_KEYS) {
      const abs = this.path(CANONICAL_FILES[key]);
      if (!existsSync(abs)) {
        throw new RepoError("not-found", `Berkas katalog tidak ditemukan: ${CANONICAL_FILES[key]}`);
      }
      const raw = readFileSync(abs, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new RepoError(
          "validation",
          `Berkas ${CANONICAL_FILES[key]} tidak dapat dibaca sebagai JSON: ${(e as Error).message}`
        );
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
      // File SHA mirrors the GitHub adapter semantics: hash of stored bytes.
      fileShas[key] = sha256(raw);
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

    return {
      snapshot: full,
      fileShas,
      revision: `local-${this.readLedger().revision}`,
      adapter: "local",
      readAt,
    };
  }

  async writeFiles(input: {
    files: Partial<Record<CanonicalFileKey, string>>;
    baseRevision: string;
    baseFileShas: FileShas;
    message: string;
    author: { name: string; email: string };
  }): Promise<WriteResult> {
    const ledger = this.readLedger();
    const currentRevision = `local-${ledger.revision}`;
    if (input.baseRevision !== currentRevision) {
      throw new RepoError(
        "conflict",
        "Data berubah di penyimpanan sejak halaman ini dibuka. Muat ulang data sebelum menyimpan lagi."
      );
    }

    const keys = Object.keys(input.files) as CanonicalFileKey[];
    if (keys.length === 0) throw new RepoError("validation", "Tidak ada berkas yang ditulis");

    // Per-file SHA drift check (defense in depth beyond revision).
    const current = this.readSnapshotRaw();
    for (const key of keys) {
      const currentSha = sha256(current[key]);
      if (input.baseFileShas[key] !== currentSha) {
        throw new RepoError(
          "conflict",
          `Berkas ${CANONICAL_FILES[key]} berubah sejak dibaca. Muat ulang data sebelum menyimpan lagi.`
        );
      }
    }

    // Validate proposed contents in full-snapshot context before writing (R6).
    const proposed = { ...current } as Record<CanonicalFileKey, string>;
    for (const key of keys) proposed[key] = input.files[key] as string;
    this.validateProposedSnapshot(proposed);

    // History snapshot BEFORE writing (rollback path, PRD §43).
    const historyEntry = {
      revision: currentRevision,
      at: new Date().toISOString(),
      message: ledger.lastCommitMessage ?? "initial",
      author: "system",
      files: current,
    };
    mkdirSync(this.historyDir(), { recursive: true });
    const historyName = `${String(ledger.revision).padStart(5, "0")}.json`;
    atomicWrite(join(this.historyDir(), historyName), JSON.stringify(historyEntry, null, 2));
    this.pruneHistory();

    for (const key of keys) {
      const abs = this.path(CANONICAL_FILES[key]);
      mkdirSync(dirname(abs), { recursive: true });
      atomicWrite(abs, input.files[key] as string);
    }

    const nextRevision = ledger.revision + 1;
    const writtenAt = new Date().toISOString();
    this.writeLedger({
      revision: nextRevision,
      lastSyncAt: writtenAt,
      lastCommitMessage: input.message,
    });

    return {
      revision: `local-${nextRevision}`,
      commitMessage: input.message,
      files: keys,
      writtenAt,
    };
  }

  async history(limit = 20): Promise<HistoryEntry[]> {
    if (!existsSync(this.historyDir())) return [];
    const entries = readdirSync(this.historyDir())
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((name) => {
        const raw = JSON.parse(readFileSync(join(this.historyDir(), name), "utf8")) as {
          revision: string;
          at: string;
          message: string;
          author: string;
        };
        return {
          revision: raw.revision,
          message: raw.message,
          at: raw.at,
          author: raw.author,
        };
      });
    const ledger = this.readLedger();
    if (ledger.lastSyncAt && ledger.lastCommitMessage) {
      entries.unshift({
        revision: `local-${ledger.revision}`,
        message: ledger.lastCommitMessage,
        at: ledger.lastSyncAt,
        author: "store",
      });
    }
    return entries;
  }

  async readFileAt(ref: string, key: CanonicalFileKey): Promise<unknown> {
    if (!/^local-\d+$/.test(ref)) throw new RepoError("validation", "Referensi revisi tidak valid");
    const padded = String(Number(ref.replace("local-", ""))).padStart(5, "0");
    const abs = join(this.historyDir(), `${padded}.json`);
    if (!existsSync(abs)) throw new RepoError("not-found", `Revisi ${ref} tidak ditemukan`);
    const entry = JSON.parse(readFileSync(abs, "utf8")) as { files: Record<string, string> };
    const content = entry.files[key];
    if (content === undefined) throw new RepoError("not-found", `Berkas ${key} tidak ada di revisi ${ref}`);
    return JSON.parse(content);
  }

  async health(): Promise<AdapterHealth> {
    try {
      const abs = this.path(CANONICAL_FILES.settings);
      if (!existsSync(abs)) {
        return { adapter: "local", ok: false, detail: "Berkas settings.json tidak ada" };
      }
      mkdirSync(dirname(this.ledgerPath()), { recursive: true });
      return { adapter: "local", ok: true, detail: "Mode lokal aktif. Data tersimpan di data/*.json" };
    } catch (e) {
      return { adapter: "local", ok: false, detail: (e as Error).message };
    }
  }

  /** Raw string contents of all canonical files (unvalidated — for SHA checks). */
  private readSnapshotRaw(): Record<CanonicalFileKey, string> {
    const out = {} as Record<CanonicalFileKey, string>;
    for (const key of ALL_KEYS) {
      const abs = this.path(CANONICAL_FILES[key]);
      out[key] = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    }
    return out;
  }

  /** Parses + validates the proposed full snapshot (all five files together). */
  private validateProposedSnapshot(proposed: Record<CanonicalFileKey, string>): void {
    const parsed = {} as Record<CanonicalFileKey, unknown>;
    for (const key of ALL_KEYS) {
      let data: unknown;
      try {
        data = JSON.parse(proposed[key]);
      } catch (e) {
        throw new RepoError("validation", `JSON tidak valid untuk ${CANONICAL_FILES[key]}: ${(e as Error).message}`);
      }
      const result = validateFile(key, data);
      if (!result.ok) {
        const first: ValidationIssue = result.issues[0];
        throw new RepoError(
          "validation",
          `${CANONICAL_FILES[key]} → ${first.recordId ? `record ${first.recordId} ` : ""}${first.field ?? ""}: ${first.reason}`
        );
      }
      parsed[key] = result.data;
    }
    const assembled = parsed as unknown as {
      games: { games: CatalogSnapshot["games"] };
      products: { products: CatalogSnapshot["products"] };
      categories: { categories: CatalogSnapshot["categories"] };
      settings: CatalogSnapshot["settings"];
      "checkout-template": CatalogSnapshot["checkoutTemplate"];
      "access-control": CatalogSnapshot["accessControl"];
    };
    const integrity = validateCatalogIntegrity({
      games: assembled.games.games,
      products: assembled.products.products,
      categories: assembled.categories.categories,
      settings: assembled.settings,
      checkoutTemplate: assembled["checkout-template"],
      accessControl: assembled["access-control"],
    });
    if (!integrity.ok) {
      const first = integrity.issues[0];
      throw new RepoError(
        "validation",
        `Integritas katalog: ${first.file}${first.recordId ? ` (${first.recordId})` : ""} — ${first.reason}`
      );
    }
  }

  private pruneHistory(): void {
    if (!existsSync(this.historyDir())) return;
    const files = readdirSync(this.historyDir()).filter((f) => f.endsWith(".json")).sort();
    while (files.length > HISTORY_LIMIT) {
      const victim = files.shift();
      if (victim) rmSync(join(this.historyDir(), victim));
    }
  }
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Deterministic serialization for hashing (not for disk writes). */
export function canonicalSerialize(data: unknown): string {
  return JSON.stringify(sortKeysDeep(data));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function atomicWrite(abs: string, content: string): void {
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, abs);
}
