import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request.
 *
 * Phase 0: sets a per-request nonce-based Content-Security-Policy.
 * Phase 1 adds an optimistic session check here (redirect to /login);
 * the authoritative auth check always happens again on the server
 * (data access layer), never only in the proxy.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Dev server injects un-nonced <style> tags for hot reload and the error overlay.
    // Production stays strict (nonce only). A nonce would make browsers ignore 'unsafe-inline',
    // so dev uses 'unsafe-inline' alone.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // UI primitives (dialogs, popovers) position themselves with inline style attributes.
    // Attribute styles cannot run script, so allowing them is a low, accepted risk.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export const config = {
  matcher: [
    // Skip static assets and prefetches; they do not need a CSP nonce.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|brand/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
