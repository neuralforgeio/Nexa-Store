import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { SEED } from "../src/lib/catalog/seed";

/**
 * Writes canonical seed JSON files. Refuses to overwrite existing files
 * unless --force is passed (preserve reversibility).
 */
const root = process.cwd();
const force = process.argv.includes("--force");

const targets: Array<[string, unknown]> = [
  ["data/catalog/games.json", { games: SEED.games }],
  ["data/catalog/products.json", { products: SEED.products }],
  ["data/catalog/categories.json", { categories: SEED.categories }],
  ["data/store/settings.json", SEED.settings],
  ["data/store/checkout-template.json", SEED.checkoutTemplate],
  ["data/store/access-control.json", SEED.accessControl],
];

for (const [rel, data] of targets) {
  const abs = join(root, rel);
  if (existsSync(abs) && !force) {
    console.log(`skip (exists): ${rel}`);
    continue;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`wrote: ${rel}`);
}
