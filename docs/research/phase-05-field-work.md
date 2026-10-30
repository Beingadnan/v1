# Phase 5 research: field work

Researched before building Phase 5 (30 Oct 2026). Sources:

- QA Tech's issued BE-WF-02 report (fixtures, scanned): page 3 _Details of Data Logger
  Used_, page 4 _Diagram Indicating Sensors Positions_, page 6 annexure _Sensor location →
  serial_;
- the plan document's flow;
- the guidance and browser facts below.

## What QA Tech's own report shows

- **The diagram** is a 3-D box with its inside sizes (L 3360 × W 6400 × H 2400 mm), the
  door, and labels L-01…L-09 placed on walls and in the centre. Hot and cold points are
  coloured after analysis (phase 7).
- **The logger table** lists each logger's serial, range, accuracy, calibration date and
  next due date.
- **The annexure** pairs each position with a logger serial.
- **Today this is all typed by hand** after the visit, from notes. The serials in the
  annexure are the ones engineers wrote down on site.

## What the guidance and practice say

| Finding                                                                                                                                                                                                                                                   | Source                                                                                                                                                                                                                                                                                    | What QTech does                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Place sensors in all corners and the centre, then add risk-based points near doors, vents and previous hot/cold spots. Add a mid level in rooms over about 3 m. Record each position, its height and its reason on a diagram and in a table, with photos. | [Eupry: data logger placement](https://eupry.com/temperature-mapping/data-logger-placement/), [WHO TRS 961 Suppl. 8](https://www.technet-21.org/en/resources/guidance/trs-961-annex-9-supplement-8-temperature-mapping-of-storage-areas)                                                  | **Layout from a template:** corners at each level plus the centre, or the WHO grid for rooms. Every point has a label (L-01…), a place in the box, a height and a short note. Photos are attached to the study, optionally to a point. |
| Empty and loaded studies, a door-open test (how long it stays in range, how fast it recovers) and a power-failure (holdover) test are the usual cycles for cold rooms and freezers, over 24–72 h.                                                         | [Freezer and cold room mapping protocol](https://www.casrai.org/guides/freezer-and-cold-room-temperature-mapping-protocol)                                                                                                                                                                | **Cycles with time markers:** start, end, door opened/closed, power off/on. Phase 7 uses the markers for recovery and holdover times.                                                                                                  |
| The report must show each logger's calibration status and traceability.                                                                                                                                                                                   | same                                                                                                                                                                                                                                                                                      | A logger is assigned to a point only if it is valid through the study's last day. Its certificate is shown on FT-12.                                                                                                                   |
| `BarcodeDetector` is built into Chrome on Android from version 83. Safari (behind a flag) and Firefox don't support it.                                                                                                                                   | [MDN compatibility data](https://chromium.googlesource.com/external/github.com/mdn/browser-compat-data/+/73d346309ee9d8be7e32fda8ff574d4c79dd4c51/api/BarcodeDetector.json), [Chromium intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/j-PLtssE5fo/m/budv_U6fCwAJ) | **Scan with the phone camera** on Android Chrome, with no extra library. Elsewhere, type the ID or serial. A USB or Bluetooth scanner gun works too, since it types and presses Enter.                                                 |

## Features, including automation added from this research

1. **My studies today** (phone first): studies of jobs in Field Work (or Ready) where I'm on
   the team, today's first. Large buttons, one study per card, progress such as "6 of 9
   placed".
2. **Layout builder**:
   - The box size comes from the equipment's dimensions.
   - "Fill from template" places corners plus the centre (9), adds the mid level for 15,
     or uses the WHO grid for rooms, labelled L-01… in order.
   - Points can be dragged on a top-down plan per level and renamed.
   - One point can be marked _ambient_ (outside the equipment).
3. **Place loggers by scanning**:
   - Scan or type the logger ID or serial; it lands on the next empty point, or on the
     point picked.
   - Refused, with the reason: out of calibration for the study dates, retired, on
     another job on these dates, already at another point, or failed pre-cal.
   - A valid, free logger that wasn't booked is booked for the job by itself.
4. **Pre-calibration (FT-01)**, where the study needs it (thermal validation, or a client
   that requires post-cal):
   - The master and each logger are read at a point.
   - The deviation is worked out exactly, and pass/fail uses the logger model's accuracy.
   - A failed logger can't be placed.
5. **Cycles and time markers**:
   - The cycles come from the study (empty, loaded, door open, power failure).
   - A start/end button records the time on the phone.
   - Door and power markers apply to their cycles.
   - A time recorded offline keeps the moment it was tapped.
6. **Photos**: taken with the camera and shrunk on the phone (about 1600 px, JPEG)
   before upload, stored like any file and listed on the study.
7. **Offline-tolerant**:
   - Actions are kept on the phone when the network drops and sent when it is back.
   - Each action carries its own id, so a resend never doubles it.
   - The screen shows "3 waiting to send".
8. **FT-12 sensor location sheet** (PDF):
   - the box drawn with its sizes and the points labelled;
   - a table of point, place, height, logger ID, serial and calibration due;
   - cycle start and end times;
   - signature lines.
9. **Job progress**: the job page and the board show "3 of 5 studies done". The job's
   field status follows the studies.
