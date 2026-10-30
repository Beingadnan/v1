# ADR 0011: Logger data — read by content, checked per channel, confirmed by a person

Status: accepted (Phase 6, October 2026)

## Context

After a study, the loggers' readings reach the office as Excel or CSV, usually emailed
by the site team leader. The files differ in layout, may hold several loggers or one,
and are sometimes wrong (another study's file, a gap, a re-saved copy). The report's
evidence is built on them, so nothing may be guessed, lost or silently overwritten.

## Decisions

1. **The original file is kept as uploaded.** It is stored in the content-addressed
   store with its SHA-256 (ADR 0004). What was read from it (times, columns, notes) is
   stored beside it. A replaced or removed file stays, marked with who, when and why,
   and can still be downloaded.

2. **Reading is by content** (`src/domain/data/parse.ts`). The reader finds:
   - the first three rows in a row with a date/time and numbers;
   - the header lines above them, carrying a serial written once over its °C and
     %RH columns;
   - the quantity from the units.

   It stops at summary rows, skips row-number columns, and picks the best sheet,
   saying why. Times are wall-clock in India. Anything unreadable is reported with its
   row, never dropped.

3. **Readings are stored as arrays per column**: one `bigint[]` of times per file, one
   `double precision[]` per column. A week at 1 min × 100 loggers is ~1 M numbers.
   Arrays keep that to one row per column and one insert per upload. Phase 7 reads
   whole columns, never single readings.

4. **Columns match positions by the placed logger's serial**, then its ID, then the
   position label. A person can match a column by hand or ignore it; that choice is
   stored on the column and audited.

5. **The checks are pure and recomputed on every change**
   (`src/domain/data/checks.ts`). That means an upload, a match, a time struck out on
   site, or an acceptance. They run per channel, inside each cycle's recorded window.

   The result replaces `study_data_issues`. Each issue has a fingerprint (kind,
   position, cycle, detail). An acceptance with a reason sticks to that fingerprint,
   so it survives a re-check but not a different problem.

6. **The job follows its data:**
   - any open blocker or open request → Data issue;
   - every study confirmed → Data received;
   - otherwise → Field work.

   Confirmation is a person's decision (team leader or manager), offered only when
   nothing is open. It is refused if someone has already confirmed.

7. **The same readings twice are refused**, even when the bytes differ (a workbook
   re-saved by Excel). A file whose readings fall outside every recorded window is
   flagged as probably the wrong file before anything else.

## Consequences

- Old `.xls` files are refused with a message to save as `.xlsx`; no binary-Excel
  reader is added.
- The checks need the times from the Times tab. Without them the file's own span is
  used, with a warning.
- Thermal cycles carry hold start/end markers now, so phase 7's F0 window comes from
  site records, not from guessing in the data.
