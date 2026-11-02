# Phase 11 user testing: dashboard, alerts and archive

Tested on 2 Nov 2026.

**Data**

- **QA Tech's BE-WF-02 export**, in the integration test `dashboard.test.ts`
  (10 tests, two organisations). The report goes from Done By to the client's
  approval, with alerts at each step; then the digest, the manager's tiles, search,
  the archive, and a CAPA on a deviation.
- **The browser test** `report.spec.ts`, after the job closes:
  - the manager's home shows the Monday review tiles and the board;
  - Ctrl+K finds FE-WF-05;
  - the team leader's bell has "FE-WF-05 Rev 00 signed by…".

**Roles:** manager, team leader, report preparer, accounts, client QA (email off),
client QA head (email on).

## The exit test: the Monday review from the dashboard

The manager's home has a tile for each question of the review, each with a count and a
link:

- **Reports:** to check, checked to release, unsigned by clients over 7 days;
- **Data:** overdue (field work ended over 2 days ago);
- **Money:** invoice due, invoices overdue (with the amounts);
- **Instruments:** expiring in 30 days (and expired, and masters);
- **Deviations:** open (waiting for the client, or to assess), CAPAs overdue;
- **Clients:** requalifications due in 60 days (and already past due);
- **The board:** jobs by stage.

Each figure comes from the records, so no Excel is needed.

## What the tests checked

| Check                                 | Result                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A report sent for checking            | The team leader's bell, no email (it waits for the digest).                                                                                                                          |
| A report returned to the preparer     | The bell, plus an email at once. Without a provider it is marked "not emailed: email isn't set up".                                                                                  |
| A report released to the client       | The QA head (email on) gets one email with the link. Running the sender again sends nothing. The QA (email off) gets the bell only.                                                  |
| The client signs                      | The team leader hears.                                                                                                                                                               |
| The daily digest                      | One email per person with unread items, listing them. Nobody gets one twice in a day; email off means no digest.                                                                     |
| An assessment written for a deviation | The client's QA head hears (once, not on later edits).                                                                                                                               |
| A CAPA                                | Raised by the manager (the owner is emailed), and its due date moved with a reason ("no" refused). Done by the owner. The owner's own verification is refused; the manager verifies. |
| Search                                | "BE-WF-02" finds the report and the equipment; a logger serial finds the instrument. One letter or "%%" finds nothing.                                                               |
| The archive                           | The signed study is under Watson → Seawoods → this year.                                                                                                                             |
| Tiles by role                         | The preparer sees "Reports to draft or answer", not the money or requalification tiles.                                                                                              |

## Open

- **Email provider:** set `RESEND_API_KEY` and `MAIL_FROM` (a domain verified at
  resend.com). Until then the bell is the only alert.
- **The digest's schedule:** set `CRON_SECRET` and have the host call
  `POST /api/cron/digest` daily (around 08:00 IST). This is part of phase 12's
  production setup.
