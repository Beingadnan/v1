# ADR 0012: Analysis runs are immutable; deviations gate approval

Status: accepted (Phase 7, October 2026)

## Context

The report's numbers (minimum, maximum and average per position; hot and cold spots;
MKT, F0, recovery times) come from confirmed logger data. An auditor must be able to
see exactly what produced a number, and that it was not changed afterwards.

A logger that fails its post-calibration puts its readings in doubt. The client's QA
head decides what happens, and until then no report may be made.

## Decisions

1. **One pure engine** (`src/domain/analysis/engine.ts`) with a version number
   (`ENGINE_VERSION`). It has golden tests on QA Tech's issued numbers: BE-WF-02 page
   5, and WH013's summary rows. A change that can alter a result for the same input
   bumps the version.

2. **A run is stored and never changed.** `study_analysis_runs` keeps:
   - the engine version;
   - the constants and limits;
   - the windows and markers;
   - the data files' SHA-256;
   - the channel-to-position matches;
   - the accepted data problems;
   - the exclusions and corrections;
   - the full result.

   A trigger refuses updates. Recalculating makes a new run. The input hash tells
   whether the data or decisions have changed since; if so, the run is shown as out of
   date. It is never altered. Pressing Run with nothing changed gives the same run
   back, so concurrent presses make one run.

3. **Rules that follow QA Tech's reports:**
   - hot and cold spots by average, with a written tie rule;
   - one decimal on screen;
   - ambient positions shown but not judged.

   **MKT is worked out per reading** (USP 〈1079.2〉, ΔH/R 10 000 K). The screen says
   that QA Tech's sheet method gives the average.

4. **Post-calibration** reuses the pre-calibration record with `phase = 'post'`. A
   failure opens a deviation in the same transaction. Its impact is a separate run
   (`kind = 'impact'`): the logger's post-cal error is applied to its readings, and
   the run is recalculated on every Run press while the deviation is open.

5. **Deviations** are numbered in their own series (`QT/DEV/YYYY/NNNN`). Each needs:
   - QA Tech's assessment;
   - then the client QA head's decision: No impact, Exclude probe or Repeat study.
     The decision is recorded by name and date, with an optional scan of the signed
     paper.

   The client signs in the app in phase 9. "Exclude probe" changes the next run's
   inputs. "Repeat study" blocks approval until data newer than the decision is
   uploaded.

6. **Approval** is of one run, by the team leader or manager. It needs all of these:
   - the run is current;
   - every excursion is reviewed (accepted with a reason, or raised as a deviation);
   - no deviation is open;
   - post-cal is complete where required.

   A deviation opened later, or a rerun on changed data, withdraws the approval and
   audits it. Phase 8 builds the report from the approved run and checks these again.

## Consequences

- Reports can cite the run number, the engine version and the file hashes.
- An engine fix never changes an old run. Old runs can be recomputed and compared.
- Deviation numbering, assessment and decision are audited like everything else. Client
  sign-off moves into the app in phase 9 without changing the model.
