import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import { validateFile } from "@/lib/catalog/schema";
import { validateCatalogIntegrity } from "@/lib/catalog/validation";
import type { CanonicalFileKey } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

const FILE_KEYS = ["games", "products", "categories", "settings", "checkout-template"] as const;
type DataFileKey = (typeof FILE_KEYS)[number];

/** Data inspector read (developer-only): raw canonical data + validation report. */
export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "data.inspect");
  if (denied) return denied;
  try {
    const { repo, mode } = getRepository(true);
    const read = await repo.readSnapshot();
    return jsonOk({
      files: {
        games: { games: read.snapshot.games },
        products: { products: read.snapshot.products },
        categories: { categories: read.snapshot.categories },
        settings: read.snapshot.settings,
        "checkout-template": read.snapshot.checkoutTemplate,
      },
      fileShas: read.fileShas,
      revision: read.revision,
      adapter: mode,
      validation: validateCatalogIntegrity(read.snapshot),
    });
  } catch (e) {
    if (e instanceof RepoError) return jsonError(502, `repo.${e.kind}`, e.message);
    return jsonError(500, "internal", "Data tidak dapat dibaca.");
  }
}

const importSchema = z.object({
  action: z.literal("import"),
  baseRevision: z.string().min(1),
  baseFileShas: z.record(z.string(), z.string()),
  files: z.record(z.string(), z.unknown()).refine(
    (files) => Object.keys(files).length > 0 && Object.keys(files).every((k) => (FILE_KEYS as readonly string[]).includes(k)),
    { message: "Hanya berkas kanonik yang dapat diimpor." }
  ),
  confirm: z.literal(true),
});

const validateOnlySchema = z.object({ action: z.literal("validate"), files: z.record(z.string(), z.unknown()).optional() });

const bodySchema = z.union([importSchema, validateOnlySchema]);

/**
 * POST action=validate → validation report (optionally against provided raw files).
 * POST action=import  → developer-only raw import with schema validation + confirm flag.
 */
export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "data.importExport");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "bad-request", parsed.error.issues[0]?.message ?? "Permintaan tidak valid.");
  }

  if (parsed.data.action === "validate") {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();
    if (parsed.data.files && Object.keys(parsed.data.files).length > 0) {
      // Validate provided raw files as a candidate snapshot.
      const issues: import("@/lib/catalog/types").ValidationIssue[] = [];
      for (const key of FILE_KEYS) {
        const raw = (parsed.data.files as Record<string, unknown>)[key];
        if (raw === undefined) continue;
        const result = validateFile(key, raw);
        if (!result.ok) issues.push(...result.issues);
      }
      return jsonOk({ ok: issues.length === 0, issues });
    }
    return jsonOk(validateCatalogIntegrity(read.snapshot));
  }

  // action === "import"
  try {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();

    // Build the merged candidate snapshot from current + imported files.
    const currentSerialized: Record<DataFileKey, unknown> = {
      games: { games: read.snapshot.games },
      products: { products: read.snapshot.products },
      categories: { categories: read.snapshot.categories },
      settings: read.snapshot.settings,
      "checkout-template": read.snapshot.checkoutTemplate,
    };
    const merged: Record<DataFileKey, unknown> = { ...currentSerialized };
    for (const [key, raw] of Object.entries(parsed.data.files)) {
      merged[key as DataFileKey] = raw;
    }

    // Validate every file, then whole-snapshot integrity.
    const issues: import("@/lib/catalog/types").ValidationIssue[] = [];
    const validated: Record<DataFileKey, unknown> = {} as Record<DataFileKey, unknown>;
    for (const key of FILE_KEYS) {
      const result = validateFile(key, merged[key]);
      if (!result.ok) issues.push(...result.issues);
      else validated[key] = result.data;
    }
    if (issues.length > 0) {
      return jsonError(400, "validation", "Impor ditolak. Data tidak lolos validasi.", { issues });
    }
    const games = (validated.games as { games: typeof read.snapshot.games }).games;
    const products = (validated.products as { products: typeof read.snapshot.products }).products;
    const categories = (validated.categories as { categories: typeof read.snapshot.categories }).categories;
    const settings = validated.settings as typeof read.snapshot.settings;
    const checkoutTemplate = validated["checkout-template"] as typeof read.snapshot.checkoutTemplate;
    const integrity = validateCatalogIntegrity({ games, products, categories, settings, checkoutTemplate, accessControl: read.snapshot.accessControl });
    if (!integrity.ok) {
      return jsonError(400, "validation", "Impor ditolak. Integritas katalog gagal.", {
        issues: integrity.issues,
      });
    }

    const files: Partial<Record<CanonicalFileKey, string>> = {};
    for (const key of Object.keys(parsed.data.files) as DataFileKey[]) {
      files[key] = `${JSON.stringify(merged[key], null, 2)}\n`;
    }

    const result = await repo.writeFiles({
      files,
      baseRevision: parsed.data.baseRevision,
      baseFileShas: parsed.data.baseFileShas as Record<CanonicalFileKey, string>,
      message: "store: import catalog data",
      author: { name: session.email.split("@")[0], email: session.email },
    });

    return jsonOk({ revision: result.revision, writtenAt: result.writtenAt, files: result.files });
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "conflict" ? 409 : e.kind === "validation" ? 400 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    return jsonError(500, "internal", "Impor gagal. Data tidak berubah.");
  }
}
