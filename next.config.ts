import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The catalog is read from data/*.json at request time (fs), which static
  // analysis cannot trace — force-include it in the serverless bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**/*"],
  },
  async rewrites() {
    return {
      afterFiles: [
        // History-based SPA (D1 rev.2): clean URLs serve the single storefront
        // route. /api and /public are untouched (filesystem wins before this).
        { source: "/games", destination: "/" },
        { source: "/games/:slug", destination: "/" },
        { source: "/help", destination: "/" },
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
