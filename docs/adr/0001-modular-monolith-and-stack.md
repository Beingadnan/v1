# ADR 0001 — Modular monolith and core stack

Status: accepted (28 Oct 2026)

## Context

QA Tech needs one app covering jobs, field work, data import, calculations, reports,
sign-off and invoicing. The team is one developer working with an AI assistant. Two earlier
repos existed: `qatech-mapping` (working engine, no git history, patched schema) and
`qatech-v2` (front-end prototype over seed data). Both were reviewed; neither was a clean base.

## Decision

- A new repo, one deployable **modular monolith**: Next.js 16 (App Router) + React 19 +
  TypeScript strict, PostgreSQL via Drizzle ORM. No microservices.
- Business logic lives in plain TypeScript modules (`src/domain/`, `src/lib/`) that do not
  import React, so it is testable without a browser.
- UI components are written in the shadcn/ui pattern on Radix primitives and Tailwind 4.
  The shadcn CLI registry is not reachable from the build environment, so components are
  written by hand; the result is the same code.
- Infrastructure is added only when a phase needs it: job queue (pg-boss), email (Resend)
  and cloud storage (S3/R2) are deferred from phase 0 to the phases that use them.
- The calculation maths from `qatech-mapping` will be ported only with golden tests built
  from real issued reports.

## Consequences

One codebase to deploy and reason about. Module boundaries are kept by folder structure and
review, not by network calls. Splitting out a service later stays possible because domain
code has no framework dependency.
