/**
 * Klien Vercel — daftar deployment produksi & deploy dari commit sha mana pun.
 * Primitif inti: POST /v13/deployments dengan gitSource {type:"github", repoId,
 * orgId, ref, sha} (terverifikasi langsung terhadap proyek nexastoregame).
 */
import { config } from "./config";

export class VercelError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "VercelError";
  }
}

export type DeploymentInfo = {
  uid: string;
  state: string;
  target: string | null;
  createdMs: number;
  sha: string;
  commitTitle: string;
  url: string | null;
};

async function api<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.vercelToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) {
    throw new VercelError(json.error?.message ?? `Vercel ${method} ${path} gagal (${res.status}).`, res.status);
  }
  return json as T;
}

function teamQuery(): string {
  return config.vercelTeam ? `teamId=${config.vercelTeam}` : "";
}

type RawDeployment = {
  uid: string;
  state: string;
  target?: string | null;
  createdAt: number;
  url?: string;
  meta?: Record<string, string>;
};

export async function listProductionDeployments(limit = 8): Promise<DeploymentInfo[]> {
  const json = await api<{ deployments?: RawDeployment[] }>(
    "GET",
    `/v6/deployments?app=${config.vercelProject}&${teamQuery()}&limit=${limit * 2}`
  );
  const all = json.deployments ?? [];
  return all
    .filter((d) => d.target === "production")
    .slice(0, limit)
    .map((d) => ({
      uid: d.uid,
      state: d.state,
      target: d.target ?? null,
      createdMs: d.createdAt,
      sha: d.meta?.githubCommitSha ?? "",
      commitTitle: (d.meta?.githubCommitMessage ?? "tanpa pesan commit").split("\n")[0],
      url: d.url ?? null,
    }));
}

export async function latestProductionDeployment(): Promise<DeploymentInfo | null> {
  const list = await listProductionDeployments(1);
  return list[0] ?? null;
}

/** Deploy commit tertentu ke produksi. Mengembalikan uid deployment baru. */
export async function deployFromSha(sha: string): Promise<string> {
  const json = await api<{ id?: string; uid?: string; readyState?: string; error?: { message?: string } }>(
    "POST",
    `/v13/deployments?${teamQuery()}&skipAutoDetectionConfirmation=1`,
    {
      name: config.vercelProject,
      target: "production",
      gitSource: {
        type: "github",
        repoId: Number(config.vercelRepoId),
        orgId: Number(config.vercelOrgId),
        repo: config.githubRepo,
        ref: config.githubBranch,
        sha,
      },
    }
  );
  const uid = json.id ?? json.uid;
  if (!uid) {
    throw new VercelError(json.error?.message ?? "Vercel tidak mengembalikan id deployment.", 500);
  }
  return uid;
}

export type PollResult = { state: string; url: string | null };

/**
 * Pantau hingga selesai (READY/ERROR/CANCELED) dengan batas waktu.
 * Dipanggil di background oleh handler — hasil dikirim sebagai pesan baru.
 */
export async function waitUntilDone(uid: string, timeoutMs = 6 * 60_000): Promise<PollResult> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8_000));
    const json = await api<{ readyState?: string; state?: string; url?: string }>("GET", `/v13/deployments/${uid}?${teamQuery()}`);
    const state = json.readyState ?? json.state ?? "UNKNOWN";
    if (json.url) lastUrl = json.url;
    if (state === "READY" || state === "ERROR" || state === "CANCELED") {
      return { state, url: lastUrl };
    }
  }
  return { state: "TIMEOUT", url: lastUrl };
}
