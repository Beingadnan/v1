# Client feedback after the demo (4 Nov 2026): research and fix plan

QA Tech saw the app on 4 Nov 2026 and asked for 17 changes. This note checks each one against QA Tech's own files
(`fwtraceability_`), the code and the guidance, then groups them into four fix phases to finish before phase 12
(migration and go-live).

## What the files show

- **Areas are already mapped as "equipment".** Glenmark's dispensing area is "Equipment ID WH013" in QA Tech's raw
  data sheet (`Dispensing-2 WH013.xlsx`): 5 Testo loggers plus an ambient one, °C and %RH every 10 minutes, acceptance
  "NMT 25 °C & NMT 40 %RH". QTech has a "Warehouse / store" equipment type, but nothing in the flow says "area".
- **Autoclaves use RTD or thermocouple sensors on a Yokogawa logger, not portable loggers.** The pre- and
  post-calibration certificates (FT-08, e.g. `QATECH/BHIWANDI/03/26/RTD-04` for HiMedia's horizontal autoclave
  PMK-AU-05) check 10–30 sensors against one master at three points (90, 121, 130 °C), and each gets its own
  certificate number in the RTD or TC series.
- **Portable loggers get pre/post-calibration only when the client asks** (Gennova's cold rooms and incubators, PDL
  series); most mapping jobs don't have it.
- **No PO, ARC, AMC, SRF or gate-pass documents are in the folder.** Those points rest on the client's words and
  common practice; QA Tech's answers are noted in the table.

## Point by point

| #   | Asked                                                   | Finding                                                                                                                                                                                                                                                                                               | Change                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Remove the rate card from jobs                          | Prices come from the PO or contract, not a list.                                                                                                                                                                                                                                                      | Hide the rate card link, the price source and "custom quote". Keep the table (no data deleted). Job value = PO / contract value.                                                                                                                                                                                    |
| 2   | Commercial basis: PO, ARC, AMC or SRF                   | ARC (annual rate contract): fixed rates for a period, jobs ordered against it. AMC (annual maintenance contract): a yearly fee for a set of services. SRF (service request form): the client's own request form; QA Tech records its number and file (the request record ISO/IEC 17025 §7.1 expects). | A "Basis" dropdown on the job. PO and SRF: number, date, file on the job. ARC and AMC: a contract on the client (number, valid from/to, value, file, for AMC the equipment covered); the job picks the active one; reminders before it expires.                                                                     |
| 3   | Job number QT/month/year/0001                           | The format setting can show the month, but today {MM} also restarts the count every month.                                                                                                                                                                                                            | Set the format to `QT/{MM}/{YYYY}/{SEQ:4}`. Existing jobs keep their numbers. **Answered:** the count runs through the year (QT/11/2026/0041, then QT/12/2026/0042). Small change: the month shows but no longer restarts the count.                                                                                |
| 4   | PO or invoice pending: upload later and be reminded     | A job can already start without a PO number.                                                                                                                                                                                                                                                          | "PO pending" badge; upload the PO (number + file) any time; a reminder to the manager and accounts every few days until it comes; invoicing warns while it is missing. An invoice still not raised after the WCR is signed also reminds.                                                                            |
| 5   | Booking picks 10 loggers at random; QA Tech must choose | True: "Book loggers" chooses for them.                                                                                                                                                                                                                                                                | Remove the automatic pick. Type or scan an ID or serial: the list shows only loggers that are free on those dates and calibrated through the study, with the count ("990 of 1,000 free: 10 on QT/11/2026/0003"). Ranges (T-TRH001–T-TRH024) still work.                                                             |
| 6   | Equipment mapping and area mapping                      | WHO TRS 961 Suppl. 8 covers storage areas: loggers on a grid every 5–10 m, at three heights (e.g. 0.3, 1.2, 3.0 m), two seasons where the season matters.                                                                                                                                             | A choice when adding to a job: Equipment or Area. Areas get room size, heights, season; QTech suggests the logger count and lays out the grid; reports say "area".                                                                                                                                                  |
| 7   | Remove "Long enough on site"                            | Client's call.                                                                                                                                                                                                                                                                                        | Remove it from readiness; keep a quiet warning under the dates when they are too short.                                                                                                                                                                                                                             |
| 8   | Remove "Approved protocol"                              | WHO expects an approved protocol, but QA Tech handles it outside the app.                                                                                                                                                                                                                             | Remove it from readiness.                                                                                                                                                                                                                                                                                           |
| 9   | Gate pass, then book loggers                            | It is the client's entry gate pass: their security lists the instruments QA Tech brings in.                                                                                                                                                                                                           | "Site access / gate pass" asks for the gate pass number (and an optional scan), then opens the booking for that gate pass; QTech prints the list of loggers and masters with serials for the client's security. **Answered:** the client's entry pass.                                                              |
| 10  | "Previous report on hand": automatic or remove          | Re-mapping compares with the last study; WHO lists changes and periodic re-mapping as triggers.                                                                                                                                                                                                       | Make it automatic: found in QTech → ready, with a link; never mapped → N/A. If it was mapped before QTech, upload the old report once on the equipment. Bonus: "Copy positions from the last study" on Layout.                                                                                                      |
| 11  | Choose the model (Testo, Ebro…) before booking          | Lists mix makes; one study should use one model.                                                                                                                                                                                                                                                      | Booking starts with the model; the free count and the search are for that model.                                                                                                                                                                                                                                    |
| 12  | Pre/post-calibration optional (yes/no) per study        | Only some clients ask for it (see above).                                                                                                                                                                                                                                                             | Two switches on each study at job creation; the Pre-cal and Post-cal tabs only appear when on.                                                                                                                                                                                                                      |
| 13  | 3D diagram of the layout                                | QTech already stores each position's x, y, z and the equipment's size.                                                                                                                                                                                                                                | An interactive 3D view on Layout (rotate, click a logger) and a fixed isometric drawing plus top and front views for the PDF report.                                                                                                                                                                                |
| 14  | Remove Loggers from the study (booked in the job)       | The report still needs which logger sat at which position (annexure, page 6).                                                                                                                                                                                                                         | Remove the Loggers tab; pick or scan the logger beside each position on Layout, from the job's booked loggers only.                                                                                                                                                                                                 |
| 15  | Remove Photos                                           | WHO relies on drawings, not photos.                                                                                                                                                                                                                                                                   | Remove the Photos tab; photos already taken stay in the records.                                                                                                                                                                                                                                                    |
| 16  | Autoclave: pre- and post-cal                            | Thermal validation calibrates the sensors before and checks them after (two points bracketing 121 °C plus one between).                                                                                                                                                                               | Always on for autoclaves and ovens (switch locked, with the reason). Three points per sensor, as on FT-08.                                                                                                                                                                                                          |
| 17  | Adjust pass and fail                                    | Changing a result after the data is in is "testing into compliance" (FDA OOS guidance); limits must be set before.                                                                                                                                                                                    | **Answered:** override the outcome. Built so an auditor accepts it: the computed result is never changed; an override records the new verdict, a written reason and a second person's sign-off, and the report shows both ("Fail, accepted by QA decision QT/DEV/2026/0004"). Every override is in the audit trail. |

## Fix phases (before phase 12)

**Fix 1: remove and simplify (about 3 days).** Points 1, 3, 7, 8, 10, 12, 14, 15, 16.
Removals and switches, few new screens, no data lost. Layout takes over logger placement.

**Fix 2: commercial basis and reminders (about 4 days).** Points 2 and 4.
Basis dropdown, contracts (ARC, AMC) on the client, PO/SRF upload later, pending reminders.

**Fix 3: booking by hand, by model, through the gate pass (about 4 days).** Points 5, 9, 11 (and 17 once answered).
Model first, type-ahead of free and valid loggers with counts, gate pass number then booking, printable gate-pass
list, automatic pick removed.

**Fix 4: area mapping and the 3D layout (about 1.5 weeks).** Points 6 and 13.
Equipment or area, grid suggestion from the room size, 3D view in the app, isometric drawing in the report.

Then **phase 12, migration and go-live**, including the move of the database to Neon's Singapore region.

Each fix phase ends as the others did: tests, `npm run check`, the integration tests, a run through as each role, and
findings in this file.

## Sources

- [WHO TRS 961 Annex 9, Supplement 8: Temperature mapping of storage areas](https://log.logcluster.org/sites/default/files/2024-08/WHO%20-%20Supplement%2008%20-%20Temperature%20Mapping%20of%20Storage%20Areas%20-%20May%202015.pdf)
- [Thermal sterilization validation (sensor calibration before and after)](https://www.controleng.com/thermal-sterilization-validation)
- [ANAB: contract review under ISO/IEC 17025](https://blog.ansi.org/anab/importance-contract-review-iso-iec-17025/)
- [Annual rate contract example (CSIR-CFTRI)](https://cftri.res.in/tenderfiles/ARC-NSMEDICINE-08012021.pdf)
- [FDA warning letter on testing into compliance](https://gmp-compliance.org/gmp-news/testing-into-compliance-fda-warning-letter-due-to-non-compliant-gmp-invalidation-of-oos-results-and-falsification-of-data)
- QA Tech's files: `Dispensing-2 WH013.xlsx`, FT-08 pre/post-calibration certificates (RTD-04, TC-01), Gennova PDL
  pre/post-calibration certificates.

## Fix 1 done (5 Nov 2026)

- **Rate card (1):** page, link, pricing at job creation, reprice button and custom-quote field removed. The job
  shows its PO value or "Pending". The `rate_cards` table and old study prices are kept.
- **Job number (3):** `QT/{MM}/{YYYY}/{SEQ:4}`, one counter per year. Migration 0020 moves organisations still on the
  old default. Existing jobs keep their numbers; the next Neon job continues the 2026 count.
- **Readiness (7, 8):** protocol and days on site no longer listed; a too-short visit shows as a warning under the
  job's dates. Stored rows for the two items stay.
- **Previous report (10):** worked out. N/A for a first study; ready with the report number when it was signed in
  QTech; a tick only for equipment mapped before QTech. Layout offers "Copy positions from the last study".
- **Pre/post-cal (12, 16):** a switch for each, per study, beside each ticked item when creating the job and in the
  study's edit dialog; defaults from the client's SOP; always on for thermal validation. Migration 0021 adds
  `studies.pre_cal_required` and keeps the old behaviour for existing studies. Several readings per sensor were
  already allowed, so FT-08's three points (90, 121, 130 °C) can be entered.
- **Loggers and Photos tabs (14, 15):** removed. The logger for each position is scanned or picked under the layout.
  Photos already taken stay viewable.
- Checked: `npm run check` (215 unit tests) and 220 integration tests pass. New tests cover the year counter, the
  readiness list, the previous report found in QTech, the pre/post-cal switches and the copied layout.

## Fix 2 done (10 Nov 2026)

- **Order type (2):** each job has "Client's order": PO, SRF, ARC or AMC. A PO or SRF carries its number, date, value and
  copy. An ARC or AMC is kept once on the client's page (number, validity, value, copy, notes) and picked on each job;
  the one covering the job's first day is offered first. Another client's contract, or the wrong kind, is refused.
  Migration 0022 adds `jobs.order_type`, `jobs.order_file_id`, `jobs.contract_id` and `client_contracts`.
- **Pending and reminders (4):** a missing order no longer holds up field work. "Record the order" on the job page
  (managers and accounts) takes it at any stage until the job is closed, audited. The jobs list marks "PO pending" and
  filters by it; home has a "Client's order pending" tile; invoicing says when the order is missing. The daily run
  reminds managers and accounts of an order still missing after 3 days (weekly after), a WCR signed 7 days ago with no
  invoice (weekly), and an ARC/AMC ending within 30 days (once). The reminders run with the daily digest, so they need
  `CRON_SECRET` and the daily call set up at go-live.
- Found on the way: editing a job without money rights cleared its PO value; fixed. A jobs test assumed the date was
  before 9 Nov 2026; it no longer depends on the day.
- Checked: `npm run check` (215 unit tests) and 230 integration tests pass, 10 of them new for orders and reminders.

## Fix 3 done (10 Nov 2026)

- **Gate pass first (9):** "Site access" on readiness is now "Client's gate pass", worked out from the job: the gate
  pass number (and an optional scan), or "not needed at this site". The job page asks for it before the booking, and
  prints a "Gate pass list" PDF of every booked logger and master with serial, model and calibration due date, for the
  client's security to check in and out. Migration 0023 adds `jobs.gate_pass_number`, `gate_pass_file_id` and
  `gate_pass_not_needed`.
- **Booking by model, typed or scanned (5, 11):** pick the model (Testo 174H, ebro EBI 20-TH1, ...), then type or scan
  an ID or serial; only loggers free for the job's dates are offered, and the counts say why the rest aren't (on another
  job, not calibrated through the study, not in use). A list or range can still be pasted. A logger of another model is
  refused. "Book automatically" now books masters only; loggers are never picked at random.
- **Override a result (17):** a pre/post-calibration result can be taken the other way with a reason. A team leader or
  manager other than the one who asked approves it with their password, or rejects it with a note. The reading and its
  own result stay on record; the approved result is the one used for placing loggers, the analysis and the report,
  which marks it "Pass *" with a footnote naming who asked, who approved and why. Migration 0024 adds
  `precal_overrides`; approvers get an `override_to_approve` notification.
- Checked: `npm run check` (215 unit tests) and 238 integration tests pass; 8 new ones for booking and overrides. The
  report footnote is built from the same data the tests check, but the PDF itself was not opened in a test.

## Fix 4 done (10 Nov 2026)

What QA Tech's own area report shows (`Dispensing-2 WH013.xlsx`, Glenmark Indore): an area is mapped differently from a
box. The report says "Room & Mapping Details", "Room Name", "Room ID". The diagram is a floor plan with the room's
fixtures (RLAF, supply duct, wall, pass box near the door), and a table of locations ("Working height on wall-1 near
pass box & near door", "Working height on wall-2", ..., "At security gate" for the ambient). Five loggers plus the
ambient, every 10 minutes for 24 hours, NMT 25 °C and NMT 40 %RH. Sensor-placement guidance agrees: doors and supply or
return air are the risk points to cover, loggers sit where product is handled, and grids with several levels are for
stores with racking (Kaye; WHO TRS 961 Suppl. 8). Mapping tools show the layout in 3D (Eupry's planner renders the room
as a rotatable wireframe with the loggers in it).

- **Equipment or room (6):** the equipment form asks "What is mapped": Equipment, or Room or area. A new type "Room
  (dispensing, sampling, clean room)" joins Warehouse / store as an area (migration 0025). A room gets one logger every
  ~5 m along each wall plus one in the centre (5 for a 6 × 4 m room, as in WH013), laid at 1 m working height on walls 1
  to 4 clockwise from the entrance side. Reports and FT-12 say "Room" for a room and "Area" for a warehouse;
  warehouses keep the WHO grid on several levels and the box drawing.
- **The room's plan:** Layout marks the door, pass box, LAF/RLAF, supply duct, return air, AC unit, window, heat source
  or anything else on the plan, saved with the positions (migration 0026) and offered to the room's next study. FT-12
  and the report draw a room as a floor plan with these marks; the report adds the table of locations.
- **3D view (13):** Layout has a 3D view beside the drawing: drag to turn it, or pick top, front or side; each logger
  has a dotted line to the floor so its height shows. Plain SVG, no 3D library. The PDF report keeps QA Tech's own
  drawing (the box as on BE-WF-02, the floor plan for rooms), as their clients know it.
- Checked: `npm run check` (222 unit tests) and 243 integration tests pass; 9 new unit tests and 6 new integration
  tests for rooms. The room's FT-12 and report pages were rendered and looked at; the 3D view was rendered on its own,
  not yet tried on a phone.

Sources added for Fix 4:
[Kaye: sensor quantity and placement in area mapping](https://kayeinstruments.com/en/news/blog-post/guidelines-for-selecting-sensor-quantity-and-optimal-placement-in-area-temperature-mapping),
[Eupry: 3D data logger placement](https://eupry.com/temperature-mapping/3d-datalogger-placement/).
