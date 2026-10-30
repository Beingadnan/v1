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
