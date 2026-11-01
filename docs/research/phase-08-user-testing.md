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
- **The letterhead:** Neon's organisation settings need QA Tech's letterhead image. The
  text letterhead is used until then. Footer details (registered office, CIN) come
  from settings.
- **Signatures:** the Done By name prints. Electronic sign-off (Checked By, Reviewed
  By, Approved By) is phase 9.
