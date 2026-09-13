import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireCapability, getSession } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { RepoError } from "@/lib/catalog/repo/types";
import { settingsFileSchema, checkoutTemplateFileSchema } from "@/lib/catalog/schema";
import { validateCatalogIntegrity } from "@/lib/catalog/validation";
import { UnknownPlaceholderError } from "@/lib/whatsapp/template";
import type { CanonicalFileKey } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "settings.manage");
  if (denied) return denied;
  try {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();
    return jsonOk({
      settings: read.snapshot.settings,
      checkoutTemplate: read.snapshot.checkoutTemplate,
      revision: read.revision,
      fileShas: read.fileShas,
      readAt: read.readAt,
    });
  } catch (e) {
    if (e instanceof RepoError) return jsonError(502, `repo.${e.kind}`, e.message);
    return jsonError(500, "internal", "Pengaturan tidak dapat dimuat.");
  }
}

const settingsUpdateSchema = z.object({
  baseRevision: z.string().min(1),
  baseFileShas: z.record(z.string(), z.string()),
  settings: settingsFileSchema,
  checkoutTemplate: checkoutTemplateFileSchema,
});

export async function POST(req: NextRequest) {
  const denied = await requireCapability(req, "settings.manage");
  if (denied) return denied;
  const session = getSession(req);
  if (!session.email) return jsonError(401, "unauthorized", "Masuk terlebih dahulu.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad-request", "Permintaan tidak valid.");
  }
  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "validation",
      parsed.error.issues[0]?.message ?? "Data pengaturan tidak valid."
    );
  }

  try {
    const { repo } = getRepository(true);
    const read = await repo.readSnapshot();

    const stampedTemplate = {
      ...parsed.data.checkoutTemplate,
      updatedAt: new Date().toISOString(),
      updatedBy: session.email,
    };

    // Full-snapshot integrity validation BEFORE writing (R6, PRD §35).
    const integrity = validateCatalogIntegrity({
      ...read.snapshot,
      settings: parsed.data.settings,
      checkoutTemplate: stampedTemplate,
    });
    if (!integrity.ok) {
      const first = integrity.issues[0];
      return jsonError(
        400,
        "validation",
        `${first.file}${first.recordId ? ` (${first.recordId})` : ""} — ${first.reason}`
      );
    }

    const files: Partial<Record<CanonicalFileKey, string>> = {
      settings: `${JSON.stringify(parsed.data.settings, null, 2)}\n`,
      "checkout-template": `${JSON.stringify(stampedTemplate, null, 2)}\n`,
    };

    const result = await repo.writeFiles({
      files,
      baseRevision: parsed.data.baseRevision,
      baseFileShas: parsed.data.baseFileShas as Record<CanonicalFileKey, string>,
      message: "store: update checkout settings",
      author: { name: session.email.split("@")[0], email: session.email },
    });

    return jsonOk({
      revision: result.revision,
      commitMessage: result.commitMessage,
      writtenAt: result.writtenAt,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      const status = e.kind === "conflict" ? 409 : e.kind === "validation" ? 400 : 502;
      return jsonError(status, `repo.${e.kind}`, e.message);
    }
    if (e instanceof UnknownPlaceholderError) {
      return jsonError(400, "validation", e.message);
    }
    return jsonError(500, "internal", "Pengaturan gagal disimpan. Data tidak berubah.");
  }
}
