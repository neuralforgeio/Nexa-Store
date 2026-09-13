import type { CatalogRepository } from "./types";
import { LocalCatalogRepository } from "./local";
import { GitHubCatalogRepository, githubConfigFromEnv } from "./github";

/**
 * Adapter selection (A2/D2): GitHub when fully configured, local otherwise.
 * The active mode is surfaced honestly in developer diagnostics — never faked.
 */

let cached: { repo: CatalogRepository; mode: "local" | "github" } | null = null;

export function getRepository(forceFresh = false): { repo: CatalogRepository; mode: "local" | "github" } {
  if (cached && !forceFresh) return cached;
  const config = githubConfigFromEnv();
  const next = config
    ? { repo: new GitHubCatalogRepository(config), mode: "github" as const }
    : { repo: new LocalCatalogRepository(), mode: "local" as const };
  cached = next;
  return next;
}

export function persistenceMode(): "local" | "github" {
  return getRepository().mode;
}

export type { CatalogRepository } from "./types";
export { RepoError } from "./types";
