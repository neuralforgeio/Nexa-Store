import { test, expect } from "bun:test";
import { applyOperations, commitMessageFor, serializeFile, MutationError } from "@/lib/catalog/mutations";
import { SEED } from "@/lib/catalog/seed";
import type { CatalogSnapshot } from "@/lib/catalog/schema";
import type { Product } from "@/lib/catalog/types";

function base(): Pick<CatalogSnapshot, "games" | "products" | "categories"> {
  return JSON.parse(JSON.stringify({ games: SEED.games, products: SEED.products, categories: SEED.categories }));
}

test("product.update changes price and reports diff (PRD §41)", () => {
  const snap = base();
  const target = snap.products.find((p) => p.id === "valorant-475") as Product;
  const result = applyOperations(snap, [
    { type: "product.update", id: target.id, payload: { ...target, priceIdr: 58000 } },
  ]);
  expect(result.products.find((p) => p.id === "valorant-475")?.priceIdr).toBe(58000);
  expect(result.diff.productsChanged).toBe(1);
  expect(result.diff.lines.some((l) => l.includes("Rp56.000 → Rp58.000"))).toBe(true);
});

test("product.create rejects duplicate ids (PRD §36)", () => {
  const snap = base();
  const dupe = { ...(snap.products[0] as Product) };
  expect(() => applyOperations(snap, [{ type: "product.create", payload: dupe }])).toThrow(MutationError);
});

test("game.create rejects duplicate slug", () => {
  const snap = base();
  const dupe = { ...snap.games[0], id: "valorant-2" };
  expect(() => applyOperations(snap, [{ type: "game.create", payload: dupe }])).toThrow(MutationError);
});

test("batch operations commit as one logical change", () => {
  const snap = base();
  const a = snap.products.find((p) => p.id === "ml-59") as Product;
  const b = snap.products.find((p) => p.id === "ml-74") as Product;
  const result = applyOperations(snap, [
    { type: "product.update", id: a.id, payload: { ...a, priceIdr: 18000 } },
    { type: "product.update", id: b.id, payload: { ...b, enabled: false } },
  ]);
  expect(result.diff.productsChanged).toBe(2);
  expect(result.diff.lines.length).toBeGreaterThanOrEqual(2);
});

test("commit messages follow the store: convention (PRD §18.2)", () => {
  const snap = base();
  const p = snap.products[0] as Product;
  expect(
    commitMessageFor([{ type: "product.update", id: p.id, payload: p }])
  ).toBe("store: update product pricing");
  expect(commitMessageFor([{ type: "game.create", payload: snap.games[0] }])).toBe("store: add game");
  expect(
    commitMessageFor([
      { type: "game.update", id: snap.games[0].id, payload: snap.games[0] },
      { type: "product.update", id: p.id, payload: p },
    ])
  ).toBe("store: update catalog");
});

test("serializeFile emits canonical JSON with wrapper keys", () => {
  const snap = base();
  const products = serializeFile("products", snap);
  const parsed = JSON.parse(products);
  expect(Array.isArray(parsed.products)).toBe(true);
  expect(parsed.products.length).toBe(snap.products.length);
});

test("update to a missing record throws", () => {
  const snap = base();
  const ghost = { ...(snap.products[0] as Product), id: "hantu-1" };
  expect(() => applyOperations(snap, [{ type: "product.update", id: "hantu-1", payload: ghost }])).toThrow(
    MutationError
  );
});
