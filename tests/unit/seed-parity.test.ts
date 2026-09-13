import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Seed parity guard (A11, PRD §53): every price in the canonical data files
 * must match the PRD §14 tables verbatim. This test is the independent
 * cross-check between the PRD document values and the shipped data.
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

const EXPECTED_TOTAL = Object.values(PRD_TABLES).reduce((sum, rows) => sum + rows.length, 0);

test("canonical products.json matches the PRD §14 tables exactly", () => {
  const data = JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as {
    products: Array<{ gameId: string; denomination: string; bonus?: string; priceIdr: number }>;
  };

  expect(data.products.length).toBe(EXPECTED_TOTAL);

  for (const [gameId, rows] of Object.entries(PRD_TABLES)) {
    const actual = data.products.filter((p) => p.gameId === gameId);
    expect(actual.length).toBe(rows.length);
    for (const [denomination, bonus, price] of rows) {
      const match = actual.find((p) => p.denomination === denomination);
      expect(match).toBeDefined();
      expect(match!.priceIdr).toBe(price);
      expect(match!.bonus ?? null).toBe(bonus);
    }
  }
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
