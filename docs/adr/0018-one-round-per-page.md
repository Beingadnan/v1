# ADR 0018 — One round of reads per page, sessions remembered for seconds

Status: accepted (10 Nov 2026). Builds on ADR 0017.

## Context

After ADR 0017 the slow pages still waited on the database several times in a row. Measured
on a production build with every round trip held back 250 ms (Bhiwandi to Neon in Ohio),
with QA Tech's volume (1,000 loggers, 300 jobs):

| Page (warm)             |  Before |   After | Rounds after |
| ----------------------- | ------: | ------: | -----------: |
| Home                    |  831 ms |  319 ms |            1 |
| Jobs, Studies, Clients  | 520–570 | 265–320 |            1 |
| Job                     |  2.05 s |  545 ms |            2 |
| Study, Layout / Data    |  1.29 s |  530 ms |            2 |
| Study, Analysis/Report  |  1.58 s |  535 ms |            2 |
| Client                  |  1.03 s |  520 ms |            2 |
| Instrument              |  1.53 s |  272 ms |            1 |
| Instruments list        |  805 ms |  297 ms |            1 |
| Billing                 |  767 ms |  266 ms |            1 |
| Notifications, Settings |  1.02 s |  270 ms |            1 |
| Deviations, Reports     |  775 ms |  270 ms |            1 |

Where the time went:

1. Every page first checked the session: one round trip before any of the page's reads.
2. Reads that needed the ids from a previous read waited for it ("the job's instruments,
   then their certificates"; "the live jobs, then their invoices"; "the study's data files,
   then their channels"). Pages awaited loaders one after another.
3. The pool allowed 10 connections. A study tab sends ~30 reads at once; the rest queued
   for a free connection, which is one more round.
4. The first page after a restart opened every connection itself (TCP, TLS, password:
   several round trips each).

## Decision

- **Reads by subquery.** A read that needs ids from another read takes them as a subquery
  of the same filter (`inArray(col, db.select({ id }).from(…).where(…))`), so both go out in
  the same round. `certificatesOf`, `busyInstruments` and `peopleClashes` accept ids or a
  subquery; `bookedOn(job)` is the subquery of a job's instruments.
- **The record check still comes first** (ADR 0017): a page reads its record with the
  organisation check, then everything else in one round. Pages that need more than that
  record read it once and hand it on (`findJob` then `jobDetail`, `jobMoney` and
  `bookingChoices` with `loaded`), instead of each loader reading it again.
- **Loaders that check the organisation themselves** go out alongside the page's record
  (contracts beside the client, the traceability chain beside the instrument).
- **Sessions are remembered for 15 s** in the server process (`src/lib/auth/session-cache.ts`),
  only valid ones. Signing out, a role or status change and a password change forget them
  all, so in this process they apply on the next click; another process (if there ever is
  one) catches up within 15 s. The idle limit is minutes, so this never extends a session.
- **The pool holds 30 connections** (`DATABASE_POOL_MAX`, default 30). Neon's pooled
  endpoint accepts thousands of clients.
- **Connections open at start**: `src/instrumentation.ts` opens 10 in the background when
  a production server starts. It does not keep them alive afterwards: idle connections close
  after 5 minutes, so Neon can still suspend the database when nobody is working.
- **A test counts the rounds** (`tests/integration/round-trips.test.ts`): every query is
  delayed and each main loader must stay within its rounds. A new `await` in the middle of
  a loader fails it.
- Client components import constants from `types` modules, not from `schemas` (zod stays on
  the server: 36 KB less JavaScript on the job pages).

## Consequences

- Most pages now wait for the database once, a few twice. The remaining cost is distance:
  moving the database to Neon's Singapore region (phase 12) cuts each round from ~250 ms to
  ~60–70 ms, so most pages would answer in about 0.1–0.2 s.
- A page can use up to ~30 connections at once; with tens of users this stays far inside
  Neon's limits.
- `next dev` compiles each page the first time it is opened and runs without these build
  optimisations; speed is judged on `npm run build && npm start`.
