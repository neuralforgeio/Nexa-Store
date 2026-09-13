import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import type { CanonicalFileKey } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

/**
 * Developer-only admin access control (D8).
 * GET  → current blocked state + audit metadata.
 * POST → block/unblock the Admin. Writes go through the repository
 *        (conflict-detected, validated) so GitHub mode persists too.
 */

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "access.manage");
  if (denied) return denied;
  try {
    const { repo, mode } = getRepository(true);
    const read = await repo.readSnapshot();
    return jsonOk({
      adminBlocked: read.snapshot.accessControl.adminBlocked,
      updatedAt: read.snapshot.accessControl.updatedAt ?? null,
      updatedBy: read.snapshot.accessControl.updatedBy ?? null,
      reason: read.snapshot.accessControl.reason ?? null,
      revision: read.revision,
      fileShas: read.fileShas,
      adapter: mode,
    });
  } catch (e) {
    if (e instanceof RepoError) return jsonError(502, `repo.${e.kind}`, e.message);
    return jsonError(500, "internal", "Status akses tidak dapat dibaca.");
  }
}

const updateSchema = z.object({
  baseRevision: z.string().min(1),
  baseFileShas: z.record(z.string(), z.string()),
  adminBlocked: z.boolean(),
  reason: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "access.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", "Data permintaan tidak valid.");
  }

  try {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();

    const next = {
      adminBlocked: parsed.data.adminBlocked,
      updatedAt: new Date().toISOString(),
      updatedBy: session.email,
      ...(parsed.data.adminBlocked && parsed.data.reason?.trim()
        ? { reason: parsed.data.reason.trim() }
        : {}),
    };

    const files: Partial<Record<CanonicalFileKey, string>> = {
      "access-control": `${JSON.stringify(next, null, 2)}\n`,
    };

    const result = await repo.writeFiles({
      files,
      baseRevision: parsed.data.baseRevision,
      baseFileShas: parsed.data.baseFileShas as Record<CanonicalFileKey, string>,
      message: parsed.data.adminBlocked ? "store: block admin access" : "store: unblock admin access",
      author: { name: session.email.split("@")[0], email: session.email },
    });

    return jsonOk({
      revision: result.revision,
      commitMessage: result.commitMessage,
      writtenAt: result.writtenAt,
      adminBlocked: next.adminBlocked,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "conflict" ? 409 : e.kind === "validation" ? 400 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    return jsonError(500, "internal", "Status akses gagal diperbarui. Data tidak berubah.");
  }
}
