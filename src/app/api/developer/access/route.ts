import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import { normalizeGate } from "@/lib/catalog/site-control";
import type { CanonicalFileKey } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

/**
 * Developer-only access control (D8) + site control (lockdown/maintenance).
 * GET  → admin block state + site gates + audit metadata.
 * POST → block/unblock the Admin and/or set site gates. Writes go through
 *        the repository (conflict-detected, validated) so GitHub mode
 *        persists too. Fields not included in the request are preserved.
 */

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "access.manage");
  if (denied) return denied;
  try {
    const { repo, mode } = getRepository(true);
    const read = await repo.readSnapshot();
    const control = read.snapshot.accessControl;
    return jsonOk({
      adminBlocked: control.adminBlocked,
      updatedAt: control.updatedAt ?? null,
      updatedBy: control.updatedBy ?? null,
      reason: control.reason ?? null,
      lockdown: normalizeGate(control.lockdown),
      maintenance: normalizeGate(control.maintenance),
      revision: read.revision,
      fileShas: read.fileShas,
      adapter: mode,
    });
  } catch (e) {
    if (e instanceof RepoError) return jsonError(502, `repo.${e.kind}`, e.message);
    return jsonError(500, "internal", "Status akses tidak dapat dibaca.");
  }
}

const siteGateInput = z.object({
  active: z.boolean(),
  scope: z.enum(["all", "routes"]),
  routes: z.array(z.string()).max(12),
  note: z.string().max(300).optional(),
});

const updateSchema = z
  .object({
    baseRevision: z.string().min(1),
    baseFileShas: z.record(z.string(), z.string()),
    adminBlocked: z.boolean().optional(),
    reason: z.string().max(300).optional(),
    siteControl: z
      .object({
        lockdown: siteGateInput.optional(),
        maintenance: siteGateInput.optional(),
      })
      .optional(),
  })
  .refine(
    (v) => v.adminBlocked !== undefined || v.siteControl !== undefined,
    { message: "Perubahan kosong — kirim adminBlocked atau siteControl." }
  );

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
  const input = parsed.data;

  try {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();
    const current = read.snapshot.accessControl;

    const now = new Date().toISOString();
    const next: typeof current = { ...current };

    // Admin block — preserved fields when only siteControl was sent.
    if (input.adminBlocked !== undefined) {
      next.adminBlocked = input.adminBlocked;
      next.updatedAt = now;
      next.updatedBy = session.email;
      if (input.adminBlocked && input.reason?.trim()) {
        next.reason = input.reason.trim();
      } else if (!input.adminBlocked) {
        delete next.reason;
      }
    }

    let commitMessage = "store: update access control";

    // Site gates — each carries its own audit metadata.
    if (input.siteControl) {
      if (input.siteControl.lockdown) {
        next.lockdown = {
          ...input.siteControl.lockdown,
          note: input.siteControl.lockdown.note?.trim() || undefined,
          updatedAt: now,
          updatedBy: session.email,
        };
        commitMessage = next.lockdown.active
          ? next.lockdown.scope === "all"
            ? "store: activate total lockdown"
            : "store: activate lockdown on selected routes"
          : "store: deactivate lockdown";
      }
      if (input.siteControl.maintenance) {
        next.maintenance = {
          ...input.siteControl.maintenance,
          note: input.siteControl.maintenance.note?.trim() || undefined,
          updatedAt: now,
          updatedBy: session.email,
        };
        if (input.siteControl.lockdown === undefined) {
          commitMessage = next.maintenance.active
            ? next.maintenance.scope === "all"
              ? "store: activate site-wide maintenance"
              : "store: activate maintenance on selected routes"
            : "store: deactivate maintenance";
        }
      }
    } else if (input.adminBlocked !== undefined) {
      commitMessage = input.adminBlocked
        ? "store: block admin access"
        : "store: unblock admin access";
    }

    const files: Partial<Record<CanonicalFileKey, string>> = {
      "access-control": `${JSON.stringify(next, null, 2)}\n`,
    };

    const result = await repo.writeFiles({
      files,
      baseRevision: input.baseRevision,
      baseFileShas: input.baseFileShas as Record<CanonicalFileKey, string>,
      message: commitMessage,
      author: { name: session.email.split("@")[0], email: session.email },
    });

    return jsonOk({
      revision: result.revision,
      commitMessage: result.commitMessage,
      writtenAt: result.writtenAt,
      adminBlocked: next.adminBlocked,
      lockdown: next.lockdown ?? null,
      maintenance: next.maintenance ?? null,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "conflict" ? 409 : e.kind === "validation" ? 400 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    return jsonError(500, "internal", "Status akses gagal diperbarui. Data tidak berubah.");
  }
}
