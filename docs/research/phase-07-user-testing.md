# Phase 7 user testing: analysis, post-calibration and deviations

Tested on 31 Oct 2026 on the production build:

- **QA Tech's own data:** the BE-WF-02 export, through upload, matching, confirmation
  and analysis. It is the export rebuilt from the issued report; see
  `fixtures/client/BE-WF-02 raw data.README.txt`.
- **A seeded study,** FE-WF-04: nine loggers, L-05 above −15 °C for 30 minutes, and
  post-calibration required.
- **The roles:**
  - field engineer, on a 412 px phone;
  - lab;
  - team leader, on desktop and phone;
  - manager.

  Accounts and the client roles were checked against the permission matrix. They have
  no analysis rights, and clients have no study access until phase 9.

- **Interruptions:**
  - a session that ended mid-entry;
  - two tabs deciding the same deviation;
  - Run pressed twice;
  - Run pressed by two people at once.

Everything below was fixed and has a test unless marked **open**.

## The exit test

- **Integration test** (`analysis-real-file.test.ts`). BE-WF-02 gives every minimum,
  maximum and average on page 5. L-05 is the hot spot (−16.7) and L-04 the cold spot
  (−21.9). Each position has 145 readings, there are no excursions, and the study is
  within limits: the −15.0 at L-05 and L-08 is on the limit, not over it.
- **End-to-end test** (`analysis.spec.ts`). A logger fails post-calibration, and
  deviation QT/DEV/2026/0001 opens by itself. Approval stays locked until two things
  happen:
  - QA Tech writes its assessment;
  - the client QA head's decision ("Exclude probe", Dr. R. Shah) is recorded.

  The rerun leaves L-04 out, and the team leader approves it.

## What broke, and the fix

| Found                                                                                                                                                        | Fix                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The engineer couldn't find the study for post-cal.** Once the data was confirmed, the study dropped off My studies.                                        | My studies has a new group, "Post-calibration to do", with "7 loggers to post-calibrate". Tapping it opens the Post-cal tab, and the loggers still to check are buttons that fill in the form. |
| **The team leader couldn't find it either.** Nothing listed a study waiting for analysis.                                                                    | People who run analyses get a "To analyse" group ("Data confirmed: ready to analyse"). It opens the Analysis tab.                                                                              |
| **A signed-out phone said "No connection".** The outbox kept the reading but returned "queued". This affected post-cal, pre-cal, logger placement and times. | The phone now says "You were signed out. G-TRH0002 is kept on this phone: sign in again (in a new tab) and it will be sent." Checked: after signing in, the reading went out.                  |
| **The impact line showed an internal id** ("95b3a7cf-… corrected by +1.2").                                                                                  | It now names the position and unit: "L-07 corrected by +1.2 °C".                                                                                                                               |
| **"The study Fail" under a post-cal deviation** read as if L-07 caused it. L-05's excursion did.                                                             | The line now says "The study's verdict would be Fail (the same as without the correction)", or "(it changes with the correction)".                                                             |
| A change after approval (a new post-cal failure) left the old approval in place.                                                                             | Opening a deviation withdraws the approval, and the withdrawal is audited. A rerun on changed data does the same.                                                                              |
| The decision date showed as 2026-10-31.                                                                                                                      | It now reads 31 Oct 2026.                                                                                                                                                                      |
| The 30-day rule on site times made a past study (BE-WF-02, May) impossible to rebuild for the real-file test.                                                | Kept: the rule is right for the phone. The test writes the past times directly.                                                                                                                |

## Messy input

Each case was tried on the phone, in the Post-cal tab:

| Typed                                                  | Result                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `−20,0` / `−20,1` (Unicode minus, comma)               | PASS, deviation −0.1                                                                                               |
| `-20.0 °C` / `-20.2°C`, logger as `g-trh0002`          | PASS (the units and the case don't matter)                                                                         |
| `200` for −20.0                                        | "The logger reads 220.0 away from the master. Check the numbers (a decimal point or a minus sign may be missing)." |
| `G-TRH0099`                                            | "G-TRH0099 is not in the instrument register."                                                                     |
| `F-TRH0001` (another study's logger)                   | "F-TRH0001 wasn't used on the FE-WF-04 study."                                                                     |
| `77300003` (a serial, not the ID)                      | Found as G-TRH0003                                                                                                 |
| The same reading sent twice after a dropped connection | Recorded once, and the deviation is not opened twice                                                               |

## Two people, one record

- **Run pressed by two people at once:** one run is made. The second is told "Nothing
  changed: run 1 stands."
- **Two tabs recording the client decision:** the second is told "QT/DEV/2026/0001
  was already closed (No impact, Dr. R. Shah)."
- **Two people approving:** the second is told "FE-WF-04's analysis is already
  approved."
- **A session that ends during analysis:** the action returns the signed-out message,
  and nothing is changed.

## Phone

The Post-cal and Analysis tabs don't scroll sideways at 412 px. The summary table
scrolls inside its card.

## Open

- **The lab can't use My studies** (it has no `data.import`). It reaches a study through
  Jobs → the job → the study. Post-cal could get its own lab list ("Loggers back from
  site") in phase 11 (fleet).
- **The real logger software's export** for BE-WF-02 is still to come from QA Tech. The
  golden test runs on the rebuilt one.
- **MKT method:** QA Tech has to decide whether to keep the sheet's method (MKT of the
  average) or move to the per-reading MKT. Both are shown until then.
- **Excursion acceptance rules:** QA Tech has to decide whether a preparer may accept
  an excursion, or only a team leader. Today a preparer may, and a team leader approves
  the whole analysis.

## On Neon, from India (1 Nov 2026)

Test job QT/J/2026/0004 for BE-WF-02 was built in Chrome, then cancelled ("Test job
made by Claude while testing phase 7 on Neon"):

1. 10 loggers were booked, and 9 placed in one scan burst.
2. The study ran 31 Oct 10:00 – 1 Nov 10:00.
3. BE-WF-02's readings were uploaded with logger IDs as column headers. L-08 had two
   readings at −14.6.
4. The data was confirmed.
5. Post-cal was done for all 9 loggers. TRH-3604 read 0.8 high, and QT/DEV/2026/0001
   opened by itself. One logger was entered by its serial, 84028451, which T-TRH0124
   and T-TRH0132 share; it was resolved to the placed T-TRH0124.
6. Run 1:
   - L-05 was the hot spot (−16.7) and L-04 the cold spot (−21.9), as on page 5.
   - The L-08 excursion was found: 20 min, peak −14.6.
   - The impact run showed L-04 still passing with −0.8 °C applied, and the study's
     verdict unchanged.
7. The excursion was accepted, the assessment written, and "No impact" recorded. Run 1
   was approved, and the job moved to Analysis by itself.

| Found                                                                                                                                                        | Fix                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A title line straight above the header spoiled every column name** ("BE-WF-02 TRH-3601 °C"). The ID picked from it was "WF-02", so 0 of 9 loggers matched. | With three or more reading columns, a header line naming at most one of them is left out, and the notes say so. A logger ID or position label anywhere in the header now matches. |
| **After that fix, 9 of 9 matched with 0 problems, but no Confirm button.** The stored status still said "issues" from the older rules.                       | The Data tab works out its status from the live check. Confirming checks again before it records anything.                                                                        |
| Typing the next logger while the previous post-cal was still sending (5–10 s on Neon) gave "TRH-3603TRH-3604".                                               | Correctly refused as "not in the instrument register". **Open:** the field could clear as soon as the reading is sent, rather than when the answer arrives.                       |
| Success messages ("Run 1 done.") show a few seconds before the page refreshes on Neon.                                                                       | **Open**, as in phase 6. Moving the database to Singapore should shorten it.                                                                                                      |
| The job page still shows "Ready for field work? Everything is in place." at Analysis.                                                                        | **Open:** hide the checklist once field work has started.                                                                                                                         |
| Neon has no master standards, so post-cal records "Master: Not recorded".                                                                                    | **Open:** add QA Tech's masters to the register.                                                                                                                                  |
