# Phase 8 research: the mapping report (FT-09) and its PDF

Phase 8 turns an approved analysis run (phase 7) into QA Tech's mapping report, form
QATM/PVAL/FT-09, laid out like the issued BE-WF-02 report.

## The issued BE-WF-02 report, page by page

The file is a 25-page scan (`fixtures/client/BE-WF-02 report.pdf`, Canon scanner, no
text layer). Every page carries the same letterhead, a "Customer Name / Report No. /
Validated By" box, `QATM/PVAL/FT-09` bottom left and "Page n of 6" bottom right, and
the GMP Technical Solutions registered-office footer.

| Page  | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Cover:** the customer's name and address, "Temperature Mapping Study", the equipment ID and the report number, in shaded boxes.                                                                                                                                                                                                                                                                                                                       |
| 2     | **Index:** seven rows with page numbers. The annexure rows read "1 to 2" and "–".                                                                                                                                                                                                                                                                                                                                                                       |
| 3     | **Equipment & Mapping Details:** name, ID, location, make, model, serial, department, cycle type, set point, acceptance range, mapping end date, next due date, reading interval, number of channels, duration. Then **Details of Data Logger Used** (serial, range, accuracy, calibration date, next due) and **Above Data Logger Was Calibrated by Using** (the masters behind the loggers' certificates: instrument, make, serial, certificate no.). |
| 4     | **Diagram Indicating Sensors Positions:** a 3D box with its dimensions in mm and L-01…L-09. The hot point is shown red and the cold point yellow, with a legend.                                                                                                                                                                                                                                                                                        |
| 5     | **Equipment & Mapping Details** (short form: duration, start and end date and time), the note "All the graphs … are based on attach raw data", **TEMPERATURE V/S TIME** (one line per logger, legend by serial, time labels every 30 min), the **summary table** (position, min, max, average), and **Average Minimum & Average Maximum Temperature** (position and value).                                                                             |
| 6     | **OBSERVATION:** the cold point (yellow) and the hot point (red), with serial and average. **CONCLUSION:** the result against the acceptance criteria and "qualified for its further use". **ANNEXURE:** sensor location → serial. **Signature block:** Done By / Checked By (QA Tech) and Reviewed By / Approved By (client), with signature, name and organisation.                                                                                   |
| 7–10  | **Raw data**, landscape, "Page n of 4": date, time and one column per serial, with the study details in a side block. The last page ends with MINIMUM / MAXIMUM / AVERAGE rows.                                                                                                                                                                                                                                                                         |
| 11–18 | **QA Tech's FT-05 calibration certificates** for the loggers. The logger's serial is highlighted yellow, and each copy is stamped "TRUE COPY".                                                                                                                                                                                                                                                                                                          |
| 19–25 | **The masters' outside-lab certificates** (Sansel, ARAI), as scanned.                                                                                                                                                                                                                                                                                                                                                                                   |

## What WHO TRS 961 Suppl. 8 asks of the report (§2.2.7, §2.4)

- **Body:** introduction, a summary in the protocol's order **including any
  deviations**, and conclusions and recommendations (is the equipment acceptable?).
- **Annexes:**
  - the sensor locations;
  - raw data;
  - spreadsheet data **and temperature graphs for every logger**;
  - the analysis with hot and cold spots;
  - **deviation reports with CAPA**;
  - **calibration certificates for every logger**.
- **Analysis:** minimum, maximum and mean per location; the hot and cold spots; door
  and power records.
- **Sign-off (§2.4.5):** an independent competent person reviews and signs. When a
  third party wrote the report, the commissioning party approves it. That is QA
  Tech's Checked By, and the client's Reviewed / Approved By.

## Data integrity rules that shape the design

From EU GMP Annex 11 and the MHRA and FDA data-integrity guidance:

- A report version, once issued, is never changed. A correction is a new version that
  says why, and the old one is kept, marked superseded. A copy must be a true copy.
- **The raw data in the report must be the data in the system.** The report is built
  only from an approved run (phase 7), which is tied to the uploaded files by their
  SHA-256.
- **Text a person writes is attributable,** so edits to the observation and the
  conclusion are audited, with before and after.

## Decisions

1. **pdfkit, not HTML in a headless browser.** This keeps ADR 0008: no Chromium on the
   server, and identical output on a laptop and in production.
   - The chart is drawn as vectors with pdfkit, so it stays sharp when printed.
   - The editor's preview is the PDF itself, in a frame next to the sections, so what
     is checked is exactly what is issued.
   - The FT-12 sensor diagram code is reused for page 4, with hot red and cold yellow
     as on the paper.

2. **Same pages as BE-WF-02**, generated from the records:
   - page 3's loggers and masters come from the instrument register and from the
     certificates' traceability (phase 3);
   - the index page numbers are worked out by laying the report out twice;
   - pages QA Tech's report lacks are added only when needed: one chart and table per
     cycle for multi-cycle studies, door and power results, and a deviation annex.

3. **Annexures in the paper's order:**
   - raw data in landscape (date, time and one column per serial, with MINIMUM /
     MAXIMUM / AVERAGE at the end);
   - each logger's FT-05 certificate, re-drawn from its record with the serial
     highlighted and marked "TRUE COPY". An imported certificate with only a scan is
     attached as scanned;
   - the post-calibration sheet, when there is one;
   - the masters' certificates, the lab PDFs attached as uploaded;
   - deviations, with QA Tech's assessment, the impact and the client's decision.

   PDFs are joined with pdf-lib (pure JavaScript).

4. **The observation and conclusion start from templates** worded like the BE-WF-02
   report. A failed study gets a "does not comply" conclusion. People may edit the
   text; each edit is audited, and "Reset to template" brings the wording back.

5. **Revisions.**
   - A report is created from the approved run as a draft (Rev 00). The draft renders
     fresh each time, with a DRAFT watermark.
   - **Freezing** renders it once and stores the PDF in content-addressed storage (ADR 0004) with its SHA-256, so a reprint is byte-identical.
   - A new revision (Rev 01…) needs a reason and marks the previous one Superseded.
   - A report can't be created or frozen while the analysis approval is missing,
     withdrawn or out of date.
   - Creating the first report moves the job from Analysis to Report draft.

6. **Signatures are phase 9.** The signature block prints:
   - the preparer's name under Done By;
   - the checker's name under Checked By once they sign;
   - empty client boxes for wet signatures.

   Electronic sign-off and sending to the client come in phase 9.

7. **Not in this phase:** FT-06 (autoclave), FT-10/11 (warehouse) and the WCR, until
   QA Tech sends the blank forms. The model allows one template per work type.

## Sources

- [WHO TRS 961 Annex 9, Supplement 8: Temperature mapping of storage areas (§2.2.7, §2.4)](https://log.logcluster.org/sites/default/files/2024-08/WHO%20-%20Supplement%2008%20-%20Temperature%20Mapping%20of%20Storage%20Areas%20-%20May%202015.pdf)
- [ECA: WHO Supplement 8 overview](https://www.gmp-compliance.org/guidelines/gmp-guideline/who-supplement-8-temperature-mapping-of-storage-areas)
- [EU GMP Annex 11, computerised systems (summary)](https://sgsystemsglobal.com/it/?p=15579)
- [Pharmaguideline: data integrity in validation](https://www.pharmaguideline.com/2026/09/data-integrity-in-validation.html)
- QA Tech: the issued BE-WF-02 report (25 pages, scanned); ADR 0008 (pdfkit, frozen PDFs); ADR 0012 (approved runs).
