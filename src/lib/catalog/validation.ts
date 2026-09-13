import type { ValidationIssue, ValidationReport } from "./types";
import type { CatalogSnapshot } from "./schema";
import { CHECKOUT_PLACEHOLDERS } from "@/lib/whatsapp/template";

/**
 * Cross-record catalog integrity rules (PRD §36).
 * Runs on every read at the trust boundary and before every write.
 */

export function validateCatalogIntegrity(snapshot: CatalogSnapshot): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { games, products, categories, settings, checkoutTemplate } = snapshot;

  const gameIds = new Set<string>();
  const gameSlugs = new Set<string>();
  for (const g of games) {
    if (gameIds.has(g.id)) {
      issues.push({ file: "games", recordId: g.id, field: "id", reason: "ID game duplikat" });
    }
    gameIds.add(g.id);
    if (gameSlugs.has(g.slug)) {
      issues.push({ file: "games", recordId: g.id, field: "slug", reason: `Slug duplikat: ${g.slug}` });
    }
    gameSlugs.add(g.slug);

    const keys = new Set<string>();
    for (const f of g.orderFieldSchema) {
      if (keys.has(f.key)) {
        issues.push({
          file: "games",
          recordId: g.id,
          field: "orderFieldSchema",
          reason: `Kunci field pesanan duplikat: ${f.key}`,
        });
      }
      keys.add(f.key);
    }
    if (!g.enabled && products.some((p) => p.gameId === g.id && p.enabled)) {
      issues.push({
        file: "games",
        recordId: g.id,
        field: "enabled",
        reason: "Game nonaktif masih memiliki produk aktif yang akan tampil tanpa induk",
      });
    }
  }

  const categoryIds = new Set<string>();
  const categorySlugs = new Set<string>();
  for (const c of categories) {
    if (categoryIds.has(c.id)) {
      issues.push({ file: "categories", recordId: c.id, field: "id", reason: "ID kategori duplikat" });
    }
    categoryIds.add(c.id);
    if (categorySlugs.has(c.slug)) {
      issues.push({ file: "categories", recordId: c.id, field: "slug", reason: `Slug kategori duplikat: ${c.slug}` });
    }
    categorySlugs.add(c.slug);
  }

  const productIds = new Set<string>();
  for (const p of products) {
    if (productIds.has(p.id)) {
      issues.push({ file: "products", recordId: p.id, field: "id", reason: "ID produk duplikat" });
    }
    productIds.add(p.id);

    if (!gameIds.has(p.gameId)) {
      issues.push({
        file: "products",
        recordId: p.id,
        field: "gameId",
        reason: "Produk menunjuk game yang tidak ada",
        received: p.gameId,
      });
    }
    if (p.categoryId && !categoryIds.has(p.categoryId)) {
      issues.push({
        file: "products",
        recordId: p.id,
        field: "categoryId",
        reason: "Produk menunjuk kategori yang tidak ada",
        received: p.categoryId,
      });
    }
    if (p.enabled && !Number.isSafeInteger(p.priceIdr)) {
      issues.push({ file: "products", recordId: p.id, field: "priceIdr", reason: "Harga bukan bilangan bulat aman" });
    }
    if (p.enabled && p.priceIdr <= 0) {
      issues.push({
        file: "products",
        recordId: p.id,
        field: "priceIdr",
        reason: "Produk aktif harus memiliki harga positif (mode produk gratis belum didesain)",
        received: String(p.priceIdr),
      });
    }
  }

  for (const g of games) {
    for (const cid of g.categoryIds) {
      if (!categoryIds.has(cid)) {
        issues.push({
          file: "games",
          recordId: g.id,
          field: "categoryIds",
          reason: "Game menunjuk kategori yang tidak ada",
          received: cid,
        });
      }
    }
  }

  // Checkout template placeholder safety (PRD §37).
  const found = extractPlaceholders(checkoutTemplate.template);
  for (const name of found) {
    if (!(CHECKOUT_PLACEHOLDERS as readonly string[]).includes(name)) {
      issues.push({
        file: "checkout-template",
        field: "template",
        reason: `Placeholder tidak dikenal: {${name}}`,
        received: `{${name}}`,
      });
    }
  }
  if (found.length === 0) {
    issues.push({
      file: "checkout-template",
      field: "template",
      reason: "Template tidak memuat placeholder apa pun",
    });
  }

  if (settings.maintenanceMode && !settings.maintenanceMessage?.trim()) {
    issues.push({
      file: "settings",
      field: "maintenanceMessage",
      reason: "Mode maintenance aktif tanpa pesan yang bisa ditampilkan",
    });
  }

  return { ok: issues.length === 0, issues };
}

export function extractPlaceholders(template: string): string[] {
  const out: string[] = [];
  const re = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) out.push(m[1]);
  return out;
}
