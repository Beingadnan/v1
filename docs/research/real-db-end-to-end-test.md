# End-to-end test on the real database, with QA Tech's real files

Started 2 Nov 2026 and still running. The test used QA Tech's Neon database through the app on the
Mac, in Chrome, signed in as TEST users (one per role).

**Nothing was deleted.** Records made for the test carry "TEST" in their name. Four bad
instruments that an import bug created were retired with a reason, not deleted.

## What is real and what is TEST

| Real (from `fwtraceability_/`)                                                                                     | TEST                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Masters QATM/CAL/TL-02, TL-30, TL-38, TL-65 with their ARAI, Sansel and Tempsens certificates (scans attached)     | Client "TEST Claude Demo Pharma Pvt Ltd" (TESTDEMO): 2 sites, 5 equipment, 2 client users |
| Logger certificates PDL-12, PDL-13 (twice), PDL-14 (Baddi) and PDL-04, PDL-05, PDL-06 (Nagpur), with every reading | 8 TEST users, one per role (accounts list in `.data/TEST-ACCOUNTS.txt` on the Mac)        |
| Loggers T-TRH001…T-TRH100 and the 118 Nagpur Testo loggers                                                         | Logger data files: written in the Testo export layout, for the real loggers' serials      |
| Jobs QT/J/2026/0007 (freezer, cold room, dispensing area) and 0008 (two warehouse areas)                           | The data values, the photos, the protocol and gate-pass notes                             |

An early TEST calibration certificate (QATECH/BHIWANDI/11/26/PDL-01 for TEST loggers, with TEST
masters TEST-MST-01 and 02) stays as a draft.

## Found and fixed

Every fix has a test, passes `npm run check` and the integration tests, and is on the Mac.

| Found (role, file)                                                                                                                                | Fix                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Equipment form refused "3.5 m", "2,5", "-20 °C" (manager)                                                                                         | Numbers read as people type them                                                                                             |
| New calibration refused "TEST-TRH0001 - TEST-TRH0024" (lab)                                                                                       | Ranges in instrument lists                                                                                                   |
| A pasted serial repeated was dropped without a word (lab)                                                                                         | "(N repeated, added once)"                                                                                                   |
| "12 months" as calibration interval: "expected number, received NaN" (lab)                                                                        | Months and years read; plain message otherwise                                                                               |
| **PDL-13 is printed on two calibrations (23.07 and 24.07.2026). The second was skipped as "already recorded": 40 loggers lost their calibration** | Recorded as "PDL-13 (24.07.2026)", with a remark and a warning                                                               |
| Nagpur workbooks name loggers by serial only: the first import kept 3 of 38                                                                       | Importing the workbook again, once the serials have IDs, adds the missing loggers and their readings                         |
| Nagpur's Testo list prints three blocks side by side: 50 of 118 loggers read                                                                      | Every block read; serials pasted into an ID column skipped                                                                   |
| That list names no make or model: 111 loggers without accuracy                                                                                    | The preview asks for the model                                                                                               |
| Elitech sheets print Serial No. and ID No. on two rows: the serial became the ID                                                                  | Both rows read                                                                                                               |
| **The Elitech "50 certificate" readings are an exact copy of Testo PDL-12/13, logger for logger**                                                 | The import warns when most of a certificate's loggers read exactly what another's do. **Not imported: for QA Tech to check** |
| **Working cells beside PDL-14's table (-25.2, -25.3…) were registered as four loggers, then booked on a job**                                     | A bare number ends the table; imported IDs must pass the same rule as the form; the four were retired                        |
| A report could not be frozen without a scan of each imported logger certificate                                                                   | Imported FT-05 certificates carry every reading, so the annexure redraws them (TRUE COPY)                                    |
| A 168 h dispensing study and a 72 h × 4-cycle cold room were planned into 3 days without a word (team leader)                                     | Readiness "Long enough on site": names the study, counts every cycle, gives the last day that fits                           |
| Booking took the Rotronic RH indicator as the °C master, then reported "short of 1 humidity master" with the SSPRT free                           | SSPRT for °C, RH indicator for %RH                                                                                           |
| The power-failure cycle could be started while the door-open cycle was running (field engineer)                                                   | Refused, naming the cycle it overlaps                                                                                        |
| Post-cal: the next logger typed while the last one was sending was wiped (Neon takes 3–5 s)                                                       | Only the values sent are cleared                                                                                             |

## Worked as it should

- An expired master (TL-02, TL-30) is refused for post-cal, naming its date.
- A retired logger can't be placed.
- An unbooked valid logger is booked when scanned.
- A failed post-cal (T-TRH006, 0.90 against ±0.5) opened deviation QT/DEV/2026/0002 by itself.
- %RH points can't be signed without a humidity master.
- A serial registered under another ID keeps the registered ID. The Nagpur list calls TRH-3615 "T-TRH0714", and T-TRH046 "T-TRH066".
- Readiness listed the retired loggers ("not in use") until they were released.
- Times can't be struck out from the middle of a cycle; the later ones go first.

## Open: for QA Tech to decide

1. **Elitech 50 certificate:** measured or copied? It is left out until QA Tech says.
2. **Indore PDL-19 (24.08.2026):** 41 loggers with serials and no QA Tech IDs anywhere. The real Dispensing-2 data (Glenmark, 13.09.2026) needs them.
3. **Masters are blocked for a whole job.** Two overlapping jobs can't share TL-65/TL-38, though post-cal takes an hour. Should a master be booked for the post-cal day only?
4. **Duplicate logger IDs in QA Tech's own files:** PDL-14 lists T-TRH092 twice (two serials), and serial 84664007 is "84734583" in the register.
5. **Report numbers keep the month of creation** (…/11/26/…) after the job's dates move to October.
6. **Struck-out times disappear from the Times tab.** They stay in the audit trail. Should FT-12 show them struck through?
7. **Slow saves on Neon** (job create 40 s to open, certificate save 30 s): check the Neon region (phase 12).
8. **Search ranks partial matches first:** "T-TRH050" lists T-TRH0503 and T-TRH0501 before T-TRH050.
9. **Lists imported without a site** give their loggers no home site, so "QA Tech site: Nagpur" can't book Nagpur's loggers first.

## The rest of the flow, automated

The browser test stopped after field work, because driving Chrome step by step cost too much. The rest runs as one
integration test, `tests/integration/real-files-end-to-end.test.ts`, on QA Tech's real files: the TL-02, TL-30, TL-38 and
TL-65 certificates, and the PDL-12 and PDL-14 workbooks. It covers:

1. the masters with their NABL scans;
2. the PDL-12 and PDL-14 import (masters linked, no stray cells as loggers);
3. a freezer (empty and loaded cycles) and a warehouse (°C and %RH) on one job;
4. booking that takes TL-65 for °C and TL-38 for %RH;
5. loggers placed by serial or by ID typed in lower case;
6. cycle times, with an overlapping start refused;
7. the Testo export uploaded, and **every logger's min, max and average checked against the file: all exact**;
8. post-cal, with the expired TL-02 refused and one failure opening a deviation;
9. excursions reviewed, the deviation assessed and decided by the client QA head in the app (a wrong password signs nothing),
   then a CAPA done and verified;
10. both analyses approved;
11. reports frozen with the imported certificates redrawn in the annexure (no scan needed), one returned, answered and signed again;
12. both reports checked and released; the freezer signed by the client in the app, the warehouse on paper;
13. the WCR accepted, the invoice recorded, two part payments (the second with ₹2,400 TDS), the job closed;
14. search, the archive (2 signed studies) and the preparer's bell.

13 steps pass, and the whole suite passes: 216 integration tests, plus `npm run check`.

Found by it: the preparer's bell says when the client signs in the app, but not when a report is signed on paper. **Open.**
