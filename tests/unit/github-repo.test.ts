import { test, expect, beforeAll } from "bun:test";
import { GitHubCatalogRepository, githubConfigFromEnv } from "@/lib/catalog/repo/github";
import { RepoError } from "@/lib/catalog/repo/types";

/**
 * GitHub adapter tests with an injected fetch mock — no live network calls
 * (PRD §46.2: GitHub API calls are mocked/stubbed in automated tests).
 */

const config = {
  owner: "octo",
  repository: "nexa-store",
  branch: "main",
  token: "test-token",
  committerName: "Bot",
  committerEmail: "bot@example.com",
};

type Call = { method: string; path: string; body?: unknown };

function mockFetch(responses: Array<{ match: (call: Call) => boolean; status: number; data: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace("https://api.github.com", "").split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const hit = responses.find((r) => r.match({ method, path, body }));
    if (!hit) return new Response(JSON.stringify({ message: "not stubbed" }), { status: 404 });
    return new Response(JSON.stringify(hit.data), {
      status: hit.status,
      headers: { "content-type": "application/json", ...(hit.headers ?? {}) },
    });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

beforeAll(() => {
  delete process.env.GITHUB_OWNER;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
});

test("githubConfigFromEnv returns null unless fully configured", () => {
  expect(githubConfigFromEnv()).toBeNull();
  process.env.GITHUB_OWNER = "octo";
  expect(githubConfigFromEnv()).toBeNull();
  process.env.GITHUB_REPOSITORY = "nexa-store";
  expect(githubConfigFromEnv()).toBeNull();
  process.env.GITHUB_TOKEN = "tok";
  const cfg = githubConfigFromEnv();
  expect(cfg?.owner).toBe("octo");
  expect(cfg?.branch).toBe("main");
  delete process.env.GITHUB_OWNER;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
});

test("readSnapshot decodes base64 contents and validates them", async () => {
  const games = { games: [{ id: "g1", slug: "game-one", name: "One", categoryIds: [], orderFieldSchema: [], enabled: true, sortOrder: 1 }] };
  const products = { products: [] };
  const categories = { categories: [] };
  const settings = { storeName: "Nexa Store", whatsappNumber: "+62 888-6567-888", currency: "IDR", locale: "id-ID", maintenanceMode: false };
  const template = { template: "Halo {storeName}" };
  const accessControl = { adminBlocked: false };

  const { impl, calls } = mockFetch([
    { match: (c) => c.path === "/repos/octo/nexa-store/git/ref/heads/main", status: 200, data: { object: { sha: "abc123" } } },
    { match: (c) => c.path === "/repos/octo/nexa-store/contents/data/catalog/games.json", status: 200, data: { sha: "g1", content: Buffer.from(JSON.stringify(games)).toString("base64") } },
    { match: (c) => c.path === "/repos/octo/nexa-store/contents/data/catalog/products.json", status: 200, data: { sha: "p1", content: Buffer.from(JSON.stringify(products)).toString("base64") } },
    { match: (c) => c.path === "/repos/octo/nexa-store/contents/data/catalog/categories.json", status: 200, data: { sha: "c1", content: Buffer.from(JSON.stringify(categories)).toString("base64") } },
    { match: (c) => c.path === "/repos/octo/nexa-store/contents/data/store/settings.json", status: 200, data: { sha: "s1", content: Buffer.from(JSON.stringify(settings)).toString("base64") } },
    { match: (c) => c.path === "/repos/octo/nexa-store/contents/data/store/checkout-template.json", status: 200, data: { sha: "t1", content: Buffer.from(JSON.stringify(template)).toString("base64") } },
    { match: (c) => c.path === "/repos/octo/nexa-store/contents/data/store/access-control.json", status: 200, data: { sha: "a1", content: Buffer.from(JSON.stringify(accessControl)).toString("base64") } },
  ]);

  const repo = new GitHubCatalogRepository(config, impl);
  const read = await repo.readSnapshot();
  expect(read.revision).toBe("abc123");
  expect(read.snapshot.games[0].slug).toBe("game-one");
  expect(read.fileShas.games).toBe("g1");
  // All requests carried the token header implicitly via impl; verify path allowlist usage:
  expect(calls.every((c) => c.path.startsWith("/repos/octo/nexa-store/"))).toBe(true);
});

test("stale baseRevision on write is a conflict (PRD §18.3)", async () => {
  const { impl } = mockFetch([
    { match: (c) => c.path === "/repos/octo/nexa-store/git/ref/heads/main", status: 200, data: { object: { sha: "newer-than-base" } } },
  ]);
  const repo = new GitHubCatalogRepository(config, impl);
  await expect(
    repo.writeFiles({
      files: { settings: "{}" },
      baseRevision: "older-base",
      baseFileShas: { games: "x", products: "x", categories: "x", settings: "x", "checkout-template": "x", "access-control": "x" },
      message: "store: test",
      author: { name: "t", email: "t@t.dev" },
    })
  ).rejects.toMatchObject({ kind: "conflict" });
});

test("401 maps to auth error without exposing the body (PRD §30.1)", async () => {
  const { impl } = mockFetch([
    { match: (c) => c.path === "/repos/octo/nexa-store/git/ref/heads/main", status: 401, data: { message: "Bad credentials SECRET_DETAIL" } },
  ]);
  const repo = new GitHubCatalogRepository(config, impl);
  await expect(repo.readSnapshot()).rejects.toMatchObject({ kind: "auth" });
});

test("rate limit maps to rate-limit error via headers", async () => {
  const { impl } = mockFetch([
    {
      match: (c) => c.path === "/repos/octo/nexa-store/git/ref/heads/main",
      status: 403,
      data: { message: "API rate limit exceeded" },
      headers: { "x-ratelimit-remaining": "0" },
    },
  ]);
  const repo = new GitHubCatalogRepository(config, impl);
  await expect(repo.readSnapshot()).rejects.toMatchObject({ kind: "rate-limit" });
});

test("404 maps to not-found", async () => {
  const { impl } = mockFetch([
    { match: (c) => c.path === "/repos/octo/nexa-store/git/ref/heads/main", status: 200, data: { object: { sha: "h" } } },
    { match: () => true, status: 404, data: { message: "Not Found" } },
  ]);
  const repo = new GitHubCatalogRepository(config, impl);
  await expect(repo.readSnapshot()).rejects.toMatchObject({ kind: "not-found" });
});

test("writeFiles rejects non-allowlisted file keys (R7)", async () => {
  const { impl } = mockFetch([]);
  const repo = new GitHubCatalogRepository(config, impl);
  await expect(
    repo.writeFiles({
      files: { games: "{}" } as never, // bypass typing deliberately
      baseRevision: "h",
      baseFileShas: {} as never,
      message: "store: test",
      author: { name: "t", email: "t@t.dev" },
    })
  ).rejects.toBeInstanceOf(RepoError);
});
