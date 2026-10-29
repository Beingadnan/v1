# Phase 4 research: jobs

Researched before building Phase 4 (29 Oct 2026). Sources: the plan document's flow
(confirmed with QA Tech on 28 Oct 2026), the guidance below, and what Phases 2–3 taught
about QA Tech's real data.

## What the guidance and practice say

| Finding                                                                                                                                                         | Source                                                                                                                                                                                             | What QTech does                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A mapping protocol "should be prepared, reviewed and approved before the mapping exercise begins".                                                              | [WHO TRS 961 Annex 9, Supplement 8](https://log.logcluster.org/sites/default/files/2024-08/WHO%20-%20Supplement%2008%20-%20Temperature%20Mapping%20of%20Storage%20Areas%20-%20May%202015.pdf) §2.2 | "Approved protocol" is a blocking readiness item.                                                                                       |
| Each logger needs a valid calibration certificate, and the certificates go into the report.                                                                     | WHO Suppl. 8 §2.1, §2.2.6 step 1                                                                                                                                                                   | Logger validity is **calculated**: certificate dated on or before the study start, due on or after the study end.                       |
| Spaces affected by the seasons need a summer and a winter study; cold and freezer rooms usually don't.                                                          | WHO Suppl. 8 §2.2.4                                                                                                                                                                                | Equipment marked "seasonal mapping" suggests the season for each study.                                                                 |
| Common failures: no written plan, loggers whose calibration lapses, deviations not recorded.                                                                    | [Dickson: 7 common mapping mistakes](https://dicksondata.com/en-my/avoiding-mapping-mistakes)                                                                                                      | The readiness checklist gates Field Work; logger booking refuses loggers that expire before the study ends.                             |
| Work orders: one shared live status; match engineers on availability; push job data to invoicing without re-entry; block closing until required items are done. | [BigChange: work order best practices](https://bigchange.com/blog/work-orders-what-are-they-and-best-practices)                                                                                    | Job board by status; warnings when an engineer or a logger is already on another job on the same dates; the PO and price feed phase 10. |

## What QA Tech's flow requires (plan document, confirmed 28 Oct 2026)

- Job number `QT/J/2026/0142`: one series for all sites, allocated when the job is
  created, never reused. The client's PO number is stored and searchable.
- Each equipment line becomes a **study**, with defaults copied from the equipment (set
  point, limits, loggers, interval, duration, cycles) and its **report number reserved**
  in the client's format (`Watson/Seawoods/05/26/Cold Storage (Walk In Freezer)/BE-WF-02`).
- Readiness items are Ready, Pending or NA: purchase order, approved protocol, site access
  or gate pass, logger set booked, loggers valid until after the study ends, masters valid
  (for pre/post-cal), and the previous report (for a requalification).
- Job status: Created → Ready → Field Work → Data Issue / Data Received → Analysis →
  Report Draft / Rework → Checked → Sent to Client → Client Signed → WCR Signed →
  Invoiced → Paid → Closed. On Hold and Cancelled can be set at any point, with a reason.
- Prices come from a rate card per equipment type and work (autoclave per cycle, freezer
  per 24 h or 72 h, warehouse per logger or per m³). A custom quote can override them.

## Features, including automation added from this research

1. **Wizard**: client → site → equipment, with the items **due for requalification
   pre-ticked**. Then work type, cycles and loggers come from the equipment; team and dates;
   PO and price.
2. **Job from the due list**: the Clients "Requalification due" list starts a job
   pre-filled with the due equipment.
3. **Studies and report numbers** are created with the job. A clash (the same equipment in
   the same month) gets a suffix instead of a duplicate.
4. **Readiness** is calculated where it can be:
   - PO: ready when a PO number is entered.
   - Loggers booked: the booked count against the loggers needed.
   - Logger validity: checked against the study dates.
   - Masters: needed only for thermal validation or a client that requires post-cal.
   - Previous report: applies only to a requalification.
     Only protocol and site access are ticked by people. Ready ↔ Created follows the
     checklist by itself.
5. **Logger booking in one click**:
   - The number needed comes from the studies (plus spares).
   - Loggers are picked from the job's QA Tech site first, one model where possible.
   - Only loggers valid through the planned end and not booked on an overlapping job are
     used.
   - Manual changes are made by pasting IDs or serials.
6. **Clash warnings**: an engineer or logger already on another job on overlapping dates.
7. **Expected value** from the rate card is shown against the PO value, with the
   difference flagged. A custom quote overrides it.
8. **Board** (by status), **list** (filters, search by job number, PO, client, equipment,
   report number) and **job page** (progress, studies, team, readiness, bookings,
   timeline).
9. **Money is visible only to the roles that need it** (admin, manager, team leader,
   accounts). Field engineers see the work, not the price.
