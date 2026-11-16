# Instrument certificates: how they arrive, and making the upload easy

November 2026. Looked at QA Tech's own "FW Traceability" folder (fixtures, not committed)
and at how calibration-management tools handle certificates.

## What QA Tech's files look like

- **Masters, outside labs** (`Traceability/`, `Yokogawa/`): one scanned PDF per
  certificate, named "ID due-date" ("TL-38 27.01.2027.pdf", "TL-02B, 02A 22.08.2026.pdf",
  "DL-17 (08.06.2027).pdf"); copies get "_1", "_2". Scans have no text layer. Each
  certificate prints its number, the NABL ULR, the lab, the calibration and due dates,
  the instrument's ID and serial.
- **QA Tech FT-05 batches** (`Rotronic Sensor/`, `Pre Post Calibration Certificate/`):
  the Excel workbook (already imported) and a signed paper scan, often named by the
  scanner ("20260424165534.pdf"); one page lists 10 to 25 loggers.
- **Multi-page files**: a Yokogawa data logger's certificate runs to 20 pages; one PDF
  can hold two masters' certificates ("ET-01, 01A").
- The register held 546 certificates, 535 without a scan.

## What other tools do

Calibration-management software keeps the certificate document against the asset and
the calibration event and sends due-date reminders: Fluke's
[calibration software](https://www.fluke.com/en-ca/learn/blog/calibration-software/from-spreadsheets-to-calibration-software)
and [CalStudio](https://www.fluke.com/en-ca/learn/blog/calibration-software/modern-calibration-management-software),
[TMA ProCalX](https://www.tmasystems.com/products/procalx/features),
[Calibration Control](https://www.capterra.com/p/42536/Calibration-Control). What a
calibration certificate must carry (ISO/IEC 17025 7.8): a unique identification, the
lab, the item's identification, the date of calibration and the results
([UKAS LAB 5](https://www.ukas.com/resources/publications/laboratory-accreditation/lab-5-reporting-calibration-results/),
[NIST SOP 1](https://www.nist.gov/document/sop-1-calibration-certificate-preparation-20190506pdf),
[Beamex](https://blog.beamex.com/what-is-a-calibration-certificate)). Those are exactly
the fields needed to file a scan, so they can be read off it.

## Added because of this

- Upload many scans at once; each read (vision model or file name), matched to its
  instruments and to its certificate on record, checked in one list, saved together
  (ADR 0024).
- "No scan" filter and count on the certificate list, with the warning that reports
  can't be frozen; a Scan column with the PDF link on the instrument page.
- "Upload certificate" first on the instrument page; the eight-field form stays as
  "Enter without a scan".
- The certificate list pages by 100 (it drew all 546 rows, 31,000 px tall).
