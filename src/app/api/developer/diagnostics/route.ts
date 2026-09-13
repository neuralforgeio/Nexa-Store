import { NextRequest } from "next/server";
import { jsonOk, requireCapability } from "@/lib/api/http";
import { getRepository } from "@/lib/catalog/repo";
import { validateCatalogIntegrity } from "@/lib/catalog/validation";
import { authConfigured } from "@/lib/auth/credentials";
import { githubConfigFromEnv } from "@/lib/catalog/repo/github";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Developer diagnostics (PRD §17.3): observed facts only.
 * Environment values are NEVER included — presence booleans only.
 */
export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "diagnostics.repository");
  if (denied) return denied;

  const { repo, mode } = getRepository(true);
  const github = githubConfigFromEnv();

  let health = { adapter: mode, ok: false, detail: "Tidak dapat diperiksa" };
  let validation = { ok: false, issues: [] as unknown[] };
  let revision: string | null = null;
  let lastCommit: { message: string; at: string } | null = null;

  try {
    health = await repo.health();
  } catch {
    // keep default
  }
  try {
    const read = await repo.readSnapshot();
    revision = read.revision;
    validation = validateCatalogIntegrity(read.snapshot);
  } catch {
    validation = { ok: false, issues: ["Snapshot tidak dapat dibaca untuk validasi."] };
  }
  try {
    const history = await repo.history(1);
    if (history[0]) lastCommit = { message: history[0].message, at: history[0].at };
  } catch {
    // keep null
  }

  return jsonOk({
    app: { name: "Nexa Store", version: APP_VERSION },
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      persistenceMode: mode,
    },
    environment: {
      authConfigured: authConfigured(),
      sessionSecretPresent: Boolean(process.env.SESSION_SECRET),
      githubConfigured: Boolean(github),
      githubTarget: github ? `${github.owner}/${github.repository} @ ${github.branch}` : null,
    },
    repository: { health, revision, lastCommit },
    validation,
  });
}
