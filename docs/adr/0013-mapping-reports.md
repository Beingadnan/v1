# ADR 0013: Mapping reports are drawn by pdfkit from an approved run and frozen per revision

Status: accepted (Phase 8, November 2026)

## Context

QA Tech's mapping report (FT-09) is the deliverable a client's inspector reads. It
must:

- carry exactly the numbers of the approved analysis;
- look like the reports QA Tech has issued for years;
- never change once issued.

The plan suggested an HTML template printed to PDF. That would need a headless
browser on the server (ADR 0008 chose pdfkit for FT-05 to avoid one).

## Decisions

1. **pdfkit draws the report.** The same choice as ADR 0008: no Chromium, and the same
   output on a laptop and in production.
   - Charts are drawn as vector paths, which serves the same purpose as SVG and prints
     sharp.
   - The editor's preview is the PDF itself, so what is checked is what is issued.
   - Certificates are joined with pdf-lib (pure JavaScript).
   - The index's page numbers come from laying the report out twice.

2. **A report is built only from the approved analysis run** (ADR 0012).
   - Drafting and freezing are refused when the approval is missing, out of date, or
     blocked: an open deviation, unreviewed excursions, or missing post-cal.
   - A frozen revision records the run it came from.

3. **Revisions.** `study_reports` holds Rev 00, 01… for each study.
   - There is one draft at a time. A draft renders fresh, marked DRAFT.
   - **Freezing** renders the report once and keeps the PDF in content-addressed
     storage with its SHA-256 and page count. Downloads return those bytes, with the
     hash in a header.
   - A new revision needs a reason and supersedes the previous frozen one when it is
     frozen itself. Nothing frozen is ever overwritten.

4. **Wording.**
   - The observation and conclusion start from templates worded like the issued
     reports.
   - An edit or reset is audited with before and after.
   - Text the PDF font can't print is refused when saved, never printed as "?".

5. **Traceability annexure.**
   - QA Tech's own logger certificates are redrawn from their records, with the
     serials used highlighted and marked TRUE COPY.
   - Lab certificates are attached as uploaded.
   - A missing certificate PDF blocks freezing.

## Consequences

- The report can be regenerated from the same run and give the same numbers. The issued
  bytes are still the frozen file, never a regeneration.
- New templates (FT-06, FT-10/11, WCR) are new layouts on the same `ReportData`.
- Electronic signatures (phase 9) will sign the frozen file's SHA-256.
