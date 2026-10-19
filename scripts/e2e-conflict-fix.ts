/**
 * E2E verification for v1.11.1 conflict fix — runs the REAL
 * GitHubCatalogRepository against a THROWAWAY repo, replaying the exact
 * production scenario from the bug report:
 *
 *   1. readSnapshot            → base revision + file SHAs (admin page load)
 *   2. unrelated runtime commit → analytics.json write-through (head moves)
 *   3. writeFiles (stale baseRevision, intact file SHAs) → MUST SUCCEED
 *      (the old head-equality code 409'd here — the user's bug)
 *   4. genuinely changed catalog file + stale SHA → MUST 409
 *   5. cleanup
 *
 * Run: GH_TOKEN=... bun run scripts/e2e-conflict-fix.ts
 */
import { GitHubCatalogRepository } from "../src/lib/catalog/repo/github";
import { RepoError } from "../src/lib/catalog/repo/types";
import { readFileSync } from "node:fs";

const TOKEN = process.env.GH_TOKEN!;
if (!TOKEN) throw new Error("GH_TOKEN required");
const OWNER = "neuralforgeio";
const REPO = `nexa-conflict-e2e-${Date.now()}`;
const API = `https://api.github.com`;
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "nexa-e2e",
  "Content-Type": "application/json",
};

const canonical: Record<string, string> = {
  "data/catalog/games.json": readFileSync("data/catalog/games.json", "utf8"),
  "data/catalog/products.json": readFileSync("data/catalog/products.json", "utf8"),
  "data/catalog/categories.json": readFileSync("data/catalog/categories.json", "utf8"),
  "data/store/settings.json": readFileSync("data/store/settings.json", "utf8"),
  "data/store/checkout-template.json": readFileSync("data/store/checkout-template.json", "utf8"),
  "data/store/access-control.json": readFileSync("data/store/access-control.json", "utf8"),
};

async function gh(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

let step = "";
const log = (msg: string) => console.log(`  ${msg}`);
const fail = (msg: string): never => {
  console.error(`✗ FAIL [${step}] ${msg}`);
  process.exit(1);
};

try {
  // ── Setup: throwaway repo ─────────────────────────────────────────────
  step = "setup";
  console.log("■ E2E: v1.11.1 content-level conflict fix");
  await gh("POST", "/user/repos", { name: REPO, private: true, auto_init: true });
  log(`repo created: ${OWNER}/${REPO}`);

  // Seed canonical files (one commit each, like the seed process would).
  for (const [path, content] of Object.entries(canonical)) {
    await gh("PUT", `/repos/${OWNER}/${REPO}/contents/${path}`, {
      message: `seed: ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
    });
  }
  log(`seeded ${Object.keys(canonical).length} canonical files`);

  const config = {
    owner: OWNER,
    repository: REPO,
    branch: "main",
    token: TOKEN,
    committerName: "E2E Bot",
    committerEmail: "e2e@nexa.local",
  };
  const repo = new GitHubCatalogRepository(config);

  // ── Step 1: admin page load ───────────────────────────────────────────
  step = "1-readSnapshot";
  const read = await repo.readSnapshot();
  const baseRevision = read.revision;
  const baseFileShas = read.fileShas;
  log(`page load → revision ${baseRevision.slice(0, 8)}…, ${read.snapshot.products.length} products`);

  // ── Step 2: unrelated runtime write-through commit (analytics event) ──
  step = "2-runtime-commit";
  await gh("PUT", `/repos/${OWNER}/${REPO}/contents/data/store/analytics.json`, {
    message: "analytics: track events",
    content: Buffer.from(JSON.stringify({ events: [{ t: Date.now() }] }), "utf8").toString("base64"),
  });
  const headAfter = (await gh("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/main`)).object.sha;
  if (headAfter === baseRevision) fail("expected head to move after runtime commit");
  log(`runtime commit landed → head moved: ${baseRevision.slice(0, 8)}… → ${headAfter.slice(0, 8)}…`);

  // ── Step 3: THE USER'S SCENARIO — save with stale baseRevision ────────
  step = "3-save-after-head-moved";
  // Re-read current snapshot (as the API route does) and apply a real
  // "product add" mutation on top of CURRENT data.
  const current = await repo.readSnapshot();
  const productsJson = JSON.parse(canonical["data/catalog/products.json"]);
  const newProduct = {
    ...productsJson.products[0],
    id: "e2e-prod-1",
    denomination: "E2E",
    name: "E2E Conflict Fix Probe",
    priceIdr: 12345,
    sortOrder: 9999,
  };
  const proposed = {
    products: [...current.snapshot.products, newProduct],
  };
  const serialized = `${JSON.stringify(proposed, null, 2)}\n`;
  const result = await repo.writeFiles({
    files: { products: serialized },
    baseRevision, // ← STALE (head moved) — old code: 409 (the bug)
    baseFileShas, // ← intact: products.json content unchanged since page load
    message: "products: add E2E probe (stale baseRevision)",
    author: { name: "e2e", email: "e2e@nexa.local" },
  });
  log(`SAVE SUCCEEDED ✓ (commit ${result.revision.slice(0, 8)}…) — old code would 409 here`);
  if (result.files.join() !== "products") fail(`expected only products file, got ${result.files}`);

  // Verify the commit contains ONLY the intended file.
  const commitFiles = await gh("GET", `/repos/${OWNER}/${REPO}/commits/${result.revision}`);
  const touched = commitFiles.files.map((f: any) => f.filename);
  if (touched.join() !== "data/catalog/products.json") fail(`commit touched ${touched}`);
  log(`commit touched exactly: ${touched.join()}`);

  // ── Step 4: genuine catalog change + stale SHA → MUST conflict ────────
  step = "4-true-conflict";
  // Another "admin" changes products.json (blob SHA changes)…
  const changed = { products: [...proposed.products, { ...newProduct, id: "e2e-prod-2" }] };
  await gh("PUT", `/repos/${OWNER}/${REPO}/contents/data/catalog/products.json`, {
    message: "products: change by another admin",
    content: Buffer.from(`${JSON.stringify(changed, null, 2)}\n`, "utf8").toString("base64"),
    sha: (await gh("GET", `/repos/${OWNER}/${REPO}/contents/data/catalog/products.json`)).sha,
  });
  let conflicted = false;
  try {
    await repo.writeFiles({
      files: { products: serialized },
      baseRevision: result.revision,
      baseFileShas, // still the ORIGINAL shas → products sha now stale
      message: "products: should conflict",
      author: { name: "e2e", email: "e2e@nexa.local" },
    });
  } catch (e) {
    if (e instanceof RepoError && e.kind === "conflict") conflicted = true;
    else fail(`expected RepoError(conflict), got ${(e as Error).message}`);
  }
  if (!conflicted) fail("write with stale blob SHA did NOT conflict — silent overwrite risk!");
  log("TRUE CONFLICT DETECTED ✓ (stale products.json blob SHA → RepoError(conflict))");

  console.log("\n✓ E2E PASS — v1.11.1 fix verified against real GitHub:");
  console.log("  • head moved by runtime commits no longer blocks catalog saves");
  console.log("  • genuinely changed catalog content still conflicts (no silent overwrite)");
} finally {
  // ── Cleanup ────────────────────────────────────────────────────────────
  if (REPO) {
    try {
      await gh("DELETE", `/repos/${OWNER}/${REPO}`);
      console.log(`\n■ cleanup: ${REPO} deleted`);
    } catch {
      console.log(`\n■ cleanup: could not delete ${REPO} — remove manually`);
    }
  }
}
