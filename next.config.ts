import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * - cacheComponents / partialPrefetching are intentionally OFF.
 *   Every page in this app sits behind a login and shows live, audited data,
 *   so prerendered/cached shells give no benefit and add correctness risk.
 *   See docs/adr/0002-rendering-and-caching.md.
 * - Security headers that do not need a per-request nonce live here.
 *   The Content-Security-Policy (nonce-based) is set in src/proxy.ts.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // camera stays allowed for our own origin: field engineers scan logger barcodes (phase 5).
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS is only honoured over HTTPS, so it is harmless in local http dev.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Produces a self-contained server bundle for the Docker image (deployment phase).
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
