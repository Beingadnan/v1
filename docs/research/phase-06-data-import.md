# Phase 6 research: getting logger data in, and knowing it is complete

Phase 6 takes the loggers' readings into the app after the study, checks that nothing is
missing or wrong, and sends the job to analysis (phase 7) or back to the site team.

## How it works today at QA Tech

- **The site team leader emails the Excel to the office.** For WH013, Vikas Chouhan
  (Sr. Team Leader, Indore) mailed `Dispensing-2 WH013.xlsx` on 15 Sep 2026 to Ashraf
  and Mansi. The calibration certificates of the loggers used (TL-30, TL-02) and a
  scanned sheet came in the same mail. So the person who hands over the data is
  usually not the person who writes the report.
- **The Excel is prepared by hand from the logger software's export.** WH013's `Rawdata`
  sheet has:
  - five header lines (customer, equipment, cycle, acceptance range);
  - a header row with the logger serials over a units row (`°C`, `%RH`);
  - split Date and Time columns;
  - 145 readings at 10 min;
  - then Minimum, Maximum, Average and an MKT working, under the data.

  The same workbook carries a copy of the readings in `Sheet1` (one combined date-time
  text column, no header) and a formatted `Anexures` sheet for the report.

- **The report annexure is a copy of the data.** In BE-WF-02 (pages 7–10), 9 loggers
  run over 4 pages, in the same layout as WH013's Rawdata. The summary on page 5 is
  computed from it.
- **The time column is not consistent within one file.** WH013's Time column holds plain
  times on 13 Sep and Excel date-times based on 1 Jan 1900 on 14 Sep. Both have to be
  read as a time of day.
- **Formats the parser must accept, from the files in `fixtures/`:**
  - serial headers as numbers (`83561878`) or text (`'83561878'`, `Ambient (84197505)`);
  - units as `°C` or `C`;
  - readings as numbers or text (`'22.0'`);
  - dates as Excel dates or `13.09.2026` / `20-Sep-2026`;
  - a leading `Sr. No.` column;
  - channel names like `DL-01 (°C)\nTop Front L` with the serial only on the summary
    sheet.

## Rules that apply

- **WHO TRS 961 Annex 9, Supplement 8 (2015):**
  - §2.1: recording interval programmable from 1 to 15 min, and data downloaded to a
    computer system meeting regulatory requirements.
  - §2.2.6: the same interval and the same start time on every logger, "essential" so
    that readings can be time-correlated. When loggers are collected, serials and
    locations are checked against the installation notes.
  - §2.2.7: the report annexes include the raw data, the spreadsheets and graphs for
    every logger, and the deviation/CAPA reports.
- **MHRA GxP Data Integrity Guidance (2018) and ALCOA+:** the original record, or a
  true copy, is kept and stays readable. Changes are attributable and audited. Data
  must not be deleted or overwritten without a trace.

  So the uploaded file is stored as it came, with its SHA-256 (phase 0's file store).
  A replaced file stays in the history, and every match and acceptance names who did
  it and why.

- **Vendor practice** (Eupry's guide on analysing mapping data): match the data to the
  test plan's start and end times for each test (stability, door opening, power
  failure, loading) before analysis. The app has these times from phase 5.

## What the old repos did

- **qatech-mapping** has a generic parser (header row, date/time columns, channels by
  content) and a "data mismatch" check: interval, channel count, window, gaps,
  duplicates.

  One finding from it is worth keeping. Gaps and duplicates must be judged per
  channel: all loggers share every timestamp, so a combined check reported 1,595 false
  "duplicates" on a real file. Its `Sr. No.` exclusion also came from a real file.

- **qatech-v2** (prototype) shows a "Validation" step between Data Received and
  Analysis, with the checks listed and a pass/warning/fail per check.

## Decisions for this phase

1. **A study takes one or more files, and the files are merged.** One workbook for all
   loggers (WH013), one file per logger (common with Ebro/Testo exports), or one file
   per cycle all work. Cycles are time windows from the Times tab, not separate files.
2. **The parser reads by content, not by a fixed layout.** It finds the data rows (a
   date and/or time plus numbers), the header lines above them, units, serials and
   quantity per column. It stops at the summary rows, skips `Sr. No.`, and picks the
   best sheet in a workbook (it says which, and why). Times are read as Indian time.
   CSV is read too (comma, semicolon or tab).
3. **Channels match positions by the serial of the logger placed there.** Failing
   that, by the logger's ID (TRH-3601) or the position label (L-01). Anything
   unmatched is shown for a person to assign or ignore. Nothing is guessed.
4. **The checks are per channel, inside each cycle's window from the Times tab.** Each
   one is a **blocker** or a **warning**:

   | Check                                                             | Level                               |
   | ----------------------------------------------------------------- | ----------------------------------- |
   | A placed logger missing from the files                            | Blocker                             |
   | An RH study without an RH channel                                 | Blocker                             |
   | Interval different from the study's                               | Blocker                             |
   | Data that doesn't cover the cycle's start or end                  | Blocker                             |
   | A gap of 2 or more readings                                       | Blocker                             |
   | A duplicate time with different values                            | Blocker                             |
   | Impossible values (below −100 °C, above 400 °C, RH outside 0–100) | Blocker                             |
   | Unreadable cells inside the window                                | Blocker                             |
   | One missing reading                                               | Warning                             |
   | A logger reading the same value all study ("stuck")               | Warning                             |
   | An extra logger in the file                                       | Warning                             |
   | A study with no times recorded                                    | Warning                             |
   | Readings outside the window                                       | Information only (they're left out) |

5. **A blocker sends the job to Data Issue.** The team leader can write a request
   ("L-03's file is missing, please resend"). It shows on the data provider's and the
   engineers' My studies, and closes when new data is uploaded.

   A team leader or manager may instead accept a blocker with a reason, for example
   "logger failed; excluded, see deviation". This is audited and kept until the data
   changes.

6. **Data received is a person's decision.** It's offered only when nothing is open.
   When every study on the job is received, the job moves to Data Received for
   analysis.
7. **The data provider joins the team** (from both old repos). Thermal cycles gain
   **Minimum load / Maximum load** and **hold start / hold end** markers (from
   qatech-mapping), so phase 7 has the hold window for F0.

## Fixtures

| File                                             | What it is                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `Dispensing-2 WH013.xlsx`                        | Real; 5 loggers + ambient, °C and %RH, 145 readings                    |
| `pasted_raw_data.xlsx`                           | The same data with every value as text                                 |
| `Refrigerator_Temperature_Mapping_Raw_Data.xlsx` | DL-01…06, 288 readings at 5 min, `Sr. No.` column, `20-Sep-2026` dates |
| `BE-WF-02 raw data.xlsx`                         | Rebuilt from the scanned annexure; see below                           |

`BE-WF-02 raw data.xlsx` was rebuilt from the scanned annexure of the issued report:

- every cell was read twice by OCR, with different settings;
- the 34 cells where the two readings differed were checked by eye;
- the 2 rows the OCR missed were typed from the page.

All nine loggers' minimum, maximum and average match page 5 of the issued report. It
should be replaced by the logger software's own export when QA Tech sends one.

## Sources

- [WHO TRS 961 Annex 9, Supplement 8: Temperature mapping of storage areas (2015)](https://log.logcluster.org/sites/default/files/2024-08/WHO%20-%20Supplement%2008%20-%20Temperature%20Mapping%20of%20Storage%20Areas%20-%20May%202015.pdf)
- [MHRA GxP Data Integrity Guidance and Definitions (March 2018)](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/687246/MHRA_GxP_data_integrity_guide_March_edited_Final.pdf)
- [Eupry: how to analyse data from mapping exercises](https://eupry.com/knowledge/how-to-analyze-data-from-mapping-exercises)
- QA Tech: the WH013 email of 15–18 Sep 2026; the WH013 workbook; the BE-WF-02 report
  (pages 5 and 7–10); qatech-mapping `excel-parser.ts` and `data-mismatch.ts`.
