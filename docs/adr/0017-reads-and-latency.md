# ADR 0017 — Independent reads go out together; connections are kept warm

Status: accepted (4 Nov 2026)

## Context

QA Tech's database is on Neon in AWS us-east-2 (Ohio); the office is in Bhiwandi. Every
round trip costs about 250 ms, and opening a connection (TLS and the password exchange)
takes several. Pages were written as one `await` after another, so the cost added up:

| Page                 | Reads one after another, before | After |
| -------------------- | ------------------------------- | ----- |
| Home                 | 19                              | 2     |
| Study, Analysis tab  | 8 + 21                          | 4     |
| Study, Report tab    | 8 + 19                          | 4     |
| Study, Data tab      | 8 + 9                           | 3     |
| Study, any other tab | 8                               | 3     |
| Job                  | 11 + 7 (money)                  | 4     |
| Billing              | 6, plus 2 per job without a WCR | 2     |
| Deviations           | 4                               | 2     |

(Counted with every query delayed by 100 ms; at 250 ms the home page went from ~5 s of
waiting to ~0.5 s.) The pool also closed idle connections after 30 s, so the next click
paid for a new connection.

## Decision

- Reads that don't depend on each other go out together. Inside a domain function that
  may run in a transaction, use `reads(executor, [() => …])` (`src/db/reads.ts`): on the
  pool the reads run at once, inside a transaction one after another, because a
  transaction has one connection and pg 9 refuses a second query on a busy one. Page
  loaders that only use the pool may use `Promise.all` directly.
- A read that checks the record belongs to the organisation runs first; reads by that
  record's id follow together. Reads that carry the organisation themselves can join the
  first round.
- The study page reads the tab named in the link together with the study.
- The pool keeps idle connections 5 minutes (`idleTimeoutMillis`) with TCP keep-alive.
- Every staff page, the study page, the job page and the client area have a `loading.tsx`,
  so a click shows a placeholder at once and, in production, links are prefetched up to it.

## Consequences

A page opens up to `DATABASE_POOL_MAX` (10) connections at once; at tens of users this is
well inside Neon's limits. The biggest remaining cost is distance: moving the database to
Neon's Singapore region (aws-ap-southeast-1, the closest to India; Neon has no Mumbai
region) would cut each round trip to about a quarter. A Neon project's region can't be
changed; it needs a new project and a dump and restore (phase 12, go-live).
