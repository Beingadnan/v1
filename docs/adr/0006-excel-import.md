# ADR 0006 — Excel import of clients and equipment

Status: accepted (29 Oct 2026)

## Context

QA Tech keeps its client and equipment lists in Excel. Phase 2 needs a way to bring
them in, and later phases (logger lists, certificates, migration of old studies) need
the same. The build plan named SheetJS, but the maintained SheetJS releases are only
published on its own CDN, which the build environment can't reach; the copy on npm is
years old with known advisories.

## Decision

- **Library:** `exceljs` 4.4.0 reads and writes `.xlsx`. Its `uuid` dependency is
  pinned to `^11.1.1` through `overrides` in package.json, so exceljs adds no audit
  findings (`npm audit --omit=dev` is clean; the remaining dev-only finding is in
  drizzle-kit and predates this phase).
  Old `.xls` files are refused with "save it as .xlsx" (the logger exports in phase 6
  will need `.xls`; that decision is revisited there).
- **Template first:** people download a template (Clients sheet, one row per site;
  Equipment sheet, one row per item; instructions; dropdowns for type and yes/no).
  Headers are matched loosely (case, `*`, units and common report wording such as
  "No. of Channels"), so a retyped sheet still imports.
- **Upload → preview → import:** the file goes through `POST /api/files` (stored once,
  SHA-256, audited). The preview is computed by a pure planner and changes nothing. The
  import rebuilds the plan from the stored file inside one transaction and applies all
  or nothing; any row error blocks the whole file. One import at a time per
  organisation (advisory lock).
- **Matching:** clients by short name, sites by name or code within the client,
  departments by name within the site, equipment by ID within the client — all
  case-insensitive. Empty cells keep stored values; filled cells replace them.
  Departments are created when missing; sites are not (a typo would create a
  duplicate site).
- **Audit:** every record created or changed gets its own audit entry, plus one
  `clients.imported` entry with the file name, SHA-256 and counts.

## Consequences

One more runtime dependency (exceljs) with an override to maintain. The planner is
reusable for the phase 3 and phase 12 imports. Large files are limited to 2,000 rows per
sheet and the upload size limit.
