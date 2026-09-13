import { test, expect } from "bun:test";
import {
  renderTemplate,
  buildTemplateContext,
  validateTemplate,
  extractPlaceholderNames,
  productTitle,
  UnknownPlaceholderError,
} from "@/lib/whatsapp/template";
import type { Game, Product, StoreSettings } from "@/lib/catalog/types";

const settings: StoreSettings = {
  storeName: "Nexa Store",
  whatsappNumber: "+62 888-6567-888",
  currency: "IDR",
  locale: "id-ID",
  maintenanceMode: false,
};

const mlGame: Game = {
  id: "mobile-legends",
  slug: "mobile-legends",
  name: "Mobile Legends",
  categoryIds: [],
  orderFieldSchema: [
    { key: "playerId", label: "User ID", type: "number", required: true },
    { key: "serverId", label: "Zone / Server", type: "number", required: true },
  ],
  enabled: true,
  sortOrder: 7,
};

const product: Product = {
  id: "ml-59",
  gameId: "mobile-legends",
  name: "Diamonds",
  denomination: "59",
  priceIdr: 17000,
  currency: "IDR",
  enabled: true,
  sortOrder: 17000,
};

const values = {
  customerName: "Budi Santoso",
  note: "malam saja",
  fields: { playerId: "12345678", serverId: "2345" },
};

test("productTitle renders denomination + bonus + name (PRD §10.4)", () => {
  expect(productTitle(product)).toBe("59 Diamonds");
  expect(productTitle({ ...product, denomination: "300", bonus: "+ 30", name: "Genesis Crystals" })).toBe(
    "300 + 30 Genesis Crystals"
  );
});

test("renderTemplate is deterministic and preserves line breaks (PRD §37)", () => {
  const ctx = buildTemplateContext(settings, mlGame, product, values);
  const template = "Halo {storeName}\nProduk: {productName} ({gameName})\nHarga: {price}";
  const a = renderTemplate(template, ctx);
  const b = renderTemplate(template, ctx);
  expect(a).toBe(b);
  expect(a).toContain("\n");
  expect(a).toContain("Harga: Rp17.000");
});

test("renderTemplate resolves every documented placeholder", () => {
  const ctx = buildTemplateContext(settings, mlGame, product, values);
  const out = renderTemplate(
    "{storeName}|{gameName}|{productName}|{price}|{customerName}|{playerId}|{serverId}|{note}|{orderDetails}|{timestamp}",
    ctx
  );
  expect(out).toContain("Nexa Store|Mobile Legends|59 Diamonds|Rp17.000|Budi Santoso|12345678|2345|malam saja|");
  expect(out).toContain("User ID: 12345678");
  expect(out).toContain("Zone / Server: 2345");
  expect(out).not.toContain("{");
});

test("orderDetails renders every configured field, missing values as dash", () => {
  const ctx = buildTemplateContext(settings, mlGame, product, {
    customerName: "A",
    note: "",
    fields: { playerId: "999", serverId: "" },
  });
  expect(ctx.orderDetails).toBe("User ID: 999\nZone / Server: —");
  expect(ctx.note).toBe("—");
});

test("unknown placeholders are rejected (fail-closed, PRD §37)", () => {
  expect(() => validateTemplate("Halo {evilPlaceholder}")).toThrow(UnknownPlaceholderError);
  expect(() => renderTemplate("{nope}", buildTemplateContext(settings, mlGame, product, values))).toThrow(
    UnknownPlaceholderError
  );
});

test("missing values never leak 'undefined' text (PRD §37)", () => {
  const ctx = buildTemplateContext(settings, mlGame, product, values);
  const out = renderTemplate("ID: [{playerId}] Server: [{serverId}] Lain: [{note}]", ctx);
  expect(out).not.toContain("undefined");
  expect(out).toContain("Server: [2345]");
});

test("extractPlaceholderNames finds all placeholders", () => {
  const names = extractPlaceholderNames("a {one} b {two_x} c {Three3}");
  expect(names).toEqual(["one", "two_x", "Three3"]);
});
