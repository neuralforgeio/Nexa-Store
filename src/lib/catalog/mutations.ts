import { z } from "zod";
import type { CanonicalFileKey, Product, Game, Category } from "./types";
import type { CatalogSnapshot } from "./schema";
import { gamesFileSchema, productsFileSchema, categoriesFileSchema } from "./schema";
import { formatIdr } from "@/lib/format/idr";
import { productTitle } from "@/lib/whatsapp/template";

/**
 * Catalog mutation engine (D4): batched typed operations applied to a snapshot,
 * full validation before persistence, diff summaries for review (PRD §41),
 * conventional commit messages (PRD §18.2).
 */

export const gamePayloadSchema = gamesFileSchema.shape.games.element;
export const productPayloadSchema = productsFileSchema.shape.products.element;
export const categoryPayloadSchema = categoriesFileSchema.shape.categories.element;

export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("game.create"), payload: gamePayloadSchema }),
  z.object({ type: z.literal("game.update"), id: z.string().min(1), payload: gamePayloadSchema }),
  z.object({ type: z.literal("product.create"), payload: productPayloadSchema }),
  z.object({ type: z.literal("product.update"), id: z.string().min(1), payload: productPayloadSchema }),
  z.object({ type: z.literal("category.create"), payload: categoryPayloadSchema }),
  z.object({ type: z.literal("category.update"), id: z.string().min(1), payload: categoryPayloadSchema }),
]);

export type CatalogOperation = z.infer<typeof operationSchema>;

export type MutationDiff = {
  gamesChanged: number;
  productsChanged: number;
  categoriesChanged: number;
  lines: string[];
};

export class MutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationError";
  }
}

export function applyOperations(
  snapshot: Pick<CatalogSnapshot, "games" | "products" | "categories">,
  operations: CatalogOperation[]
): Pick<CatalogSnapshot, "games" | "products" | "categories"> & { diff: MutationDiff } {
  let games = [...snapshot.games];
  let products = [...snapshot.products];
  let categories = [...snapshot.categories];
  const lines: string[] = [];
  let gamesChanged = 0;
  let productsChanged = 0;
  let categoriesChanged = 0;

  for (const op of operations) {
    switch (op.type) {
      case "game.create": {
        if (games.some((g) => g.id === op.payload.id)) {
          throw new MutationError(`Game dengan id "${op.payload.id}" sudah ada.`);
        }
        if (games.some((g) => g.slug === op.payload.slug)) {
          throw new MutationError(`Slug game "${op.payload.slug}" sudah dipakai.`);
        }
        games.push(op.payload);
        gamesChanged++;
        lines.push(`+ Game ${op.payload.name} ditambahkan`);
        break;
      }
      case "game.update": {
        const index = games.findIndex((g) => g.id === op.id);
        if (index === -1) throw new MutationError(`Game "${op.id}" tidak ditemukan.`);
        const before = games[index];
        if (games.some((g) => g.id !== op.id && g.slug === op.payload.slug)) {
          throw new MutationError(`Slug game "${op.payload.slug}" sudah dipakai game lain.`);
        }
        games[index] = op.payload;
        gamesChanged++;
        if (before.enabled !== op.payload.enabled) {
          lines.push(`Game ${op.payload.name}: ${before.enabled ? "dinonaktifkan" : "diaktifkan"}`);
        }
        if (before.name !== op.payload.name) {
          lines.push(`Game ${before.name} → ${op.payload.name}`);
        }
        if (before.orderFieldSchema.length !== op.payload.orderFieldSchema.length) {
          lines.push(`Game ${op.payload.name}: skema field pesanan berubah`);
        }
        break;
      }
      case "product.create": {
        if (products.some((p) => p.id === op.payload.id)) {
          throw new MutationError(`Produk dengan id "${op.payload.id}" sudah ada.`);
        }
        products.push(op.payload);
        productsChanged++;
        lines.push(`+ ${productTitle(op.payload)} — ${formatIdr(op.payload.priceIdr)} ditambahkan`);
        break;
      }
      case "product.update": {
        const index = products.findIndex((p) => p.id === op.id);
        if (index === -1) throw new MutationError(`Produk "${op.id}" tidak ditemukan.`);
        const before = products[index];
        if (products.some((p) => p.id === op.payload.id && p.id !== op.id)) {
          throw new MutationError(`Id produk "${op.payload.id}" sudah dipakai produk lain.`);
        }
        products[index] = op.payload;
        productsChanged++;
        if (before.priceIdr !== op.payload.priceIdr) {
          lines.push(
            `${productTitle(op.payload)}: ${formatIdr(before.priceIdr)} → ${formatIdr(op.payload.priceIdr)}`
          );
        }
        if (before.enabled !== op.payload.enabled) {
          lines.push(`${productTitle(op.payload)}: ${op.payload.enabled ? "diaktifkan" : "dinonaktifkan"}`);
        }
        break;
      }
      case "category.create": {
        if (categories.some((c) => c.id === op.payload.id)) {
          throw new MutationError(`Kategori dengan id "${op.payload.id}" sudah ada.`);
        }
        if (categories.some((c) => c.slug === op.payload.slug)) {
          throw new MutationError(`Slug kategori "${op.payload.slug}" sudah dipakai.`);
        }
        categories.push(op.payload);
        categoriesChanged++;
        lines.push(`+ Kategori ${op.payload.name} ditambahkan`);
        break;
      }
      case "category.update": {
        const index = categories.findIndex((c) => c.id === op.id);
        if (index === -1) throw new MutationError(`Kategori "${op.id}" tidak ditemukan.`);
        if (categories.some((c) => c.id !== op.id && c.slug === op.payload.slug)) {
          throw new MutationError(`Slug kategori "${op.payload.slug}" sudah dipakai kategori lain.`);
        }
        const before = categories[index];
        categories[index] = op.payload;
        categoriesChanged++;
        if (before.name !== op.payload.name || before.enabled !== op.payload.enabled) {
          lines.push(`Kategori ${op.payload.name} diperbarui`);
        }
        break;
      }
    }
  }

  return { games, products, categories, diff: { gamesChanged, productsChanged, categoriesChanged, lines } };
}

export function commitMessageFor(operations: CatalogOperation[]): string {
  const types = new Set(operations.map((o) => o.type));
  if (types.size === 1) {
    const only = [...types][0];
    switch (only) {
      case "game.create":
        return "store: add game";
      case "game.update":
        return "store: update game";
      case "product.create":
        return "store: add product";
      case "product.update":
        return "store: update product pricing";
      case "category.create":
        return "store: add category";
      case "category.update":
        return "store: update category";
    }
  }
  return "store: update catalog";
}

export function serializeFile(key: CanonicalFileKey, part: Pick<CatalogSnapshot, "games" | "products" | "categories">): string {
  switch (key) {
    case "games":
      return `${JSON.stringify({ games: part.games }, null, 2)}\n`;
    case "products":
      return `${JSON.stringify({ products: part.products }, null, 2)}\n`;
    case "categories":
      return `${JSON.stringify({ categories: part.categories }, null, 2)}\n`;
    default:
      throw new MutationError(`Berkas ${key} bukan bagian mutasi katalog.`);
  }
}

export type { Product, Game, Category };
