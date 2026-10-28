# ADR 0002 — Render every page per request; CSP with nonces

Status: accepted (28 Oct 2026)

## Context

Next.js 16 can prerender static shells and cache components (`cacheComponents`,
`partialPrefetching`). Every QTech screen is behind login and shows live, audited data, so
there is little to prerender. We also want a strict Content-Security-Policy using a fresh
nonce per request, which requires dynamic rendering: a page prerendered as static HTML
cannot carry the nonce, and the browser then blocks all its scripts. (We hit exactly this in
phase 0 before the fix.)

## Decision

- `cacheComponents` and `partialPrefetching` are off.
- The root layout calls `await connection()`, so every route renders per request.
- `src/proxy.ts` sets the CSP with a per-request nonce. Production allows only
  nonce-carrying scripts and styles (`strict-dynamic`). Development additionally allows
  `unsafe-eval` and inline styles, which the dev server needs for hot reload.
- `style-src-attr 'unsafe-inline'` is allowed in all environments because Radix positions
  popovers with style attributes; style attributes cannot execute script.
- Other security headers (frame denial, nosniff, referrer, permissions, HSTS) are set in
  `next.config.ts`. Responses are `no-store`.

## Consequences

No stale data and no cached personal data. Slightly more server work per request, which is
irrelevant at QA Tech's scale (tens of users). If public pages are ever added, they can opt
into caching individually. End-to-end tests check the CSP header, nonce rotation and that
pages load with zero browser errors.
