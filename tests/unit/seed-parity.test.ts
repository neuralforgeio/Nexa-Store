import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Live catalog guard (A11, PRD §53 — adapted v1.11.2). The original exact
 * seed-parity check was a build-time transcription guard; once the store
 * went live the catalog became owner-managed data (new games, edited
 * prices), so the invariant is now structural: the PRD seed games remain
 * the foundation, ids are unique, products reference existing games, and
 * money values stay safe integers.
 */

const PRD_TABLES: Record<string, Array<[denomination: string, bonus: string | null, price: number]>> = {
  valorant: [
    ["475", null, 56000],
    ["1000", null, 112000],
    ["2050", null, 220000],
    ["3650", null, 380000],
    ["5350", null, 550000],
    ["11000", null, 1200000],
  ],
  pubg: [
    ["60", null, 18000],
    ["325", null, 80000],
    ["660", null, 161000],
    ["1800", null, 405000],
    ["3850", null, 799000],
    ["8100", null, 1613000],
  ],
  "genshin-impact": [
    ["60", null, 19000],
    ["300", "+ 30", 86000],
    ["980", "+ 110", 270000],
    ["1980", "+ 260", 520000],
    ["3280", "+ 600", 850000],
    ["6480", "+ 1600", 1735000],
  ],
  "blood-strike": [
    ["100", "+ 5", 15000],
    ["300", "+ 20", 46000],
    ["500", "+ 40", 74000],
    ["1000", "+ 100", 143000],
    ["2000", "+ 260", 280000],
    ["5000", "+ 800", 711000],
  ],
  "honor-of-kings": [
    ["16", null, 4000],
    ["80", null, 18000],
    ["240", null, 50000],
    ["400", null, 86000],
    ["560", null, 118000],
    ["800", "+ 30", 169000],
    ["1200", "+ 45", 250000],
    ["2400", "+ 108", 492000],
    ["4000", "+ 180", 820000],
    ["8000", "+ 360", 1635000],
  ],
  "delta-force": [
    ["18", "+ 1", 6000],
    ["30", "+ 2", 10000],
    ["60", "+ 3", 17000],
    ["300", "+ 36", 83000],
    ["420", "+ 62", 114000],
    ["680", "+ 105", 163000],
    ["1280", "+ 262", 310000],
    ["1680", "+ 385", 389000],
    ["3280", "+ 834", 770000],
    ["6480", "+ 1944", 1534000],
    ["12960", "+ 3888", 3000000],
    ["19440", "+ 5832", 4700000],
  ],
  "mobile-legends": [
    ["59", null, 17000],
    ["74", null, 21000],
    ["170", null, 44000],
    ["222", null, 58000],
    ["240", null, 62000],
    ["296", null, 77000],
    ["370", null, 99000],
    ["408", null, 104000],
  ],
  "fc-mobile": [
    ["40", null, 8000],
    ["100", null, 18000],
    ["520", null, 78000],
    ["1070", null, 160000],
    ["2200", null, 330000],
    ["5750", null, 790000],
    ["12000", null, 1600000],
  ],
};

const PRD_SEED_GAME_IDS = Object.keys(PRD_TABLES);

test("catalog keeps the PRD seed games as its foundation (live data, structure only)", () => {
  const games = JSON.parse(readFileSync("data/catalog/games.json", "utf8")) as {
    games: Array<{ id: string; slug: string }>;
  };
  const products = JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as {
    products: Array<{ id: string; gameId: string; priceIdr: number; enabled: boolean }>;
  };

  // Every seed game still exists — the live catalog only grows on top of it.
  const gameIds = new Set(games.games.map((g) => g.id));
  for (const gameId of PRD_SEED_GAME_IDS) {
    expect(gameIds.has(gameId)).toBe(true);
  }

  // Structural integrity for the live dataset.
  const productIds = new Set<string>();
  for (const p of products.products) {
    expect(productIds.has(p.id)).toBe(false);
    productIds.add(p.id);
    expect(gameIds.has(p.gameId)).toBe(true);
    expect(Number.isSafeInteger(p.priceIdr)).toBe(true);
  }
  expect(products.products.length).toBeGreaterThan(0);
});

test("PRD tables themselves are internally consistent (no duplicate denominations)", () => {
  for (const [gameId, rows] of Object.entries(PRD_TABLES)) {
    const seen = new Set(rows.map((r) => r[0]));
    expect(seen.size).toBe(rows.length);
    expect(rows.every((r) => Number.isInteger(r[2]) && r[2] > 0)).toBe(true);
    if (gameId === "never") expect(true).toBe(false);
  }
});

test("all prices are safe integers (money invariant)", () => {
  const data = JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as {
    products: Array<{ priceIdr: number }>;
  };
  for (const p of data.products) {
    expect(Number.isSafeInteger(p.priceIdr)).toBe(true);
  }
});
