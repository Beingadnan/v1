# ADR 0024: Uploading certificate scans in bulk

Status: accepted (16 Nov 2026)

## Context

QA Tech keeps two kinds of calibration certificate as paper scans: outside-lab
certificates of its masters (Sansel, ARAI, Tempsens: "TL-38 27.01.2027.pdf") and its own
FT-05 batch certificates for loggers, signed on paper and scanned
("20260916144933.pdf"). The Excel imports recorded 535 certificates without their scans,
and a report can't be frozen while a certificate it relies on has none.

Before this change a scan went in one at a time: open the certificate, press
"Attach the certificate PDF", or type eight fields into "Record outside-lab certificate"
on the instrument page. With hundreds of files that is days of work, and QA Tech found
the two paths confusing.

## Decision

1. **One page, many files.** Instruments → Certificates → Upload certificates takes
   every scan at once (PDF, PNG or JPEG). Each file is uploaded, read, matched, and shown
   as a row; nothing changes until Save, and each row saves on its own.
2. **Read by the same vision model as the layout sketches** (ADR 0021): Claude when
   `ANTHROPIC_API_KEY` is set, else OpenAI. The model returns every certificate in the
   file (number, ULR, lab, calibration and due dates, instrument IDs and serials) against
   a strict schema; the answer is checked leniently (a bad date becomes empty, a broken
   entry is dropped). Each file is read once; the reading is kept in
   `certificate_scan_readings` and the read is audited.
3. **The file name is read too.** Without a key, or when the model fails, QA Tech's
   naming gives the IDs and a date: "ID due-date" for masters, "date … ID" for its own,
   ranges like "TRHS-031 to TRHS-050" expanded.
4. **Matching.** An instrument is found by its ID (whole, or the last part either way
   round: "TL-38" ↔ "QATM/CAL/TL-38", leading zeros ignored) or its serial. A
   certificate on record is found by its number (case, spaces and leading zeros
   ignored), or, with no number, by the same instruments and date. Then the row says
   what Save will do: attach to the certificate on record, record a new one (outside lab
   → external; QA Tech → imported), already on file, or what the person must fill in.
5. **The instrument page** offers "Upload certificate" first; typing a certificate
   without a scan stays as "Enter without a scan". The certificate list shows which
   certificates have no scan, with a filter and a count, and pages by 100.

## Consequences

- Reading costs a few cents a file on the model's account; nothing is sent unless a key
  is set.
- A certificate's number is the strongest match; a scan whose number differs from the
  imported record (a typo in the Excel) is shown as "new", and the person can type the
  recorded number to attach it instead.
- A scan stored as a photo is served as a photo from the certificate's PDF link.
