# QTech platform

Calibration and thermal validation management for QA Tech (a division of GMP Technical
Solutions Pvt. Ltd.). It replaces the Excel templates, the monthly Calibration Index and
email hand-offs with one web app that takes a job from creation to a signed, traceable
report and a paid invoice.

The full flow and phase-by-phase plan live in the project plan document (Flow &
implementation, Build plan). Engineering rules for this repo: [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md).
Architecture decisions: [docs/adr/](docs/adr/).

## Status

**Phase 4 — Jobs.** A job from the PO to field work: a wizard that starts from the
client's site with the equipment due for requalification already ticked (or straight
from the Requalification due list); one study per item with its defaults copied from the
equipment and its report number reserved in the client's format; a readiness checklist
worked out from the job (PO, loggers booked, loggers calibrated through the last day,
masters for pre/post-cal) with only protocol, site access and previous report ticked by
people, moving the job between Created and Ready by itself; one-click logger booking
(the job's site first, one model, consecutive IDs, never a logger that runs out during
the study or is on another job), or by pasting IDs or serials; warnings when a person is
on two jobs at once; hold, resume and cancel with a reason; a board and a list searchable
by job number, PO, client, equipment or report number; and a rate card that prices each
study and flags a PO that doesn't match. Prices are shown only to managers, team leaders
and accounts.

Built on phase 3 (instruments and FT-05 calibration certificates), phase 2 (clients,
sites, departments, equipment register, Excel import), phase 1 (sign-in, roles,
settings, audit trail, uploads) and phase 0 (design system, append-only audit log,
content-addressed file storage, CI).

## Run it locally

Requires Node 22 and a Postgres database: either Neon (paste its connection string into
`DATABASE_URL`) or local Docker (`docker compose up -d`).

```bash
npm ci                          # install packages first
cp .env.example .env.local      # local settings; never commit .env.local
npm run db:migrate              # create tables
npm run db:seed                 # QA Tech organisation, settings, sites and logger models (safe to re-run)
npm run user:create-admin -- --name "Your Name" --email you@qatech.co.in
npm run dev                     # http://localhost:3000
```

`user:create-admin` prints a one-time link: open it to set your password, then sign in.
Invite everyone else from **Users** in the app. If the only admin is locked out, run the
same command again with their email to get a fresh link.

### Fill client details from a GSTIN (optional)

With Cashfree keys in `.env.local` (see `.env.example`), typing a valid GSTIN in the client or
site form fetches the registered legal name, address and state and fills the empty fields.
Use sandbox keys and Cashfree's test GSTINs (e.g. `29AAICP2912R1ZR`) first. Lookups are cached
for 30 days per GSTIN, limited to 30 per person per hour, and recorded in the audit trail.
If Cashfree answers "refused this server", whitelist your server's IP address in the Cashfree
dashboard or set `CASHFREE_PUBLIC_KEY`.

The design system is browsable at `/dev/components` in development (hidden in production).

## Checks

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `npm run check`            | Typecheck, lint, formatting and unit tests                  |
| `npm run test:integration` | Tests against real Postgres (`TEST_DATABASE_URL`, `*_test`) |
|                            | Browser tests also use `TEST_DATABASE_URL` and wipe it      |
| `npm run build`            | Production build                                            |
| `npm run test:e2e`         | Browser tests against the production build (build first)    |

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request.

### Real client files in tests

Some tests also run against real QA Tech files when they are present in `fixtures/client/`
(git-ignored — client data is never committed). Copy the files from the shared
`fwtraceability_` folder there. Without them those tests are skipped, so CI stays green.

## Project layout

```
src/app/(staff)/     QA Tech staff screens (jobs, clients, instruments, users, settings, audit…)
src/app/(client)/    the client QA users' area
src/components/ui/   design-system components
src/components/shell sidebar, top bar, navigation
src/domain/          business rules without React (auth, clients, instruments, jobs, numbering)
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
