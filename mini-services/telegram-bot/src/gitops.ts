/**
 * Operasi git lokal (sinkron sandbox) + GitHub API (daftar commit & versi).
 * Bot tidak pernah mendorong sendiri: tulis data dilakukan aplikasi produksi
 * lewat API-nya sendiri (write-through GitHub). Modul ini hanya menjaga repo
 * sandbox tetap sejajar supaya pratinjau panel ikut data terbaru.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config";

const exec = promisify(execFile);

export type CommitInfo = {
  sha: string;
  title: string;
  date: string;
  author: string;
};

function authedRemoteUrl(): string {
  // Repo privat — token dipakai hanya untuk fetch (baca).
  return `https://x-access-token:${config.githubToken}@github.com/${config.githubRepo}.git`;
}

/** Daftar commit terbaru lewat GitHub API (sumber kebenaran untuk deploy). */
export async function listCommits(limit = 10): Promise<CommitInfo[]> {
  const res = await fetch(
    `https://api.github.com/repos/${config.githubRepo}/commits?per_page=${limit}`,
    {
      headers: {
        // Tanpa token (repo publik / akses anonim) — header auth dilewati.
        ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
        accept: "application/vnd.github+json",
        "user-agent": "nexastore-telegram-bot",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub commits gagal (${res.status}).`);
  }
  const list = (await res.json()) as Array<{
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
  }>;
  return list.map((c) => ({
    sha: c.sha,
    title: c.commit.message.split("\n")[0],
    date: c.commit.author.date,
    author: c.commit.author.name,
  }));
}

/** Versi aplikasi dari package.json di GitHub (cache 5 menit). */
let versionCache: { at: number; value: string } | null = null;

export async function fetchAppVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < 5 * 60_000) return versionCache.value;
  const res = await fetch(
    `https://api.github.com/repos/${config.githubRepo}/contents/package.json?ref=${config.githubBranch}`,
    {
      headers: {
        ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
        accept: "application/vnd.github+json",
        "user-agent": "nexastore-telegram-bot",
      },
    }
  );
  if (!res.ok) throw new Error(`Baca package.json gagal (${res.status}).`);
  const json = (await res.json()) as { content?: string; encoding?: string };
  const raw = Buffer.from(json.content ?? "", json.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  const version = (JSON.parse(raw) as { version?: string }).version ?? "?";
  versionCache = { at: Date.now(), value: version };
  return version;
}

export type SyncResult = { ok: boolean; detail: string };

/**
 * Selaraskan repo sandbox dengan remote (fetch + rebase --autostash).
 * Non-fatal: kegagalan hanya jadi catatan, tidak menggagalkan aksi bot.
 */
export async function syncSandbox(): Promise<SyncResult> {
  // Tanpa token tidak ada yang bisa disinkronkan (repo privat).
  if (!config.githubToken) return { ok: false, detail: "GITHUB_TOKEN belum diisi" };
  try {
    const url = authedRemoteUrl();
    await exec("git", ["fetch", url, config.githubBranch], { cwd: config.repoDir, timeout: 60_000 });
    const { stdout } = await exec("git", ["rebase", "--autostash", "FETCH_HEAD"], {
      cwd: config.repoDir,
      timeout: 60_000,
    });
    const summary = stdout.trim().split("\n").filter((l) => l.includes("file changed") || l.includes("files changed"))[0];
    return { ok: true, detail: summary?.trim() ?? "sudah terbaru" };
  } catch (e) {
    // Pulihkan state rebase agar sandbox tidak tergantung di tengah jalan.
    try {
      await exec("git", ["rebase", "--abort"], { cwd: config.repoDir, timeout: 30_000 });
    } catch {
      // abaikan — bisa jadi tidak ada rebase yang berjalan
    }
    return { ok: false, detail: (e as Error).message.split("\n")[0] };
  }
}
