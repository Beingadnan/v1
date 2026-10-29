# Phase 3 user testing: as QA Tech's lab, checker and manager

Tested 29 Oct 2026, on the production build and on Neon. I worked as each role on a
normal day, using QA Tech's real files as they are, with the wrong and messy input
real people produce. Everything below was fixed and has a test unless marked
**open**.

## Real files

All 9 instrument files in `fwtraceability_/CALIBRATION CERTIFICATE 2026-2027` were run
through the import. Before this round only 2 imported.

| File                                             | Before                             | Now                                             |
| ------------------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| All site portable datalogger list (Baddi)        | imported                           | imported; a relabelled logger keeps its history |
| Nagpur site datalogger list                      | imported                           | imported                                        |
| TRH-001 To TRH-040 (Sri Lanka FT-05 workbook)    | **crashed** ("Invalid time value") | 2 certificates, 50 loggers, 300 readings        |
| TRH-3601 to TRH-3620 (FT-05 workbook)            | nothing found                      | 1 certificate, 20 loggers, 120 readings         |
| Zydus Ambernath 24.08.2026 (FT-05 over 2 sheets) | nothing found                      | PDL-18 joined: 25 loggers, 150 readings         |
| TC-001 thermocouples (FT-05)                     | nothing found                      | 30 thermocouples, 180 readings                  |
| SRI LANKA DATA LIST (no headings)                | nothing found                      | 50 serials, given IDs from a prefix             |
| Data logger details (serials only)               | nothing found                      | serials given IDs from a prefix                 |
| new data logger serial ("Id No" = model)         | IDs read wrongly                   | column read as the model; serials given IDs     |

### What the files taught

- **A date formula Excel never calculated** (`='20 DATA LOGGER 1'!E3`) crashed the reader.
  The reader now follows such references the way Excel would.
- **QA Tech's Excel deviations carry float noise** (−0.09499999999999886). Imported
  deviations are recalculated exactly (−0.095).
- **One certificate can span several sheets**, for example PDL-18 with 20 + 5 loggers, or
  PDL-17 with its °C points on one sheet and its %RH points on another. These are joined.
- **The same logger has two IDs in different files.** Serial 84028451 is TRH-3611 in the
  July 2026 certificate but T-TRH0124 in the Baddi list, and the same holds for 84028482.
  The history is kept under the registered ID, and the preview names the other ID.
  **Open:** QA Tech to decide which ID is current.
- **Imported numbers would have been issued again.** Once QATECH/BHIWANDI/09/26/PDL-01
  is imported, a back-dated calibration in September 2026 would have been given PDL-01.
  Two fixes: the import moves each series past the numbers it brings in, and a new
  certificate skips any number already used.

## Lab technician: entering readings

| Found                                                                                           | Fix                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signed out mid-entry (30 min idle): pressing Save wiped the page and every reading typed.**   | Actions answer "You were signed out… nothing you typed is lost". Every change is also kept in the browser and offered back ("Restore them"). Autosave runs 30 s after the last change. |
| Pasted values with units (`-20.2 °C`, `−20,3 °C`) were refused.                                 | Units and comma decimals are accepted.                                                                                                                                                 |
| Copying the header row of serials with the readings put serial numbers in the grid as readings. | A header row places each column under its logger, in any order. A reading more than 50 away from the master is refused, with the cell named.                                           |
| Pasting into the master column filled only that cell.                                           | The master reading is filled, then the loggers.                                                                                                                                        |
| Values that didn't fit were dropped silently.                                                   | The screen says how many were left out.                                                                                                                                                |
| A calibration dated in the future was accepted (and used up a number).                          | Refused.                                                                                                                                                                               |
| A due date before the calibration date caused a server error with no message.                   | Refused with a message.                                                                                                                                                                |
| %RH points could be signed with only a temperature master.                                      | Signing needs a master for each quantity measured.                                                                                                                                     |

## Manager: masters and outside-lab certificates

These were checked and already worked: an expired master is refused with the certificate
and date named, a ULR in the wrong format and a due date before calibration are caught,
a duplicate certificate number is caught, and a spreadsheet uploaded as the "PDF" is
refused.

## Field engineer

Starting a calibration or opening the import goes to the "no access" page. That page
now has a main heading for screen readers. The register can be viewed but not changed.

## Phone

The register and the readings sheet fit a 390 px screen, with no sideways page scroll.

## Automation added

- **Plan the calibration:** due and expired loggers are grouped by model, most urgent
  first. "Start a batch of 20" opens the new calibration already filled in.
- **Register as Excel:** the register exports with the headings of QA Tech's own lists, so
  it can be imported back.
- **Fast "Add a batch":** one insert and one audit entry for any number of serials.
- **FT-05 workbook import:** the certificate history comes in with readings, so the register
  is current from day one.

## Open, for later phases

- Decide which ID is current for loggers relabelled between files (see above).
- Enter a master certificate's results and uncertainty table (phase 8 annexures).
- Print a QR or barcode label per logger, to scan when placing loggers in the field
  (phase 5).
- Email an issued certificate to the client from the app (phase 9, with report release).
