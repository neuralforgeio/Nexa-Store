import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import { validateFile } from "@/lib/catalog/schema";
import { validateCatalogIntegrity } from "@/lib/catalog/validation";
import type { CanonicalFileKey } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

const ALL_KEYS: CanonicalFileKey[] = ["games", "products", "categories", "settings", "checkout-template"];

/**
 * Git sync panel + rollback-oriented inspection (PRD §17.1, §43).
 * GET ?action=status        → adapter, revision, history
 * GET ?action=inspect&ref=  → raw canonical files at a revision
 * GET ?action=diff&ref=     → restore preview (summary vs current)
 * POST { action:"restore", ref, baseRevision, confirm } → restore as a NEW write.
 */
export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "rollback.inspect");
  if (denied) return denied;

  const action = req.nextUrl.searchParams.get("action") ?? "status";
  try {
    const { repo, mode } = getRepository(true);

    if (action === "status") {
      const read = await repo.readSnapshot();
      const history = await repo.history(20);
      const health = await repo.health();
      return jsonOk({
        adapter: mode,
        revision: read.revision,
        readAt: read.readAt,
        history,
        health,
      });
    }

    if (action === "inspect") {
      const ref = req.nextUrl.searchParams.get("ref");
      if (!ref) return jsonError(400, "bad-request", "Parameter ref wajib.");
      const files: Partial<Record<CanonicalFileKey, unknown>> = {};
      for (const key of ALL_KEYS) {
        try {
          files[key] = await repo.readFileAt(ref, key);
        } catch {
          files[key] = null;
        }
      }
      return jsonOk({ ref, files });
    }

    if (action === "diff") {
      const ref = req.nextUrl.searchParams.get("ref");
      if (!ref) return jsonError(400, "bad-request", "Parameter ref wajib.");
      const current = await repo.readSnapshot();
      const result = {
        ref,
        gamesChanged: 0,
        productsChanged: 0,
        settingsChanged: false,
        templateChanged: false,
        lines: [] as string[],
      };

      const refGames = (await repo.readFileAt(ref, "games")) as { games: typeof current.snapshot.games } | null;
      const refProducts = (await repo.readFileAt(ref, "products")) as
        | { products: typeof current.snapshot.products }
        | null;

      if (refGames) {
        const byId = new Map(refGames.games.map((g) => [g.id, g]));
        for (const g of current.snapshot.games) {
          const old = byId.get(g.id);
          if (old && (old.name !== g.name || old.enabled !== g.enabled || old.slug !== g.slug)) {
            result.gamesChanged++;
          }
          if (!old) {
            result.gamesChanged++;
            result.lines.push(`Game ${g.name} tidak ada di revisi ${ref} (akan dihapus saat restore)`);
          }
        }
        for (const g of refGames.games) {
          if (!current.snapshot.games.some((x) => x.id === g.id)) {
            result.gamesChanged++;
            result.lines.push(`Game ${g.name} akan dikembalikan dari ${ref}`);
          }
        }
      }

      if (refProducts) {
        const byId = new Map(refProducts.products.map((p) => [p.id, p]));
        for (const p of current.snapshot.products) {
          const old = byId.get(p.id);
          if (!old) {
            result.productsChanged++;
            result.lines.push(`${p.denomination} ${p.name}: akan dihapus saat restore`);
          } else if (old.priceIdr !== p.priceIdr) {
            result.productsChanged++;
            result.lines.push(`${p.denomination} ${p.name} (${p.gameId}): ${old.priceIdr} → ${p.priceIdr}`);
          } else if (old.enabled !== p.enabled) {
            result.productsChanged++;
          }
        }
        for (const p of refProducts.products) {
          if (!current.snapshot.products.some((x) => x.id === p.id)) {
            result.productsChanged++;
            result.lines.push(`${p.denomination} ${p.name} (${p.gameId}): akan dikembalikan dari ${ref}`);
          }
        }
      }

      try {
        const refSettings = (await repo.readFileAt(ref, "settings")) as typeof current.snapshot.settings | null;
        if (refSettings && JSON.stringify(refSettings) !== JSON.stringify(current.snapshot.settings)) {
          result.settingsChanged = true;
          result.lines.push("Pengaturan store berubah");
        }
      } catch {
        /* optional */
      }
      try {
        const refTemplate = (await repo.readFileAt(ref, "checkout-template")) as
          | typeof current.snapshot.checkoutTemplate
          | null;
        if (refTemplate && refTemplate.template !== current.snapshot.checkoutTemplate.template) {
          result.templateChanged = true;
          result.lines.push("Template checkout berubah");
        }
      } catch {
        /* optional */
      }

      return jsonOk(result);
    }

    return jsonError(400, "bad-request", "Aksi tidak dikenal.");
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "not-found" ? 404 : e.kind === "validation" ? 400 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    return jsonError(500, "internal", "Status sinkronisasi tidak dapat dimuat.");
  }
}

const restoreSchema = z.object({
  action: z.literal("restore"),
  ref: z.string().min(1),
  baseRevision: z.string().min(1),
  confirm: z.literal(true),
});

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "rollback.inspect");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = restoreSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "bad-request", "Restore membutuhkan konfirmasi eksplisit (confirm: true).");
  }

  try {
    const { repo } = getRepository(true);
    const current = await repo.readSnapshot();

    // Read + validate the target snapshot BEFORE writing (no destructive surprises).
    const candidate: Record<CanonicalFileKey, unknown> = {} as Record<CanonicalFileKey, unknown>;
    for (const key of ALL_KEYS) {
      candidate[key] = await repo.readFileAt(parsed.data.ref, key);
    }
    for (const key of ALL_KEYS) {
      const result = validateFile(key, candidate[key]);
      if (!result.ok) {
        return jsonError(400, "validation", `Revisi ${parsed.data.ref} tidak lolos validasi (${key}).`);
      }
    }
    const games = (candidate.games as { games: typeof current.snapshot.games }).games;
    const products = (candidate.products as { products: typeof current.snapshot.products }).products;
    const categories = (candidate.categories as { categories: typeof current.snapshot.categories }).categories;
    const settings = candidate.settings as typeof current.snapshot.settings;
    const checkoutTemplate = candidate["checkout-template"] as typeof current.snapshot.checkoutTemplate;
    const accessControl = candidate["access-control"] as typeof current.snapshot.accessControl;
    const integrity = validateCatalogIntegrity({ games, products, categories, settings, checkoutTemplate, accessControl });
    if (!integrity.ok) {
      return jsonError(400, "validation", `Revisi ${parsed.data.ref} gagal validasi integritas.`);
    }

    const files: Partial<Record<CanonicalFileKey, string>> = {};
    for (const key of ALL_KEYS) {
      files[key] = `${JSON.stringify(candidate[key], null, 2)}\n`;
    }

    const result = await repo.writeFiles({
      files,
      baseRevision: parsed.data.baseRevision,
      baseFileShas: current.fileShas,
      message: `store: restore data from ${parsed.data.ref}`,
      author: { name: session.email.split("@")[0], email: session.email },
    });

    return jsonOk({ revision: result.revision, writtenAt: result.writtenAt });
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "conflict" ? 409 : e.kind === "not-found" ? 404 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    return jsonError(500, "internal", "Restore gagal. Data tidak berubah.");
  }
}
