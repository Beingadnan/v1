
# QTech platform

Calibration and thermal validation management for QA Tech (a division of GMP Technical
Solutions Pvt. Ltd.). It replaces the Excel templates, the monthly Calibration Index and
email hand-offs with one web app that takes a job from creation to a signed, traceable
report and a paid invoice.

The full flow and phase-by-phase plan live in the project plan document (Flow &
implementation, Build plan). Engineering rules for this repo: [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md).
Architecture decisions: [docs/adr/](docs/adr/).

## Status

**Phase 11: Dashboard, alerts and archive.**

- **Home:** counts with links for what waits on each role. The manager's tiles are
  the Monday review: reports to check and release, data overdue, reports unsigned by
  clients, invoice due and overdue, instruments expiring, open deviations and overdue
  CAPAs, requalifications due, and jobs by stage.
- **The bell:** every hand-over of work is a notification, written with the event.
  Email goes at once only when someone is blocked: a report returned or released, a
  WCR to accept, a deviation to decide, a CAPA assigned. Everything else goes into one
  daily digest. Each person can turn email off.
  - **Email:** through Resend when `RESEND_API_KEY` and `MAIL_FROM` are set.
  - **The digest:** sent by `POST /api/cron/digest` with `CRON_SECRET`.
- **Search (Ctrl+K):** jobs, POs, report numbers, equipment, logger codes and serials,
  certificates, clients.
- **Archive:** signed studies by company, site, year, month, department and equipment.
- **Deviations and CAPA:** open deviations and who decides them. CAPAs have an owner,
  a due date (moved only with a reason), a done note, and verification by someone
  else.

**Phase 10: Close and money.** From the last report to the bank:

- **WCR (work completion report):** issued once every report is with the client. It is
  drawn on the letterhead with the job, PO, work period and every piece of equipment
  with its report, and frozen with its SHA-256. The client's QA head accepts it in the
  app (a signature), or QA Tech records the signed paper scan. A wrong one is voided
  and issued again.
- **Invoices:** recorded from Tally once the WCR is signed. Each one is checked:
  - the number's shape (GST Rule 46);
  - unique in its financial year;
  - total = taxable + GST.

  The next number, the amount and 18% GST are suggested. A wrong entry is cancelled
  with a reason.

- **Payments:** amount received plus TDS (2% suggested, s.194J), mode and UTR or cheque
  number. A few rupees can be written off with a reason, and nothing beyond the balance
  is accepted. A wrong entry is reversed, never edited.
- **Billing page:** outstanding and overdue totals, Invoice due (with Rule 47's 30
  days), open invoices oldest-overdue first, WCRs to issue and to chase, and what
  cleared lately. Payment terms are set per client (45 days by default). QA Tech's
  Udyam number, when set, brings in the MSME 45-day rule.
- **Closing:** a manager closes a job only when the WCR, every report and every invoice
  are done, and the refusal says what is missing. Reopening needs a reason.

**Phase 9: Review and sign-off.** From a drafted report to the client's signature:

- **Done By:** the preparer re-enters their password. This freezes the PDF (SHA-256)
  and sends it to the checker.
- **QA Tech's check (Reviews page):** a team leader or manager signs Checked By, or
  returns it with comments pinned to sections and pages. The preparer answers every
  comment before signing again. No one checks a report they prepared.
- **Release:** to chosen client users, with a ready-written email linking to the report
  in the client area (sign-in needed).
- **The client area:**
  - the client's QA signs Reviewed By and the QA head signs Approved By, or either
    sends it back with comments (then Rev 01 answers them);
  - the QA head decides deviations with a signed decision.
- **The paper route:** QA Tech uploads the signed scan and enters who signed and when.
  The scan is linked to the frozen PDF by hash.
- **Every download of a frozen revision** has the signatures stamped into the signature
  block, plus a last page listing each signature (name, role, organisation, time in
  IST, meaning) with the frozen PDF's SHA-256. The client's approval stores this issued
  copy with its own hash. Every revision stays downloadable.
- **The job follows its reports:** Checked → Sent to client → Client signed, and back
  to Rework on any return. A signed report puts the study in the company archive.

**Phase 8: Reports and PDF.** The mapping report (FT-09), drawn like QA Tech's issued
BE-WF-02 report, from the approved analysis:

- **Pages:**
  - cover, and an index with page numbers;
  - equipment and mapping details, with the loggers and the masters behind their
    certificates;
  - sensor diagram (hot red, cold yellow);
  - temperature (and RH) vs time, with a legend by serial, and the summary table for
    each cycle;
  - observation, conclusion, annexure and signature block;
  - raw data in landscape; post-cal sheet; deviation reports;
  - the loggers' certificates (serials highlighted, TRUE COPY) and the masters'
    certificates.
- **Report tab:**
  - the PDF itself as the preview;
  - observation and conclusion that start from templates and can be edited (every
    edit audited);
  - **Freeze** keeps the PDF with its SHA-256;
  - **Rev 01…** needs a reason and supersedes the last frozen revision.
- **Reports page:** studies ready for a report, and every draft and frozen report.
- The job moves to Report draft once every study's analysis is approved and a report
  is started.

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

## Showing the app to others

Never demo on `npm run dev`: it compiles each page on first use and is 3–20 times slower
(ADR 0020). On the office network:

```bash
npm run build
npm run start:lan
```

Others open `http://<this computer's IP>:3000`. In production, host on Vercel in Singapore
(`vercel.json`), next to the database.

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
