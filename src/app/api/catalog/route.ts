import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import type { Product } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

/**
 * Public catalog endpoint (storefront data source).
 * Exposes ONLY enabled games/products/categories — never disabled records,
 * never raw files, never adapter internals (PRD §29.8: no per-visitor GitHub calls).
 */
export async function GET(_req: NextRequest) {
  try {
    const { repo, mode } = getRepository(true);
    const read = await repo.readSnapshot();
    const { snapshot } = read;

    const enabledGames = snapshot.games
      .filter((g) => g.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        slug: g.slug,
        name: g.name,
        description: g.description ?? null,
        image: g.image ?? null,
        orderFields: g.orderFieldSchema,
        productCount: snapshot.products.filter((p) => p.gameId === g.id && p.enabled).length,
        categoryIds: g.categoryIds,
        sortOrder: g.sortOrder,
      }));

    const gameIds = new Set(enabledGames.map((g) => g.id));
    const enabledProducts: Product[] = snapshot.products
      .filter((p) => p.enabled && gameIds.has(p.gameId))
      .sort((a, b) => (a.gameId === b.gameId ? a.sortOrder - b.sortOrder : 0));

    return jsonOk({
      store: {
        name: snapshot.settings.storeName,
        whatsappNumber: snapshot.settings.whatsappNumber,
        announcement: snapshot.settings.announcement?.trim() || null,
        maintenanceMode: snapshot.settings.maintenanceMode,
        maintenanceMessage: snapshot.settings.maintenanceMessage?.trim() || null,
        supportNote: snapshot.settings.supportNote?.trim() || null,
        currency: snapshot.settings.currency,
        locale: snapshot.settings.locale,
      },
      checkoutTemplate: snapshot.checkoutTemplate.template,
      games: enabledGames,
      categories: snapshot.categories
        .filter((c) => c.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      products: enabledProducts,
      revision: read.revision,
      adapter: mode,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      const status =
        e.kind === "validation" ? 500 : e.kind === "not-found" ? 503 : 502;
      return jsonError(status, `repo.${e.kind}`, "Katalog tidak dapat dimuat. Coba lagi.");
    }
    return jsonError(500, "internal", "Katalog tidak dapat dimuat. Coba lagi.");
  }
}
