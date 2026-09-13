# Nexa Store — Data Model

Berkas kanonik (satu sumber kebenaran per data, tanpa duplikasi — PRD §3.2):

```text
data/catalog/games.json       { games: Game[] }
data/catalog/products.json    { products: Product[] }
data/catalog/categories.json  { categories: Category[] }
data/store/settings.json      StoreSettings
data/store/checkout-template.json  CheckoutTemplate
```

Runtime lokal (bukan konten, di-gitignore): `data/store/.sync.json` (ledger revisi), `data/store/.history/*.json` (snapshot rollback, maks 40).

## Skema (Zod — `src/lib/catalog/schema.ts`)

```ts
Game = {
  id, slug (kebab-case unik), name,
  description?, image?,
  categoryIds: string[],
  orderFieldSchema: OrderField[]   // key unik, type text|number, required,
                                   // placeholder?, minLength?, maxLength?, pattern?
  enabled, sortOrder
}

Category = { id, slug unik, name, description?, enabled, sortOrder }

Product = {
  id, gameId (harus ada), categoryId? (harus ada bila diisi),
  name, denomination, bonus?,
  priceIdr: integer ≥ 0,          // float DITOLAK; produk aktif wajib > 0
  currency: "IDR", enabled, sortOrder, note?
}

StoreSettings = {
  storeName, whatsappNumber, currency: "IDR", locale: "id-ID",
  announcement?, maintenanceMode, maintenanceMessage?, supportNote?
}

CheckoutTemplate = { template, updatedAt?, updatedBy? }
```

## Aturan integritas lintas-record (`validation.ts`, PRD §36)

ID/slug produk-game-kategori unik · produk menunjuk game yang ada · kategori rujukan valid · game nonaktif tidak boleh punya produk aktif · harga integer aman · placeholder template ter-allowlist + minimal satu · maintenance aktif wajib punya pesan.

Setiap pelanggaran dilaporkan dengan `{file, recordId, field, reason}` (PRD §35).

## Seed

61 produk / 8 game, harga verbatim dari PRD §14 — dijaga oleh `tests/unit/seed-parity.test.ts` (nilai komersial tidak boleh "dikoreksi" tanpa instruksi — PRD §53).
