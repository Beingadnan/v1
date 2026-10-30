# Phase 4 user testing: as QA Tech's team leader, manager, lab, field engineer and accounts

Tested on 29–30 Oct 2026, on the production build, in a browser on desktop and on a
390 px phone.

**Data used:**

- Watson's Seawoods site from the BE-WF-02 report: two walk-in freezers, a deep
  freezer, and warehouse WH013 "Dispensing-2" (12 × 8 × 4 m with RH limits).
- Cipla's autoclave.
- 70 loggers imported from QA Tech's real FT-05 workbooks (TRH-3601…3620 and
  TRH-001…040).

Everything below was fixed and has a test unless it is marked **open**.

## Team leader: planning a job

| Found                                                                                                                                                                                                                   | Fix                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Booking loggers for the warehouse (54 needed) failed** with "Too big: expected string to have <=500 characters". The audit line listed every logger ID. A 200-item job would have failed at creation in the same way. | Audit lines list the first 8 IDs and a count. The full list is in the audit snapshot. The audit log now shortens an over-long line instead of refusing the save. Tested with a 60-logger kit.                   |
| The same limit was hit by recording an outside-lab certificate for many loggers, and by starting a 40-logger calibration batch (both from phase 3).                                                                     | Same fix.                                                                                                                                                                                                       |
| Two team leaders booking for overlapping jobs at the same moment could both take the same logger.                                                                                                                       | Bookings are taken one at a time per organisation. A test books two jobs at once and checks that no logger is booked twice.                                                                                     |
| The warehouse came out "not priced": it is mapped with RH, and the manager's rate was entered as plain "Temperature mapping", as people naturally would.                                                                | A mapping rate also prices RH mapping, unless RH has its own line.                                                                                                                                              |
| A client postponing the visit can leave a booked logger out of date.                                                                                                                                                    | Moving the dates rechecks every logger. The job drops back to Created, the row says "is valid only until 30.11.2026", and Start field work disappears until the logger is swapped. This is the phase exit test. |
| Pasting a logger that's on another job just failed.                                                                                                                                                                     | The message names the job: "booked on QT/J/2026/0001". IDs not in the register are listed separately.                                                                                                           |
| A double-click on Create job could make two jobs.                                                                                                                                                                       | Checked: one job is made. The button is disabled while saving.                                                                                                                                                  |
| The end date before the start, or a year typed wrong (a 2-year "visit").                                                                                                                                                | Refused with a message, and everything typed is kept. Plans are limited to 120 days per job.                                                                                                                    |
| "Top up" stretched across the whole page, and the booking message listed all 60 IDs.                                                                                                                                    | The button is its normal size, and the message shows a few IDs and a count. The table lists them all.                                                                                                           |

These were checked and already worked:

- The wizard ticks exactly the overdue and due-soon items.
- Search finds the job by PO, equipment ID, equipment name or part of a report number.
- The second, overlapping job warns that Tarun is on both jobs and skips the 60 loggers
  in use.

## Manager: the rate card

- Prices typed as "Rs. 18,000/-", "₹ 4,500" or "INR 4500.50" are accepted. Words
  ("1.25 lakh") and negative amounts are refused.
- A duplicate line is refused with a message that says to change the existing line
  instead.

## Field engineer, on a phone

- Sees the jobs and the job page, without prices, edit buttons or the rate card.
  `/jobs/new` and `/jobs/rates` go to the "no access" page.
- No page scrolls sideways at 390 px. The board scrolls on its own row.
- With 60 loggers booked, the job page was very long and the table cramped. On phones
  the model and certificate columns are now hidden (ID and validity stay), and the
  report number moves under the equipment.

## Accounts

Sees jobs and the value panel: expected value against the PO, with the difference
flagged. Can't change jobs.

## Lab

A logger's ID and serial both work when pasting, so the team can type what is printed
on the logger.

## Second round: on QA Tech's Neon database, in Chrome (30 Oct 2026)

These tests used the real records: Watson BE-WF-02 and the 184 loggers from the Baddi list.
The test job is QT/J/2026/0001; it was cancelled afterwards, and the test rate was removed.

| Found                                                                                                                                                                                                            | Fix                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Every logger in the register is out of date.** The Baddi certificates ran out in July 2026, so "Book loggers" booked none, which is correct. But the message said "Nothing more to book" next to "Short by 9". | It now says "No logger could be booked", lists what was left out ("184 not calibrated through these dates"), and links to _Plan their calibration_. **Open:** import the 2026–27 certificates (TRH-3601…, TRH-001…, Zydus PDL-18) on Neon. |
| A logger that expired before the study read "is due on 25.07.2026", which sounds like a future date.                                                                                                             | Now "is valid only until 25.07.2026", for past and future dates alike.                                                                                                                                                                     |
| After "Create job", the page stayed on the form for a few seconds with the button active again, inviting a second click and a second job.                                                                        | The button stays locked and says "Opening the job…".                                                                                                                                                                                       |
| A rate added after the job was planned didn't reach the job, which stayed "Not priced".                                                                                                                          | "Price from rate card" on the job prices it again while it is still being planned. Admin, manager and team leader only; audited.                                                                                                           |
| Ticking a readiness item saved its help text as the person's note.                                                                                                                                               | Only what the person wrote is stored.                                                                                                                                                                                                      |
| "15k" for the PO value was refused.                                                                                                                                                                              | Amounts in k, lakh and crore are accepted: "15k", "1.5 lakh", "2.25L", "1 cr". Text like "about 15000" is still refused.                                                                                                                   |
| A job put on hold vanished from the board: its column was off the right edge of the screen.                                                                                                                      | A held job stays in the column where it stopped, with an "On hold" badge.                                                                                                                                                                  |
| A cancelled job still showed "Ready for field work? 4 items pending".                                                                                                                                            | The checklist is hidden on closed and cancelled jobs.                                                                                                                                                                                      |
| Two unpriced studies would read "2 studyies have no rate".                                                                                                                                                       | Fixed.                                                                                                                                                                                                                                     |
| Removing a rate took one click and couldn't be undone.                                                                                                                                                           | It asks "Remove? Yes / No" first.                                                                                                                                                                                                          |

These were checked and already worked:

- The site was picked by itself, and BE-WF-02 was rightly left unticked (not due until
  22.05.2027).
- Its report number matched Watson's format.
- Pasting found T-TRH001 by its serial, matched lowercase IDs, ignored duplicates and
  listed the typo.
- The PO was trimmed.
- Hold needs a reason.
- Search finds the job by part of the PO.
- No browser errors.

## Automation added in this phase

- **Job from the due list:** one button per client site, with that site's due
  equipment already ticked.
- **Studies filled in from the equipment:** loggers come from the channel count, or
  from the room size using the WHO grid. The season is suggested for seasonal spaces,
  and the report number is reserved.
- **Readiness works itself out,** and the job moves between Created and Ready by itself.
- **One-click booking with spares:** loggers from the job's site first, one model
  where possible, in consecutive IDs.
- **Expected value against the PO,** with the difference shown.

## Open, for later phases

- Masters booked for pre/post-cal are checked against the study dates. Post-cal happens
  after the study, so phase 5 should check the post-cal date itself.
- Print a packing list or QR labels for the booked kit (phase 5).
- Notify the team when a job is created, or when a booked logger runs out (phase 12).
- Which ID is current for loggers relabelled between files (open since phase 3).
