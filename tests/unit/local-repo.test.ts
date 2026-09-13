import { test, expect } from "bun:test";
import { LocalCatalogRepository, sha256 } from "@/lib/catalog/repo/local";
import { RepoError } from "@/lib/catalog/repo/types";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Local adapter integration tests against a temp copy of the canonical data
 * (real repo behavior: read → conflict → write → history → restore).
 */

function tempRepo(): { repo: LocalCatalogRepository; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nexa-test-"));
  mkdirSync(join(dir, "data/catalog"), { recursive: true });
  mkdirSync(join(dir, "data/store"), { recursive: true });
  cpSync("data/catalog", join(dir, "data/catalog"), { recursive: true });
  cpSync("data/store", join(dir, "data/store"), { recursive: true });
  // Tests must not depend on the live ledger state — reset to a pristine one.
  writeFileSync(join(dir, "data/store/.sync.json"), JSON.stringify({ revision: 1, lastSyncAt: null, lastCommitMessage: null }));
  rmSync(join(dir, "data/store/.history"), { recursive: true, force: true });
  return { repo: new LocalCatalogRepository(dir), dir };
}

test("readSnapshot validates and returns all canonical data", async () => {
  const { repo, dir } = tempRepo();
  const read = await repo.readSnapshot();
  expect(read.snapshot.games.length).toBe(8);
  expect(read.snapshot.products.length).toBe(61);
  expect(read.revision).toBe("local-1");
  expect(read.adapter).toBe("local");
  await expect(repo.health()).resolves.toMatchObject({ ok: true });
  rmSync(dir, { recursive: true, force: true });
});

test("writeFiles bumps revision and stores history", async () => {
  const { repo, dir } = tempRepo();
  const before = await repo.readSnapshot();
  const products = `${JSON.stringify(
    { products: before.snapshot.products.map((p) => (p.id === "ml-59" ? { ...p, priceIdr: 19000 } : p)) },
    null,
    2
  )}\n`;

  const result = await repo.writeFiles({
    files: { products },
    baseRevision: before.revision,
    baseFileShas: before.fileShas,
    message: "store: update product pricing",
    author: { name: "tester", email: "t@t.dev" },
  });

  expect(result.commitMessage).toBe("store: update product pricing");
  const after = await repo.readSnapshot();
  expect(after.revision).toBe("local-2");
  expect(after.snapshot.products.find((p) => p.id === "ml-59")?.priceIdr).toBe(19000);

  const history = await repo.history(5);
  expect(history[0].revision).toBe("local-2");
  expect(history[0].message).toBe("store: update product pricing");

  // Restore path: read the previous revision and verify content.
  const restored = (await repo.readFileAt("local-1", "products")) as { products: Array<{ id: string; priceIdr: number }> };
  expect(restored.products.find((p) => p.id === "ml-59")?.priceIdr).toBe(17000);
  rmSync(dir, { recursive: true, force: true });
});

test("stale baseRevision is rejected as conflict (PRD §18.3, AC-07)", async () => {
  const { repo, dir } = tempRepo();
  const read = await repo.readSnapshot();
  const products = `${JSON.stringify({ products: read.snapshot.products }, null, 2)}\n`;
  await expect(
    repo.writeFiles({
      files: { products },
      baseRevision: "local-99",
      baseFileShas: read.fileShas,
      message: "store: test",
      author: { name: "t", email: "t@t.dev" },
    })
  ).rejects.toMatchObject({ kind: "conflict" });
  rmSync(dir, { recursive: true, force: true });
});

test("per-file SHA drift is rejected as conflict (defense in depth)", async () => {
  const { repo, dir } = tempRepo();
  const read = await repo.readSnapshot();
  // Simulate an external edit between read and write.
  writeFileSync(join(dir, "data/catalog/products.json"), `${JSON.stringify({ products: [] }, null, 2)}\n`);
  await expect(
    repo.writeFiles({
      files: { products: `${JSON.stringify({ products: [] }, null, 2)}\n` },
      baseRevision: read.revision,
      baseFileShas: read.fileShas,
      message: "store: test",
      author: { name: "t", email: "t@t.dev" },
    })
  ).rejects.toMatchObject({ kind: "conflict" });
  rmSync(dir, { recursive: true, force: true });
});

test("malformed JSON proposals are rejected as validation errors (R6)", async () => {
  const { repo, dir } = tempRepo();
  const read = await repo.readSnapshot();
  await expect(
    repo.writeFiles({
      files: { products: "{ not json" },
      baseRevision: read.revision,
      baseFileShas: read.fileShas,
      message: "store: test",
      author: { name: "t", email: "t@t.dev" },
    })
  ).rejects.toMatchObject({ kind: "validation" });

  // Schema-invalid but parseable JSON is also rejected.
  await expect(
    repo.writeFiles({
      files: { products: JSON.stringify({ products: [{ id: "x", priceIdr: 12.5 }] }) },
      baseRevision: read.revision,
      baseFileShas: read.fileShas,
      message: "store: test",
      author: { name: "t", email: "t@t.dev" },
    })
  ).rejects.toMatchObject({ kind: "validation" });
  rmSync(dir, { recursive: true, force: true });
});

test("repo rejects arbitrary ref values in readFileAt (path safety)", async () => {
  const { repo, dir } = tempRepo();
  await expect(repo.readFileAt("../../etc/passwd", "products")).rejects.toBeInstanceOf(RepoError);
  await expect(repo.readFileAt("local-1; rm -rf", "products")).rejects.toBeInstanceOf(RepoError);
  rmSync(dir, { recursive: true, force: true });
});

test("sha256 is deterministic and content-sensitive", () => {
  expect(sha256("abc")).toBe(sha256("abc"));
  expect(sha256("abc")).not.toBe(sha256("abd"));
});
