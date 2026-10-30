# Phase 6 user testing: getting the logger data in

Tested on 30 Oct 2026 on the production build:

- QA Tech's real files: `Dispensing-2 WH013.xlsx` (as emailed from Indore), the
  BE-WF-02 export rebuilt from the issued report, a refrigerator export from another
  client, and the same WH013 data pasted as text;
- two studies seeded with the real loggers' serials and the real study times;
- the roles: preparer (data provider), field engineer, team leader, accounts;
- desktop, and a 412 px phone.

Everything below was fixed and has a test unless marked **open**.

## What broke, and the fix

| Found                                                                                                                                                                 | Fix                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A file uploaded by mistake couldn't be taken off the study.** Only "Replace" was offered, so the wrong file's 7 problems stayed.                                    | "Wrong file? Remove it", with a reason. The file stays in the history, marked removed, and can still be downloaded.                                                                         |
| **Another study's file wasn't recognised as such.** The refrigerator file (20–21 Sep) on BE-WF-02 (22–23 May) produced an interval complaint and 6 unmatched columns. | A file whose readings fall outside every recorded time is flagged first: "…has readings from 20 Sept… but the study ran 22 May… Is it the right file?". The rest of its noise is held back. |
| **The same data saved again was taken twice.** A re-saved workbook has different bytes, so every logger came out "in 2 places".                                       | The same readings are refused whatever the bytes: "…has the same readings as BE-WF-02 raw data.xlsx… To use it instead, replace it."                                                        |
| Two tabs confirming the same data both succeeded, and it was recorded twice.                                                                                          | The second is told "BE-WF-02's data was already confirmed by Tarun Lead at 30 Oct 2026, 16:36."                                                                                             |
| Signed out, an upload said only "Sign in again."                                                                                                                      | "You were signed out, so Dispensing-2 WH013.xlsx wasn't uploaded. Sign in again (in a new tab), then choose the file again."                                                                |
| An old `.xls` was refused as "not a PDF, Excel, CSV or image file".                                                                                                   | "…is an old Excel file (.xls). Open it in Excel and save it as .xlsx, then upload that." A `.txt` export is told to rename it to `.csv`.                                                    |
| The data provider found finished studies under "Done", though their data was still due.                                                                               | A group "Data to send or check" comes first, with "Logger data not uploaded yet", "Data needed: …" or "Data checked: waiting to be confirmed". Tapping opens the Data tab.                  |
| A field engineer, who can't confirm, saw a checked study with no next step.                                                                                           | "Nothing is wrong. A team leader or manager confirms the data next."                                                                                                                        |
| Averages showed "−21.79" next to "−21".                                                                                                                               | One decimal, as on the report's page 5: "avg −21.8".                                                                                                                                        |
| The preview showed the oldest file, not the one just uploaded.                                                                                                        | The newest.                                                                                                                                                                                 |
| On a phone, the Data tab was scrolled out of sight in the tab row.                                                                                                    | The current tab scrolls into view.                                                                                                                                                          |
| Accounts could open a study (they can see jobs), but its "My studies" link led to a page they can't open.                                                             | For them it leads back to the job.                                                                                                                                                          |

## What worked

- **WH013, as emailed:** 145 readings, 12 columns (5 loggers + ambient, °C and %RH)
  read from "Rawdata", all matched by serial, nothing wrong. The ambient logger landed
  on the ambient position. The reader stopped at "Minimum" and said so. The min, max
  and average of every column match the workbook's own summary rows.
- **BE-WF-02:** 9 of 9 matched. The minimum, maximum and average of every logger match
  the issued report's page 5 (L-04 coldest, −21.9; L-05 hottest, −16.7).
- **The pasted copy (every cell text, dates as "13.09.2026"):** read the same way.
  Uploaded next to WH013, each logger was reported "in 2 places", with a pointer to
  ignore one. Removing the copy cleared it.
- **A 30-minute gap:** "2 readings missing between … (a 30-min gap)". The job moved to
  Data issue. Accepting it with a reason brought the job back, and withdrawing the
  acceptance reopened it.
- **A request to the site** ("Send the door-open cycle export too") showed on the
  engineer's My studies and kept the job in Data issue. The next upload closed it.
- **Permissions:** the engineer can upload and match columns but has no Accept or
  Confirm. Accounts has no Studies menu and sees the data read-only.
- **Phone:** nothing scrolls sideways at 412 px. The preview table scrolls inside its
  own box.

## Automation added in this phase

- **Match by serial:** no typing of which column is which logger.
- **The file explains itself:** which sheet, which rows, where it stopped, what it
  left out.
- **Problems are worded with the position, logger ID, serial and times,** so the email
  to the site can be copied from the screen.
- **Requests close themselves** when data arrives.
- **The job's status follows the data,** with no manual status changes.

## Open, for later phases

- **The issued BE-WF-02 export is rebuilt from the report** (OCR checked against page
  5). Replace it with the logger software's own file when QA Tech sends it.
- **Data arrives by email today.** Forwarding the site's email to an upload address
  would save the download-and-upload step. Not built: it needs a mail service.
- **Old `.xls` exports** need saving as `.xlsx` first. If QA Tech's ebro software
  only writes `.xls`, add a reader then.
- **Speed on Neon** (phase 5 note): an upload takes a few seconds from India to
  us-east-2.
