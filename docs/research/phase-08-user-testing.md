# Phase 8 user testing: the mapping report

Tested on 1 Nov 2026 on the production build.

**Data**

- QA Tech's BE-WF-02 export, run through the whole pipeline: the integration test
  `reports.test.ts`.
- A seeded study, FE-WF-05: post-calibrated, with a 30-minute excursion accepted and
  the analysis approved. Its loggers' certificate PDF is on file.

**Roles:** team leader (preparer), field engineer, lab and manager, on desktop and on a
412 px phone. **Interruptions:** two tabs freezing at once, a late post-calibration
failure, and a session that ends while a section is being saved.

Everything below was fixed and has a test unless marked **open**.

## The exit test

The app's BE-WF-02 report was compared with the issued one, page by page.

| Pages | Result                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–6   | The same structure and the same numbers on every page: cover, index, details (next due 22.05.2027 as issued), diagram (L-05 red, L-04 yellow), graph and summary (every min/max/average as on page 5), observation, conclusion, annexure and signature block. |
| 7+    | Raw data, landscape.                                                                                                                                                                                                                                          |
| After | Certificates.                                                                                                                                                                                                                                                 |

The test checks the numbers and text by extracting the PDF's text.

**Ashraf's sign-off on the look is still to come.** Send him a frozen Rev 00 from Neon.

## What broke, and the fix

| Found                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The first PDF had 22 pages: 11 were blank.** The footer was written below pdfkit's bottom margin, so pdfkit started a new page for each footer, and the DRAFT watermark landed on those blank pages. | Every page now has no bottom margin, so the footer stays on its own page. A draft is now 12–13 pages.                                                                                                                                                                        |
| The diagram read "L-3360 mm mm", the height tag sat on the legend, and the box used half the page.                                                                                                     | Sizes print once, the legend moved below, and the box fills the page as on the paper.                                                                                                                                                                                        |
| The cycle type read "Temperature mapping Study".                                                                                                                                                       | It now reads "Temperature Mapping Study", as on the cover of the issued report.                                                                                                                                                                                              |
| The DRAFT watermark is faint, and a text copy didn't show it.                                                                                                                                          | The footer of every draft page also says "Rev 00 DRAFT: not for issue".                                                                                                                                                                                                      |
| **Emoji and Hindi in the observation printed as "??".**                                                                                                                                                | Saving is refused: "The report can't print 👍 न म ू ा. Write it in English letters and figures." Typed quotes, dashes and the minus sign are mapped, and ° and µ print.                                                                                                      |
| **An engineer couldn't post-calibrate once the report was being drafted.** Loggers often come back to the lab days later.                                                                              | Post-cal stays open through Report draft and Rework. A late failure opens a deviation (QT/DEV/2026/0001 in the test) and takes the analysis approval back. A new revision can be started, but can't be frozen until the deviation is closed and the analysis approved again. |
| **The PDF preview was a blank grey box on the phone.** Mobile Chrome doesn't show a PDF inside a page.                                                                                                 | On a phone there is an "Open Rev 00 to read it" button instead, which opens the phone's PDF viewer.                                                                                                                                                                          |
| The report number was printed twice at the top of the Report tab.                                                                                                                                      | It is printed once now.                                                                                                                                                                                                                                                      |
| Freezing was possible while the logger certificate had no PDF.                                                                                                                                         | Freezing is refused: "These certificates have no PDF on file: QATECH/BHIWANDI/04/26/PDL-77. Upload them (Instruments) before freezing."                                                                                                                                      |

## Two people, one record

- **Two tabs freezing Rev 00 at the same moment:** one freezes it (13 pages, with its
  SHA-256). The other is told "Rev 00 is frozen and can't be changed." The PDF
  rendered for the second tab is kept but not used (content-addressed storage).
- **Two people drafting:** the second is told "Rev 00 is already being drafted."

## Roles

| Role                 | What happened                                                     |
| -------------------- | ----------------------------------------------------------------- |
| Team leader, manager | Draft, edit, freeze and revise.                                   |
| Report preparer      | The same (integration test).                                      |
| Field engineer, lab  | See the report and its PDF, with no buttons. They post-calibrate. |
| Accounts             | Can't draft: refused in the integration test.                     |

## Open

- **Ashraf's sign-off** on the look, side by side with the issued BE-WF-02.
- **Templates for FT-06** (autoclave), **FT-10/11** (warehouse) and **the WCR**: waiting
  for QA Tech's blank forms.
- **The letterhead:** Settings → Letterhead now takes an image. On Neon it holds a crop
  of the scanned BE-WF-02 letterhead (300 dpi, background whitened), and the 11-page
  draft prints it. Replace it with QA Tech's original file when they send it: the crop
  is a little soft. Footer details (registered office, CIN) come from settings.
- **Signatures:** the Done By name prints. Electronic sign-off (Checked By, Reviewed
  By, Approved By) is phase 9.

## On Neon, as QA Tech would use it (1 Nov 2026)

One person stepped through each role in Chrome, on test job QT/J/2026/0005 for
BE-WF-02. The job was cancelled afterwards ("Test job made by Claude while testing
phase 8 on Neon").

1. **Manager:** creates the job (PO TEST-P8, team leader on the team). The readiness
   list is ticked, and "Book loggers" books 10 for 9. The job is Ready.
2. **Field engineer:**
   - My studies → Today → BE-WF-02;
   - fills the 9-position template and saves it;
   - scans 9 loggers in one burst. Neon took about 70 s for all of them; the queue
     placed every one, in order.
   - records the times: started 31 Oct 10:00, ended 1 Nov 10:00.
3. **Data provider:** uploads the logger Excel. It has a title line above the
   header and logger IDs as column names. All 9 matched, nothing wrong (the phase 7
   fix holds).
4. **Team leader:** confirms the data. The job moved to Data received.
5. **Report preparer:**
   - My studies → To analyse → Run;
   - L-05 hot −16.7 and L-04 cold −21.9, as on the issued report;
   - accepts L-08's 20-minute excursion with the site's door-log reason.
6. **Team leader:** approves run 1.
7. **Report preparer:** Reports → Draft the report. The job moved to Report draft.
   - The 11-page draft preview shows the template wording with the accepted
     excursion.
   - Freeze was refused, correctly: the loggers' certificate PDL-01 (imported from
     the old register) has no PDF.

| Found                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The preview frame said "localhost refused to connect".** Every response sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so the app refused to show its own PDF. The browser test only checked that the frame was there. | The report PDF route alone sends `SAMEORIGIN` and `frame-ancestors 'self'`. The browser test now checks these headers. The 11-page preview shows on Neon.                                                                                       |
| **There was no way to add the scan of an imported or outside-lab certificate after it was recorded,** so a report using PDL-01 could never be frozen.                                                                                 | The certificate page shows "Attach the certificate PDF" when there is no file (PDF, PNG or JPEG). It is audited, and an attached file can't be replaced. The freeze message says where to go.                                                   |
| A cancelled job's draft stayed on the Reports page.                                                                                                                                                                                   | The Reports page leaves out cancelled jobs' reports. They stay on the study.                                                                                                                                                                    |
| The report number came out as `…/BE-WF-02-3`. The two cancelled test jobs this autumn had reserved the plain number and `-2`.                                                                                                         | **Open, a decision for QA Tech:** should a cancelled job give its reserved report number back?                                                                                                                                                  |
| The first scan burst in Chrome lost 8 of 9 scans.                                                                                                                                                                                     | Not the app: the browser tool's click missed the field. With the field focused, as a scanner gun types into it, every scan was placed. The burst was also checked locally at Neon speed (5 s per reply), typed fast and slow: 9 of 9 each time. |

**Not done on purpose:** attaching a test scan to PDL-01. It is a real certificate,
and an attached file is permanent, so a made-up scan would be false evidence on a
real record. Freezing waits for QA Tech's real scan of PDL-01.
