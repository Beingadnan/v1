# ADR 0008: Calibration certificates — numbering, signing and PDF

Status: accepted (Phase 3, October 2026)

## Context

QA Tech issues batch calibration certificates (form FT-05) for its data loggers
and sensors, and keeps outside-lab certificates (ARAI, Sansel) for its master
standards. Today the numbers are allocated, the deviations calculated and the
Calibration Index typed by hand, and the index has visible errors.

## Decisions

1. **Numbers follow the paper series.** `QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}`,
   with the sequence restarting each month and kept separate per kind (PDL, RTD, TC…).
   `number_series` gains `period` (month, 0 = yearly) and `series` (kind) in its key,
   and allocation stays a single `INSERT … ON CONFLICT DO UPDATE`, so two people
   saving at once never get the same number. The number is taken when the draft is
   created and never reused, even when cancelled. The format is a setting.

2. **Arithmetic on decimal strings, not floats.** Readings are stored as `numeric`
   and deviations are computed by scaling to integers (BigInt), so 21.1 − 20.44 is
   0.66, not 0.6600000000000001. Pass/fail is recalculated on the server on every
   save; what the browser shows is a preview only.

3. **Traceability is stored, not inferred.** Each certificate records each master
   together with the master certificate that covered the calibration date. A master
   is refused unless it is master-tier, active, and covered by an issued certificate
   on that date.

4. **Three signatures over a content hash.** Done by → checked by → approved by,
   each with the password re-entered (`signRecord`). The signature stores the SHA-256
   of the certificate's content (header, points, readings, masters, instruments), not
   the workflow fields. Signing re-checks the hash inside the transaction that changes
   the status, so a certificate edited mid-signature is refused. The checker and the
   approver must be different people from whoever calibrated.

5. **PDF with pdfkit, frozen when issued.** FT-05 is drawn with pdfkit (pure
   JavaScript, built-in Helvetica) instead of printing HTML in a headless browser:
   no Chromium is needed on the server or on a laptop, and the output is the same
   everywhere. Drafts render fresh with a DRAFT watermark. An issued certificate is
   rendered once, stored in content-addressed storage (ADR 0004) and served from
   there ever after, so a reprint is byte-identical. pdfkit is listed in
   `serverExternalPackages` because it reads font metrics from its own folder.

## Consequences

- Built-in PDF fonts cover Windows-1252 only; other characters are mapped (− → -)
  or replaced. A Unicode font can be embedded later if a certificate needs it.
- Decision rule: simple acceptance (ILAC G8). Guard-banding would change only the
  judgement, never the stored readings.
