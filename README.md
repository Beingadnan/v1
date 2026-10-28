# QTech platform

Calibration and thermal validation management for QA Tech (a division of GMP Technical
Solutions Pvt. Ltd.). It replaces the Excel templates, the monthly Calibration Index and
email hand-offs with one web app that takes a job from creation to a signed, traceable
report and a paid invoice.

The full flow and phase-by-phase plan live in the project plan document (Flow &
implementation, Build plan). Engineering rules for this repo: [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md).
Architecture decisions: [docs/adr/](docs/adr/).

## Status

**Phase 0 — Foundations.** App shell and design system, database with an append-only audit
log, content-addressed file storage, CI. No login yet (phase 1), so nothing is exposed that
accepts data.

## Run it locally

Requires Node 22 and Docker.

```bash
cp .env.example .env.local      # local settings; never commit .env.local
docker compose up -d            # Postgres 16 on localhost:5432 (+ a separate qtech_test DB)
npm ci
npm run db:migrate              # create tables
npm run db:seed                 # create the QA Tech organisation (safe to re-run)
npm run dev                     # http://localhost:3000
```

The design system is browsable at `/dev/components` in development (hidden in production).

## Checks

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `npm run check`            | Typecheck, lint, formatting and unit tests                  |
| `npm run test:integration` | Tests against real Postgres (`TEST_DATABASE_URL`, `*_test`) |
| `npm run build`            | Production build                                            |
| `npm run test:e2e`         | Browser tests against the production build (build first)    |

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request.

### Real client files in tests

Some tests also run against real QA Tech files when they are present in `fixtures/client/`
(git-ignored — client data is never committed). Copy the files from the shared
`fwtraceability_` folder there. Without them those tests are skipped, so CI stays green.

## Project layout

```
src/app/(staff)/     QA Tech staff screens (shell, home)
src/components/ui/   design-system components
src/components/shell sidebar, top bar, navigation
src/db/              Drizzle schema, client, seed helpers
src/lib/             env, audit, storage
drizzle/             SQL migrations (forward-only)
scripts/             migrate, seed, standalone start
tests/               integration and end-to-end tests
docs/                engineering rules and decision records
```

## Database changes

1. Edit the schema in `src/db/schema/`.
2. `npm run db:generate -- --name short_description` creates a SQL migration.
3. Review the SQL, then `npm run db:migrate`.

Migrations only move forward. Never edit a migration that has run anywhere shared;
add a new one instead.
