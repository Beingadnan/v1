# Phase 2 research — clients and equipment

Done 29 Oct 2026, before finishing phase 2. Goal: everything QA Tech and its clients
need from the client and equipment records, with as little typing as possible.

## What the guidance says

**WHO TRS 961 Annex 9, Supplement 8 — Temperature mapping of storage areas (2015)**
([PDF](https://log.logcluster.org/sites/default/files/2024-08/WHO%20-%20Supplement%2008%20-%20Temperature%20Mapping%20of%20Storage%20Areas%20-%20May%202015.pdf))

- Duration: ambient warehouses and stores at least 7 consecutive days (5 working days
  and a weekend); cold rooms and freezer rooms 24–72 h.
- Sampling: 1–15 min, the same interval and start time on every logger.
- Placement: a grid every 5–10 m along length and width (20–30 m in very large
  facilities); 3 levels up to a 3.6 m ceiling, more above (6 m store: 0.3, 1.8, 3.6, 5.4 m).
- Seasons: areas affected by outside weather need a study in the hottest and the coldest
  season; usually not needed for cold rooms and freezer rooms.
- Remapping: periodically (e.g. every 3 years) and after significant changes (set point,
  refrigeration, layout, usage); new areas before handover.
- Record about the area: dimensions, racking/shelving drawing, HVAC outlets, existing
  sensors, thermostat set points, doors and how often they open.

**Industry practice** ([Kaye](https://www.kayeinstruments.com/en/news/blog-post/guidelines-for-selecting-sensor-quantity-and-optimal-placement-in-area-temperature-mapping),
[Vaisala](https://www.vaisala.com/en/blog/2023-07/temperature-mapping-study-design-duration-intervals))

- Chambers 9–15 loggers (9 = eight corners + centre for small units); cold rooms 15–30;
  warehouses roughly one per 25–50 m².
- Chambers 24–72 h; walk-ins ~3 days; warehouses 1–2 weeks.
- Requalification anywhere from 6 months to 5 years by risk; annual is common in India.

**GSTIN** ([structure](https://gstzen.in/general-faqs/format-of-a-gst-number-gstin.html))

- 2-digit state code + PAN + entity number + 'Z' + a check character. The check character
  is computed mod 36 over the first 14 characters; verified on QA Tech's own GSTIN.

## What we added because of it

| Need                                                                  | Feature                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| People retype the same limits, logger counts and durations            | Per-type **equipment defaults** (Settings, editable to match SOPs) fill empty fields when a type is chosen, and fill blank cells in imports |
| Logger count depends on size                                          | **Logger suggestion** from L × W × H (9 / 15 / WHO grid) with a one-click "Use"                                                             |
| Freezer studies include door-open and power-failure (client decision) | **Study cycles** stored per equipment, defaulted by type, carried into jobs (phase 4)                                                       |
| Warehouses need summer and winter studies                             | **Summer and winter mapping** flag per equipment, on by default for warehouses                                                              |
| Many identical units (20 freezers)                                    | **Add similar**: copy an item except ID, serial and history                                                                                 |
| QA Tech wants to plan visits and quote early                          | **Requalification due** list (30/60/90/180 days, overdue first, grouped by client) with Excel download                                      |
| Clients ask for their equipment list; bulk corrections                | **Register export** in the import layout: edit in Excel and import back (round trip tested: no changes)                                     |
| GST numbers get mistyped                                              | **GSTIN check** (state code + check character) with live feedback; the site's state is filled from it                                       |
| "Watson Pharma Pvt Ltd" added twice                                   | **Look-alike client warning** ignoring case, punctuation and legal suffixes                                                                 |
| Who changed this equipment, and why?                                  | **History** on the equipment page from the audit trail                                                                                      |

## Left for later phases

- Room drawing (racking, HVAC outlets, doors, existing sensors): the sensor layout
  builder (phase 5).
- Seasonal due dates (summer and winter separately) and reminder emails to clients:
  once studies run in the app (phases 4 and 11).
- Remapping triggers after changes (set point, layout): change requests from the client
  portal (phase 13).
