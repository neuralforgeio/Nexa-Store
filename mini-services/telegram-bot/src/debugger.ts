/**
 * Static security & bug scanner (v1.7.0) — /debugging.
 *
 * Memindai source code aplikasi ini sendiri lewat dua penyedia:
 *  - Panel (sandbox): filesystem lokal (instan).
 *  - Vercel (webhook): GitHub Trees + Contents API (token organisasi).
 *
 * Bukan gimmick: aturan nyata berbasis ekspresi reguler per-baris + satu
 * pemeriksaan struktural (route API mutasi tanpa guard capability), dengan
 * severity, potongan kode, dan saran perbaikan. Temuan jujur — termasuk
 * pada kode bot ini sendiri.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Finding = {
  ruleId: string;
  severity: Severity;
  title: string;
  file: string;
  line: number;
  snippet: string;
  suggestion: string;
};

export type ScanResult = {
  filesScanned: number;
  linesScanned: number;
  durationMs: number;
  mode: "local" | "github";
  truncated: boolean;
  findings: Finding[];
};

// ---------------------------------------------------------------------------
// Rules — regex per-baris. selfFile menandai file yang dikecualikan (scanner ini).
// ---------------------------------------------------------------------------

type Rule = {
  id: string;
  severity: Severity;
  title: string;
  pattern: RegExp;
  suggestion: string;
  /** Batas contoh per aturan (agar laporan ringkas). */
  maxExamples?: number;
};

const RULES: Rule[] = [
  {
    id: "secret-telegram-token",
    severity: "critical",
    title: "Token bot Telegram tertanam di kode",
    pattern: /bot\d{8,}:[A-Za-z0-9_-]{30,}/,
    suggestion: "Pindahkan ke environment variable (TELEGRAM_BOT_TOKEN). Rotasi token segera bila sudah terekspos.",
    maxExamples: 3,
  },
  {
    id: "secret-github-pat",
    severity: "critical",
    title: "GitHub PAT tertanam di kode",
    pattern: /ghp_[A-Za-z0-9]{30,}/,
    suggestion: "Hapus dari kode; pakai env GITHUB_TOKEN. Rotasi token.",
    maxExamples: 3,
  },
  {
    id: "secret-vercel-token",
    severity: "critical",
    title: "Token Vercel tertanam di kode",
    pattern: /vcp_[A-Za-z0-9]{40,}/,
    suggestion: "Hapus dari kode; pakai env VERCEL_TOKEN. Rotasi token.",
    maxExamples: 3,
  },
  {
    id: "dangerous-eval",
    severity: "high",
    title: "eval() digunakan",
    pattern: /(^|[^.\w])eval\s*\(/,
    suggestion: "Ganti dengan parsing eksplisit (JSON.parse / fungsi murni). eval = celah RCE.",
    maxExamples: 3,
  },
  {
    id: "dangerous-new-function",
    severity: "high",
    title: "new Function() digunakan",
    pattern: /new\s+Function\s*\(/,
    suggestion: "Sama seperti eval — hindari konstruktor fungsi dinamis dari string.",
    maxExamples: 3,
  },
  {
    id: "xss-dangerously-innerhtml",
    severity: "medium",
    title: "dangerouslySetInnerHTML (perlu review XSS)",
    pattern: /dangerouslySetInnerHTML/,
    suggestion: "Pastikan konten disanitasi (DOMPurify) atau berasal dari sumber tepercaya statis.",
    maxExamples: 5,
  },
  {
    id: "xss-raw-innerhtml",
    severity: "medium",
    title: "El.innerHTML = … (raw DOM injection)",
    pattern: /\.innerHTML\s*=/,
    suggestion: "Pakai textContent atau framework rendering untuk mencegah XSS.",
    maxExamples: 5,
  },
  {
    id: "child-process-exec",
    severity: "medium",
    title: "child_process.exec dengan string terinterpolasi (risiko injeksi shell)",
    pattern: /(^|[^.\w])exec(?:Sync)?\s*\(\s*[`"'][^`"']*[$+]/,
    suggestion: "Pakai execFile/spawn dengan argumen array — bukan string yang diinterpolasi.",
    maxExamples: 3,
  },
  {
    id: "child-process-sync",
    severity: "low",
    title: "child_process sinkron (execSync) memblokir event loop",
    pattern: /execSync\s*\(|execFileSync\s*\(/,
    suggestion: "Gunakan varian async agar runtime tidak membeku.",
    maxExamples: 3,
  },
  {
    id: "secret-console-log",
    severity: "medium",
    title: "Kredensial berpotensi ter-log",
    pattern: /console\.(log|info|debug|warn|error)\s*\([^)]*(password|secret|token|credential)/i,
    suggestion: "Jangan pernah mencetak nilai rahasia — log penanda non-sensitif saja.",
    maxExamples: 5,
  },
  {
    id: "next-ignore-build-errors",
    severity: "medium",
    title: "ignoreBuildErrors: true menyembunyikan type error",
    pattern: /ignoreBuildErrors:\s*true/,
    suggestion: "Idealnya false — tsc bersih sebelum rilis agar bug tipe tidak lolos.",
    maxExamples: 2,
  },
  {
    id: "insecure-http-url",
    severity: "low",
    title: "URL http:// hardcode (bukan localhost)",
    pattern: /["'`]http:\/\/(?!localhost|127\.0\.0\.1)/,
    suggestion: "Pakai https:// untuk endpoint eksternal.",
    maxExamples: 5,
  },
  {
    id: "comment-todo",
    severity: "info",
    title: "TODO/FIXME/HACK belum tuntas",
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/,
    suggestion: "Jadwalkan penyelesaian — komentar ini menandai pekerjaan terbuka.",
    maxExamples: 6,
  },
];

// ---------------------------------------------------------------------------
// Pemeriksaan struktural: route API mutasi tanpa guard.
// ---------------------------------------------------------------------------

/** Route yang dijaga mekanisme lain / memang publik by-design. */
const PUBLIC_API_PREFIXES = [
  "src/app/api/catalog/route.ts",
  "src/app/api/site-features/route.ts",
  "src/app/api/store-status/route.ts",
  "src/app/api/chat/messages/route.ts",
  "src/app/api/chat/clear/route.ts",
  "src/app/api/chat/subscribe/route.ts",
  "src/app/api/analytics/track/route.ts",
  "src/app/api/auth/",
  "src/app/api/orders/route.ts",
  "src/app/api/orders/track/route.ts",
  "src/app/api/reports/route.ts",
  "src/app/api/section-error/route.ts", // publik by-design: zod + rate-limit ketat, tanpa tulis data store
  "src/app/api/telegram/webhook/route.ts", // secret header sendiri
  "src/app/api/bot-service/route.ts", // dijaga env BOT_SERVICE_LAUNCH (404 di produksi)
];

function structuralFindings(files: Array<{ path: string; content: string }>): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    if (!f.path.startsWith("src/app/api/") || !f.path.endsWith("route.ts")) continue;
    if (PUBLIC_API_PREFIXES.some((p) => f.path.startsWith(p))) continue;
    const hasMutation = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/.test(f.content);
    if (!hasMutation) continue;
    const hasGuard = f.content.includes("requireCapability") || f.content.includes("getSession");
    if (!hasGuard) {
      out.push({
        ruleId: "api-mutation-without-guard",
        severity: "high",
        title: "Route API mutasi tanpa guard sesi/capability",
        file: f.path,
        line: 1,
        snippet: "export async function POST/PATCH/DELETE tanpa requireCapability",
        suggestion: "Tambah requireCapability(...) di setiap handler mutasi.",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sumber kode: filesystem lokal (panel) / GitHub API (Vercel).
// ---------------------------------------------------------------------------

type SourceFile = { path: string; content: string };

const SCAN_ROOTS = ["src", "mini-services/telegram-bot/src"];
const EXTRA_FILES = ["next.config.ts"];
const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 320;

function collectLocal(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= MAX_FILES) return;
      if (name === "node_modules" || name.startsWith(".")) continue;
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(abs, r);
      } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
        try {
          if (statSync(abs).size > MAX_FILE_BYTES) continue;
          out.push({ path: r, content: readFileSync(abs, "utf8") });
        } catch {
          // abaikan file yang tak terbaca
        }
      }
    }
  };
  for (const root of SCAN_ROOTS) {
    const abs = join(config.repoDir, root);
    if (existsSync(abs)) walk(abs, root);
  }
  for (const extra of EXTRA_FILES) {
    const abs = join(config.repoDir, extra);
    try {
      if (existsSync(abs)) out.push({ path: extra, content: readFileSync(abs, "utf8") });
    } catch {
      // abaikan
    }
  }
  return out;
}

async function collectGithub(): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { files: [], truncated: true };
  const repo = config.githubRepo || "neuralforgeio/Nexa-Store";
  const branch = config.githubBranch || "main";

  const gh = async (path: string): Promise<unknown> => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "nexa-debugger",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  };

  const tree = (await gh(`git/trees/${branch}?recursive=1`)) as {
    tree?: Array<{ path: string; type: string; size?: number }>;
  };
  const wanted = (tree.tree ?? [])
    .filter((e) => e.type === "blob" && /\.(ts|tsx|js|mjs)$/.test(e.path))
    .filter((e) => SCAN_ROOTS.some((r) => e.path.startsWith(`${r}/`)) || EXTRA_FILES.includes(e.path))
    .filter((e) => (e.size ?? 0) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES)
    .map((e) => e.path);

  const files: SourceFile[] = [];
  let truncated = false;
  const deadline = Date.now() + 25_000; // anggaran waktu serverless
  let cursor = 0;
  const worker = async () => {
    while (cursor < wanted.length) {
      if (Date.now() > deadline) {
        truncated = true;
        return;
      }
      const path = wanted[cursor++];
      try {
        const data = (await gh(`contents/${path}?ref=${branch}`)) as { content?: string; encoding?: string };
        if (data.content && data.encoding === "base64") {
          files.push({ path, content: Buffer.from(data.content, "base64").toString("utf8") });
        }
      } catch {
        // file gagal diambil → lewati
      }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  return { files, truncated: truncated || cursor < wanted.length };
}

// ---------------------------------------------------------------------------
// Scanner utama.
// ---------------------------------------------------------------------------

const SELF_FILE = "mini-services/telegram-bot/src/debugger.ts"; // teks aturan selalu self-match

function scanFiles(files: SourceFile[]): { findings: Finding[]; lines: number } {
  const findings: Finding[] = [];
  const counts = new Map<string, number>();
  let lines = 0;

  for (const f of files) {
    if (f.path === SELF_FILE) continue; // deskripsi aturan memicu aturannya sendiri
    const fileLines = f.content.split("\n");
    lines += fileLines.length;
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          const seen = counts.get(rule.id) ?? 0;
          counts.set(rule.id, seen + 1);
          if (seen < (rule.maxExamples ?? 4)) {
            findings.push({
              ruleId: rule.id,
              severity: rule.severity,
              title: rule.title,
              file: f.path,
              line: i + 1,
              snippet: line.trim().slice(0, 120),
              suggestion: rule.suggestion,
            });
          }
        }
      }
    }
  }

  findings.push(...structuralFindings(files));
  return { findings, lines };
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export async function runSecurityScan(): Promise<ScanResult> {
  const started = Date.now();
  const onVercel = Boolean(process.env.VERCEL);
  let files: SourceFile[] = [];
  let mode: "local" | "github" = "local";
  let truncated = false;

  if (onVercel || !existsSync(join(config.repoDir, ".git"))) {
    mode = "github";
    const res = await collectGithub().catch(() => ({ files: [] as SourceFile[], truncated: true }));
    files = res.files;
    truncated = res.truncated;
  } else {
    files = collectLocal();
  }

  const { findings, lines } = scanFiles(files);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    filesScanned: files.length,
    linesScanned: lines,
    durationMs: Date.now() - started,
    mode,
    truncated,
    findings,
  };
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

export const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪️",
};
