# Phase 5 user testing: on site, as the field engineer and the team leader

Tested on 30 Oct 2026 on the production build:

- the field engineer on a 412 px phone (Pixel 7, touch);
- the team leader and manager on desktop.

The data was a Watson job like the real BE-WF-02 visit:

- a 3.36 × 6.4 × 2.4 m walk-in freezer with 9 loggers;
- a cold room with empty, door-open and power-failure cycles;
- 24 ebro loggers, two of them out of date, and an SSPRT master.

Everything below was fixed and has a test unless marked **open**.

## Field engineer, on the phone

| Found                                                                                                                             | Fix                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **A study could be started and ended with 1 of its 9 positions filled.** The report would have had eight positions without data.  | Start is refused while any position is empty, naming them ("3 positions have no logger (L-02, L-03, L-04)"), and the button explains why. |
| **Ending a 24 h study 0 minutes after starting it was accepted silently.** The End button is large and easy to hit.               | Ending well before the planned duration asks first: "has run 5 min of the planned 24 h", then "End anyway".                               |
| A logger that failed pre-cal, scanned when every position was full, was reported as "all positions have a logger".                | The logger's own problem is reported first.                                                                                               |
| After "Save layout", the page jumped to the Loggers step and the "Saved" message vanished.                                        | It stays on Layout with "Saved 9 positions", and a link "Next: place the loggers".                                                        |
| Signed out mid-study, a scan said "No connection".                                                                                | It says "You were signed out… it is kept on this phone", and is sent after signing in.                                                    |
| `crypto.randomUUID` exists only on https or localhost, so a phone opening the office server at http://192.168… would have broken. | A fallback id generator that works everywhere.                                                                                            |
| Editing a position's label would have lost the cursor after each letter.                                                          | Positions are tracked by an internal id, not by their label.                                                                              |
| The camera loop restarted after every scan.                                                                                       | It keeps running, and reads the same label only once every 4 s.                                                                           |

These were checked and already worked:

- **Scanning:** a scanner gun (serial plus Enter) and typed lowercase IDs both work; the
  serial 62281250 was found as E-TRH0001.
- **Refusals:** a logger already placed, one valid only until 15.10.2026 for a study
  running to 01.11.2026, and a typo, each with a clear reason.
- **Placement:** tapping a position puts the next logger there. "Booked, not placed"
  chips place with one tap. The box locks when every position is done.
- **Offline:** "Start study" tapped with no connection was kept as _Started at 09:21_,
  then sent with that time once back online.
- **Door-open cycle:** End isn't offered while the door is open, and "Door closed" is
  refused before "Door opened". A time struck out needs a reason and stays in the record.
- **Photos:** a 4000 × 3000 photo was stored at 1600 × 1200.
- **Layout:** the plan drags on touch and mouse.
- **Phone layout:** no page scrolls sideways at 412 px.
- **FT-12:** one A4 page for 9 loggers.

## Team leader and manager

- The layout can be prepared in the office while the job is still Created. Loggers and
  times wait until the job is Ready.
- The job page shows each study's status, with links to _Field work_ and _FT-12_. The
  heading shows "3 of 5 done", and the board cards do too.
- The manager isn't on the team, so "My studies" is empty; "Everyone's" lists all studies
  on site.
- Two people scanning the same logger at the same moment: bookings are taken one at a
  time, so one succeeds and the other is told where it is.

## Automation added in this phase

- **The layout from a template:** corners and the centre (as on the BE-WF-02 diagram),
  wall centres for 15, or the WHO grid from the room size.
- **Scan and go:** each scan lands on the next empty position, and a valid, free,
  unbooked logger is booked for the job by itself.
- **The first start moves the job from Ready to Field Work.**
- **Studies become Running and Done** from their times; the job counts them.
- **FT-12 is drawn from what was done on site**, so nothing is typed after the visit.

## On Neon, from India (30 Oct 2026, afternoon)

The same work was then done on the production database (Neon, us-east-2) from
the office Mac, in Chrome at phone width. The data was real:

- QA Tech's own TRH-3601 to TRH-3620 FT-05 workbook was imported (18 new loggers;
  2 matched existing IDs by serial);
- Watson's BE-WF-02, which had no size recorded;
- the 182 expired Baddi loggers.

| Found                                                                                                                                                                                                                                                               | Fix                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scans fired back to back merged into one.** Each placement takes 5–6 s on Neon. A second scan arrived while the first was being sent: Enter did nothing, and the third scan was typed on the end of it (`84028227TRH-9999`). A scanner gun would do this all day. | Scans are taken at once, cleared from the box and sent one by one ("Placing… (3)"). Every answer in a burst stays on screen, so a refusal isn't hidden by the next success. The e2e test slows the network to 1.5 s and fires three scans, one of them junk. |
| **BE-WF-02 had no size, and the engineer couldn't add one.** The FT-12 would have had no dimensions, and the WHO grid couldn't be used.                                                                                                                             | The Layout tab asks for the size when it's missing: one box, "3.36 x 6.4 x 2.4 m", also in mm or cm. It's saved on the equipment and audited. A size that's on record can be corrected with "Wrong size?".                                                   |
| A study was started on 30 Oct for a job planned for 06–09 Nov, with no warning. The FT-12 then shows planned dates that don't match the times.                                                                                                                      | The Times tab warns when today is outside the job's dates, and says to move them first, which rechecks the loggers.                                                                                                                                          |
| The audit trail said "Started at 2026-10-30T09:53:42.258Z" and "in_progress → completed".                                                                                                                                                                           | Indian time ("30 Oct 2026, 15:23") and words ("Running → Done").                                                                                                                                                                                             |
| Refusals repeated the code: "TRH-9999: TRH-9999 is not in the register".                                                                                                                                                                                            | The scan is named only when the answer doesn't already name it (a serial or a typo).                                                                                                                                                                         |
| The pre-cal master check used the UTC date, which is a day behind between midnight and 05:30 in India.                                                                                                                                                              | It uses today in India.                                                                                                                                                                                                                                      |
| The job page said "10 of 9 loggers booked".                                                                                                                                                                                                                         | "10 loggers booked for 9 (1 spare)".                                                                                                                                                                                                                         |
| The import preview said the 2 matched loggers' records "were added" before Import was pressed.                                                                                                                                                                      | "go to T-TRH0124; the registered ID is kept".                                                                                                                                                                                                                |

These worked:

- **Placing loggers:** lowercase IDs with spaces were accepted. So were serials, including
  T-TRH0124 by its serial (the workbook calls it TRH-3611).
- **Refusals:** the expired T-TRH0100 was refused with "valid only until 28.07.2026 (the
  study runs to 09.11.2026)", and a logger already placed was told where it is.
- **Two tabs, one logger:** two tabs scanned TRH-3605 at once. One placed it; the other
  was told "already at L-05".
- **The first start moved the job from Ready to Field Work.** Ending 1 minute into a 24 h
  study asked first.
- **Photos:** a 4000 × 3000 photo was stored at 1600 × 1200 (36 KB).
- **FT-12:** one page, with the size, 9 positions, serials, due dates and times.
- **The audit trail** has every step.

**Speed (open):** every action took 5–15 s, because the database is in the US (us-east-2)
and each action makes several round trips. Moving the Neon project to Singapore
(ap-southeast-1) is the simplest fix. The queue above means a slow connection no longer
loses scans, but the engineer still waits.

## Open, for later phases

- **Photos taken with no connection** are not queued; the engineer retakes or re-picks
  them from the gallery. Queueing photos needs storage on the phone (IndexedDB).
- **Printing QR labels** for loggers, so phones read a QR code instead of the
  manufacturer's barcode, which may not hold the QA Tech ID.
- **Witness signature** on FT-12 by the client's person in the app (phase 9, with
  sign-off).
- **Post-calibration (FT-02)** after the study: phase 7, with its failure flow.
- Test on a real Android phone in a cold room: camera focus at −20 °C, gloves, and the
  scanner gun model QA Tech uses.
