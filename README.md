# QTech platform

Calibration and thermal validation management for QA Tech (a division of GMP Technical
Solutions Pvt. Ltd.). It replaces the Excel templates, the monthly Calibration Index and
email hand-offs with one web app that takes a job from creation to a signed, traceable
report and a paid invoice.

The full flow and phase-by-phase plan live in the project plan document (Flow &
implementation, Build plan). Engineering rules for this repo: [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md).
Architecture decisions: [docs/adr/](docs/adr/).

## Status

**Phase 7 — Analysis, post-calibration and deviations.** From confirmed data to the
report's numbers:

- **Per position and cycle:** minimum, maximum and average with their times, MKT,
  %RH, pass/fail against the study's limits; hot and cold spots by average, as on
  QA Tech's page 5. Ambient positions are shown, not judged.
- **Excursions** grouped per position and limit, each accepted with a reason or raised
  as a deviation. **Door-open recovery, power-failure holdover and recovery, and F0**
  over the recorded hold.
- **Every run is kept and never changed** (engine version, constants, file hashes,
  decisions). A run whose inputs changed shows as out of date.
- **Post-calibration (FT-02)** on the phone or in the lab. A failure opens deviation
  QT/DEV/YYYY/NNNN by itself, with the impact of the logger's error worked out.
- **Deviations:** QA Tech's assessment, then the client QA head's decision (No impact,
  Exclude probe, Repeat study) by name and date, with an optional signed scan.
- **Approval** of one run by the team leader, only when everything is reviewed. A new
  deviation takes it back.
- Golden tests: BE-WF-02 matches page 5 exactly; WH013 matches its summary rows.

**Phase 6 — Data import and validation.** The logger Excel or CSV, as it comes from site:

- **Read by content:** header lines, serials over a units row, split or combined
  date/time, text numbers, `Sr. No.` columns and summary rows. The reader says what it
  read and where it stopped.
- **Columns match positions by the logger serial.** Anything else is listed for a person
  to match or ignore.
- **Checks per logger, inside each cycle's recorded times:** missing loggers or RH,
  gaps, wrong interval, data that doesn't cover the cycle, duplicates, impossible
  values, a stuck sensor, and a file from another period.
- **Problems send the job to Data issue.** A team leader can ask the site for data
  (the request closes on the next upload) or accept a problem with a reason.
  Confirming every study's data moves the job to Data received.
- **The original file is kept with its hash.** Replaced or removed files stay in the
  history. Re-saved copies of the same data are refused.
- **Thermal cycles** gain minimum/maximum load and hold markers; **the data provider**
  joins the job team.

**Phase 5 — Field work.** On a phone, the engineer's day on site:

- **My studies today** for the jobs they are on.
- **The layout** starts from a template: corners and centre as on the BE-WF-02 diagram,
  or the WHO grid from the room size. Positions are dragged on a plan of each level.
- **Placing loggers** by scanning with the phone camera (Chrome on Android), typing, or a
  scanner gun. Out-of-date, busy, misplaced or pre-cal-failed loggers are refused with
  the reason.
- **Pre-calibration (FT-01).**
- **Cycle start/end, door and power times** are kept on the phone when there is no signal
  and sent later with the time they were tapped.
- **Photos** are shrunk before upload.
- **The FT-12 sensor location sheet** prints from what was done on site.
- **Progress:** studies become Running and Done from their times, and jobs show "3 of 5
  studies done".

Phase 4 — Jobs: the job wizard with due equipment ticked, studies with reserved report
numbers, the calculated readiness checklist, one-click logger booking, clash warnings,
the board and list, and the rate card.

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
src/app/(staff)/     QA Tech staff screens (jobs, studies, clients, instruments, users, settings, audit…)
src/app/(client)/    the client QA users' area
src/components/ui/   design-system components
src/components/shell sidebar, top bar, navigation
src/domain/          business rules without React (auth, clients, instruments, jobs, field, numbering)
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
