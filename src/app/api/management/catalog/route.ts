import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import {
  applyOperations,
  commitMessageFor,
  operationSchema,
  serializeFile,
  MutationError,
} from "@/lib/catalog/mutations";
import type { CanonicalFileKey } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

/** Full snapshot for management UI (includes disabled records + revision token). */
export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "catalog.read");
  if (denied) return denied;
  try {
    const { repo, mode } = getRepository(true);
    const read = await repo.readSnapshot();
    return jsonOk({
      games: read.snapshot.games,
      products: read.snapshot.products,
      categories: read.snapshot.categories,
      revision: read.revision,
      fileShas: read.fileShas,
      adapter: mode,
      readAt: read.readAt,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      return jsonError(502, `repo.${e.kind}`, e.message);
    }
    return jsonError(500, "internal", "Data katalog tidak dapat dimuat.");
  }
}

const mutationRequestSchema = z.object({
  baseRevision: z.string().min(1),
  baseFileShas: z.record(z.string(), z.string()),
  operations: z.array(operationSchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "products.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = mutationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "bad-request", parsed.error.issues[0]?.message ?? "Permintaan tidak valid.");
  }
  const { baseRevision, baseFileShas, operations } = parsed.data;

  try {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();

    // Apply + validate the proposed batch against the CURRENT server state.
    const applied = applyOperations(read.snapshot, operations);

    // Determine which canonical files actually change.
    const files: Partial<Record<CanonicalFileKey, string>> = {};
    const candidates: CanonicalFileKey[] = ["games", "products", "categories"];
    for (const key of candidates) {
      const serialized = serializeFile(key, applied);
      const current = JSON.stringify(
        key === "games" ? { games: read.snapshot.games } : key === "products" ? { products: read.snapshot.products } : { categories: read.snapshot.categories }
      );
      const proposedJson = JSON.parse(serialized);
      if (JSON.stringify(proposedJson) !== current) {
        files[key] = serialized;
      }
    }
    if (Object.keys(files).length === 0) {
      return jsonError(400, "no-op", "Tidak ada perubahan untuk disinkronkan.");
    }

    const message = commitMessageFor(operations);
    const result = await repo.writeFiles({
      files,
      baseRevision,
      baseFileShas: baseFileShas as Record<CanonicalFileKey, string>,
      message,
      author: { name: session.email.split("@")[0], email: session.email },
    });

    // Success is reported ONLY after persistence returned (PRD §34, AC-06).
    return jsonOk({
      revision: result.revision,
      commitMessage: result.commitMessage,
      files: result.files,
      writtenAt: result.writtenAt,
      diff: applied.diff,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "conflict" ? 409 : e.kind === "validation" ? 400 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    if (e instanceof MutationError) {
      return jsonError(400, "mutation-invalid", e.message);
    }
    return jsonError(500, "internal", "Perubahan gagal disinkronkan. Data tidak berubah.");
  }
}
