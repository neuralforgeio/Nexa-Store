import { NextRequest, NextResponse } from "next/server";

/**
 * Next 16 proxy (pengganti middleware.ts) — v1.22.0 hardening.
 *
 * Tiga lapis perlindungan permintaan sebelum menyentuh aplikasi:
 *
 * 1. PROBE BLOCK (403): pemindai kerentanan umum (/.env, /.git, /wp-admin,
 *    /phpmyadmin, …) ditolak instan — mengurangi noise log & permukaan
 *    serangan. Tidak pernah menyentuh renderer.
 * 2. GLOBAL RATE LIMIT (429): sliding-window per IP, dipisah halaman vs API.
 *    Batas tinggi agar pengguna NAT/CGNAT Indonesia yang sah tetap lolos,
 *    tetapi flood ratusan req/detik dari satu IP langsung terpotong.
 * 3. PAYLOAD CAP (413): body /api publik > 256 KB ditolak sebelum dibaca.
 *    Route developer/management (terautentikasi, impor dataset besar)
 *    dikecualikan; validasi zod per-route tetap lapisan berikutnya.
 *
 * Perilaku lama tetap: x-pathname diteruskan ke page server-component untuk
 * gerbang lockdown/maintenance. Semua jalur FAIL-OPEN — kesalahan limiter
 * tidak boleh mematikan toko.
 */

// ── konfigurasi batas ────────────────────────────────────────────────────
const PAGE_LIMIT = 900; // 15 req/detik berkelanjutan per IP untuk halaman
const PAGE_WINDOW_MS = 60_000;
const API_LIMIT = 600; // 10 req/detik berkelanjutan per IP untuk /api/*
const API_WINDOW_MS = 60_000;
const API_BODY_LIMIT_BYTES = 256 * 1024; // 256 KB untuk /api publik

// ── deteksi probe pemindai ───────────────────────────────────────────────
const PROBE_PREFIXES = [
  "/.env",
  "/.git",
  "/.aws",
  "/.ssh",
  "/.ds_store",
  "/.svn",
  "/.htaccess",
  "/.htpasswd",
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/wp-includes",
  "/phpmyadmin",
  "/pma/",
  "/xmlrpc.php",
  "/admin.php",
  "/config.php",
  "/shell.php",
  "/cgi-bin",
  "/etc/passwd",
  "/proc/self",
  "/.well-known/security",
];

function isScannerProbe(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return PROBE_PREFIXES.some(
    (x) => p === x || p.startsWith(`${x}/`) || p.startsWith(`${x}?`)
  );
}

// ── limiter sliding-window in-memory (edge-safe, per-instance) ───────────
const hits = new Map<string, number[]>();

function allow(key: string, limit: number, windowMs: number): number {
  /** Mengembalikan -1 (boleh) atau retryAfterMs (terblokir). */
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return Math.max(windowMs - (now - arr[0]), 1_000);
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 9_000) hits.clear(); // pengaman memori: fail-open
  return -1;
}

function ipOf(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function tooManyRequests(retryAfterMs: number): NextResponse {
  return new NextResponse(
    JSON.stringify({
      ok: false,
      error: {
        code: "rate-limited",
        message: "Terlalu banyak permintaan dari jaringan ini. Tunggu sebentar.",
      },
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.ceil(retryAfterMs / 1000)),
      },
    }
  );
}

export default function proxy(req: NextRequest) {
  try {
    const pathname = req.nextUrl.pathname;

    // 1. Probe pemindai → 403 tanpa membebani renderer.
    if (isScannerProbe(pathname)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const ip = ipOf(req);
    const isApi = pathname.startsWith("/api/");

    if (isApi) {
      // 3. Payload cap untuk /api publik (developer/management dikecualikan
      //    — impor dataset AI bisa besar dan sudah terautentikasi + zod).
      const authedWriteApi =
        pathname.startsWith("/api/developer/") || pathname.startsWith("/api/management/");
      const contentLength = Number(req.headers.get("content-length") ?? "0");
      if (!authedWriteApi && contentLength > API_BODY_LIMIT_BYTES) {
        return new NextResponse(
          JSON.stringify({
            ok: false,
            error: { code: "payload-too-large", message: "Body permintaan terlalu besar." },
          }),
          { status: 413, headers: { "content-type": "application/json" } }
        );
      }

      // 2. Batas global API per IP (di atas limit per-route yang lebih ketat).
      const blockedFor = allow(`api:${ip}`, API_LIMIT, API_WINDOW_MS);
      if (blockedFor > 0) return tooManyRequests(blockedFor);
    } else {
      // 2. Batas global halaman per IP.
      const blockedFor = allow(`page:${ip}`, PAGE_LIMIT, PAGE_WINDOW_MS);
      if (blockedFor > 0) return tooManyRequests(blockedFor);
    }

    // Perilaku lama: teruskan pathname asli ke server-component halaman
    // (gerbang lockdown/maintenance dibaca dari sini).
    const headers = new Headers(req.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  } catch {
    // FAIL-OPEN: jangan pernah mematikan toko karena proxy error.
    return NextResponse.next();
  }
}

export const config = {
  // Semua kecuali aset statis Next, ikon game, dan halaman gerbang (yang
  // harus selalu render). Kini MENCakup /api — proxy berjalan untuk API
  // juga (payload cap + batas global). File berekstensi (favicon, sw.js,
  // manifest) dilewati agar tidak dihitung ke kuota.
  //
  // Pengecualian ".*\\..*" membuat path probe bertitik (/.env, /wp-login.php)
  // lolos dari pola utama — karena itu ditambahkan pola eksplisit di bawah
  // (matcher Next adalah daftar OR: satu saja cocok, proxy tetap berjalan).
  matcher: [
    "/((?!_next/static|_next/image|lockdown|maintenance|game-icons|.*\\..*).*)",
    "/.env",
    "/.env/:path*",
    "/.git",
    "/.git/:path*",
    "/.aws",
    "/.aws/:path*",
    "/.ssh",
    "/.ssh/:path*",
    "/.svn",
    "/.svn/:path*",
    "/.htaccess",
    "/.htpasswd",
    "/.ds_store",
    "/wp-admin/:path*",
    "/wp-login/:path*",
    "/wp-login.php",
    "/xmlrpc.php",
    "/admin.php",
    "/config.php",
    "/shell.php",
    "/phpmyadmin/:path*",
    "/pma/:path*",
    "/cgi-bin/:path*",
    "/.well-known/security/:path*",
  ],
};
