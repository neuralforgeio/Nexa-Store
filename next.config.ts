import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy (v1.12.0 hardening). Static (nonce-less) because
 * Next's inline bootstrap needs 'unsafe-inline'; it still blocks every
 * external script/style/font origin, which is the meaningful attack surface.
 * Dev (Turbopack HMR) additionally needs eval. frame-ancestors 'self' keeps
 * the same-origin sandbox preview working while blocking cross-origin
 * clickjacking embeds.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  typescript: {
    // v1.8.0: type error TIDAK diabaikan lagi (temuan /debugging) — build
    // gagal saat ada error tipe, agar bug tidak lolos ke produksi.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // v1.14.0: @nlpjs/* (otak Nexa Bot) di-require runtime dari node_modules —
  // bundling dinamis containerBootstrap oleh Turbopack tidak perlu; di
  // Vercel, package eksternal otomatis ikut ke lambda.
  serverExternalPackages: [
    "@nlpjs/basic",
    "@nlpjs/connector",
    "@nlpjs/console-connector",
    "@nlpjs/core",
    "@nlpjs/core-loader",
    "@nlpjs/evaluator",
    "@nlpjs/lang-en",
    "@nlpjs/lang-en-min",
    "@nlpjs/language-min",
    "@nlpjs/logger",
    "@nlpjs/ner",
    "@nlpjs/neural",
    "@nlpjs/nlg",
    "@nlpjs/nlp",
    "@nlpjs/nlu",
    "@nlpjs/request",
    "@nlpjs/sentiment",
    "@nlpjs/similarity",
    "@nlpjs/slot",
  ],
  // The catalog is read from data/*.json at request time (fs), which static
  // analysis cannot trace — force-include it in the serverless bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // v1.16.0: camera=(self) — pemindai barcode pesanan butuh getUserMedia
          // asal-usul sama; mikrofon dan lokasi tetap dikunci total.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // v1.22.0: plugin waras (Flash/PDF bawaan peramban) dimatikan total.
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      afterFiles: [
        // History-based SPA (D1 rev.2): clean URLs serve the single storefront
        // route. /api and /public are untouched (filesystem wins before this).
        { source: "/games", destination: "/" },
        { source: "/games/:slug", destination: "/" },
        { source: "/help", destination: "/" },
        { source: "/track", destination: "/" },
        { source: "/reports", destination: "/" },
        { source: "/testimoni", destination: "/" },
        { source: "/login", destination: "/" },
        { source: "/admin", destination: "/" },
        { source: "/admin/:section", destination: "/" },
        { source: "/dev", destination: "/" },
        { source: "/dev/:section", destination: "/" },
        { source: "/developer", destination: "/" },
        { source: "/developer/:section", destination: "/" },
      ],
    };
  },
};

export default nextConfig;
