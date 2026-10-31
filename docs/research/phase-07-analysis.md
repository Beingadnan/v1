# Phase 7 research: the analysis engine

Phase 7 turns the confirmed logger data into the numbers on the report's summary page:

- the minimum, maximum and average for each position;
- the hot and cold spots;
- MKT and F0;
- door-open recovery and power-failure holdover;
- excursions.

It also adds the post-calibration check after the study (FT-02), and what happens when
a logger fails it.

## What QA Tech's reports do today

- **BE-WF-02 page 5** has, for each position, the minimum, maximum and average
  temperature. Two lines name the extremes: "Average Minimum Temperature at L-04:
  −21.9" and "Average Maximum Temperature at L-05: −16.7". **Hot and cold spots are
  picked by the average**, not by the single highest or lowest reading. (L-08 has the
  highest single reading, −15.0, but L-05 is the hot spot.) Values are shown to one
  decimal.
- **WH013's workbook** has Minimum, Maximum and Average rows under the data, then an
  MKT working: `TEMP IN K = average + 273.1`, `−ΔH/RT`, `e^(−ΔH/RT)`, `−ln`,
  `MKT IN K`.

  From `−ΔH/RT = −33.865` at 295.29 K, the sheet uses **ΔH/R = 10 000 K**. That is
  ΔH = 83.144 kJ/mol, the usual default.

  The sheet works this out on the **average** temperature, so its "MKT" always equals
  the average (22.19 °C for 83561878). The textbook MKT is worked out from each reading
  (USP 〈1079.2〉) and is never below the arithmetic mean. For WH013 the difference is
  under 0.01 °C, because the room barely moves. For a store that swings 15–30 °C each
  day it is about 1.4 °C (23.9 against a mean of 22.5).

  The app computes the per-reading MKT, and **shows the sheet's way next to it** until
  QA Tech decides. It also uses 273.15, not the sheet's 273.1.

## Rules and practice

- **MKT (USP 〈1079.2〉; Vaisala):**
  `T_MKT = (ΔH/R) / −ln( (1/n) Σ e^(−ΔH/(R·Tᵢ)) )`, with Tᵢ in kelvin (°C + 273.15).
  The default ΔH is 83.144 kJ/mol; change it only with product data.
- **F0 (autoclave heat penetration; PDA TR1):**
  `F0 = Σ 10^((T − 121.1)/z) · Δt` over the sterilisation hold, with z = 10 °C,
  Δt in minutes, and the trapezoid between readings. The hold window comes from the
  "Hold started / Hold ended" times recorded on site (phase 6). Tref and z are stored
  with each run.
- **WHO TRS 961 Suppl. 8 §2.4:** compare against the acceptance criteria; identify the
  minimum, maximum, hot and cold spots and the mean; any deviation gets a deviation
  report with CAPA. Ambient loggers are reported but are not judged against the limits.
- **Post-calibration checks** (Vaisala, "Post-calibration checks in mapping
  validations"). Inspectors expect them, so do them.
  - If a logger fails, check whether the protocol allows a failure rate (often up to
    10%). If not, raise a deviation for QA to accept.
  - Look at the direction: a sensor that read low on an autoclave under-reported
    lethality, which is conservative.
  - If that argument fails, repeat the study.
  - The app's "impact recalculation" applies the logger's post-cal error to its
    readings and recomputes the verdict. That shows the decision-maker whether the
    error could change the result.

## What the old repos had

- **qatech-mapping `calculations.ts`:** stats, MKT with ΔH/R = 10 000, F0 by trapezoid,
  pass/fail against limits, and excursion events. Its excursion grouping is per sensor
  and per parameter, which is right.

  It judged a position by its min and max only, and had no hot/cold rule, no
  recovery or holdover, and no record of the constants used. The formulas are reused
  here; the rest is new.

- **qatech-v2** shows excursions with an "Acknowledged → Deviation created → Closed"
  status, and deviations with CAPA. The same idea is kept, simpler.

## Decisions for this phase

1. **One pure engine**, `src/domain/analysis/engine.ts`, has golden tests on QA Tech's
   numbers:
   - BE-WF-02: every min, max and average on page 5; L-05 hot (−16.7); L-04 cold
     (−21.9);
   - WH013: the workbook's own Minimum, Maximum and Average rows.
2. **Per position and per cycle window** (the times recorded on site), plus the whole
   study:
   - minimum, maximum and average;
   - the time of the minimum and the maximum;
   - MKT (per reading, and the sheet's way);
   - RH the same way;
   - pass or fail against the study's limits.

   Ambient positions are shown but are left out of pass/fail and hot/cold.

3. **Hot/cold rule:** the highest and lowest average. In a tie at one decimal, the
   unrounded average decides, then the higher maximum (hot) or lower minimum (cold),
   then the position order.
4. **Excursions:** consecutive readings outside a limit form one event per position and
   limit, with start, end, duration, peak and how far past the limit it went. Each
   event is either accepted with a reason or raised as a deviation.
5. **Door open:** the time from "Door closed" until the last position is back within
   limits, plus the worst reading while the door was open. **Power failure:**
   - holdover: the time from "Power off" until the first position leaves the limits;
   - recovery: the time after "Power restored" until all positions are back within
     limits.
6. **Thermal:** F0 per position over the hold, the minimum F0 (the cold spot for
   lethality), and the temperature range during the hold.
7. **Each run is stored, never changed.** It keeps:
   - the engine version;
   - the constants (ΔH/R, Tref, z, limits, rounding);
   - the data files' SHA-256;
   - the accepted data problems;
   - the windows used;
   - every result.

   Recalculating makes a new run; the report (phase 8) will point at one run. A run
   made while data or decisions changed is marked out of date, not altered.

8. **Post-calibration (FT-02):** entered like pre-cal, required when the study asks for
   it (client setting, or thermal validation).
   - **A failure opens a deviation automatically** (numbered `QT/DEV/2026/0001`), with
     the impact recalculation attached.
   - QA Tech writes its assessment.
   - The client QA head's decision is recorded by name and date: **No impact**,
     **Exclude probe** or **Repeat study**. A scan of a signed paper decision can be
     attached. Their in-app signature comes in phase 9.
   - **While a deviation is open, the analysis can't be approved**, so no report can
     be made from it. "Exclude probe" leaves that position out of the next run, with
     the reason shown.

## Sources

- [USP 〈1079.2〉 Mean Kinetic Temperature in the evaluation of temperature excursions](https://doi.usp.org/USPNF/USPNF_M13855_02_01.html)
- [Vaisala: common questions about MKT, default activation energy](https://www.vaisala.com/en/blog/2020-02/common-questions-mkt-answered-trending-interpreting-reports-default-activation-energy)
- [Vaisala: post-calibration checks in mapping validations](https://vaisala.com/en/comment/21786)
- [WHO TRS 961 Annex 9, Supplement 8: Temperature mapping of storage areas](https://log.logcluster.org/sites/default/files/2024-08/WHO%20-%20Supplement%2008%20-%20Temperature%20Mapping%20of%20Storage%20Areas%20-%20May%202015.pdf)
- [PDA Journal: F0 and moist-heat sterilisation](https://journal.pda.org/content/pdajpst/39/6/251.full.pdf)
- QA Tech: BE-WF-02 report page 5; WH013 workbook (Rawdata summary rows and MKT
  working); qatech-mapping `calculations.ts`; qatech-v2 deviation screens.
