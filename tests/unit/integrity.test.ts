import { test, expect } from "bun:test";
import { validateCatalogIntegrity } from "@/lib/catalog/validation";
import { SEED } from "@/lib/catalog/seed";
import type { CatalogSnapshot } from "@/lib/catalog/schema";

function baseSnapshot(): CatalogSnapshot {
  return JSON.parse(JSON.stringify(SEED)) as CatalogSnapshot;
}

test("seed data passes full integrity validation (PRD §36)", () => {
  const report = validateCatalogIntegrity(baseSnapshot());
  expect(report.issues).toEqual([]);
  expect(report.ok).toBe(true);
});

test("duplicate product ids are detected", () => {
  const snap = baseSnapshot();
  snap.products.push({ ...snap.products[0] });
  const report = validateCatalogIntegrity(snap);
  expect(report.ok).toBe(false);
  expect(report.issues.some((i) => i.file === "products" && i.reason.includes("duplikat"))).toBe(true);
});

test("product referencing a missing game is detected", () => {
  const snap = baseSnapshot();
  snap.products[0].gameId = "tidak-ada";
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.reason.includes("game yang tidak ada"))).toBe(true);
});

test("active product with zero/negative price is flagged (PRD §16.3)", () => {
  const snap = baseSnapshot();
  snap.products[0].priceIdr = 0;
  let report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.field === "priceIdr")).toBe(true);

  snap.products[0].priceIdr = -1000;
  report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.field === "priceIdr")).toBe(true);

  // Disabled products may hold zero prices as drafts.
  snap.products[0].enabled = false;
  snap.products[0].priceIdr = 0;
  report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.field === "priceIdr")).toBe(false);
});

test("duplicate game slug is detected", () => {
  const snap = baseSnapshot();
  snap.games[1].slug = snap.games[0].slug;
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.file === "games" && i.reason.includes("Slug duplikat"))).toBe(true);
});

test("duplicate order-field keys in a game are detected (PRD §16.1)", () => {
  const snap = baseSnapshot();
  snap.games[0].orderFieldSchema.push({ ...snap.games[0].orderFieldSchema[0] });
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.reason.includes("Kunci field pesanan duplikat"))).toBe(true);
});

test("disabled game with active products is flagged", () => {
  const snap = baseSnapshot();
  snap.games[0].enabled = false;
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.reason.includes("Game nonaktif"))).toBe(true);
});

test("unknown checkout template placeholder is flagged (PRD §37)", () => {
  const snap = baseSnapshot();
  snap.checkoutTemplate.template = "Halo {storeName} — {bogus}";
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.file === "checkout-template" && i.reason.includes("Placeholder tidak dikenal"))).toBe(
    true
  );
});

test("template without any placeholder is flagged", () => {
  const snap = baseSnapshot();
  snap.checkoutTemplate.template = "Halo admin, saya mau pesan.";
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.reason.includes("tidak memuat placeholder"))).toBe(true);
});

test("maintenance mode without message is flagged (PRD §26)", () => {
  const snap = baseSnapshot();
  snap.settings.maintenanceMode = true;
  snap.settings.maintenanceMessage = "";
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.file === "settings" && i.field === "maintenanceMessage")).toBe(true);
});

test("category reference from product must exist", () => {
  const snap = baseSnapshot();
  snap.categories.push({
    id: "cat-1",
    slug: "pc",
    name: "PC",
    enabled: true,
    sortOrder: 1,
  });
  snap.products[0].categoryId = "cat-hantu";
  const report = validateCatalogIntegrity(snap);
  expect(report.issues.some((i) => i.reason.includes("kategori yang tidak ada"))).toBe(true);
});
