# Logger booking before the study, or "data first"?

The question was raised on 3 Nov 2026 while testing jobs: v2 went straight from creating a job to uploading the Excel. Does QTech
need "Book loggers" and placement before the data arrives?

## What the report needs

QA Tech's issued report (BE-WF-02) has three things that the Excel alone can't give:

- **Each logger's serial and calibration status** (page 3).
- **A diagram of the positions** (page 4).
- **An annexure pairing each position with a serial** (page 6).

Today engineers write the serials down on site, and they are typed in after the visit (phase-05 research).

## What others do

- **Vaisala viewLinc mapping:**
  1. Create the locations and link each logger to one before the study.
  2. Set the acceptance criteria before the study ("MUST be set before the study is performed").
  3. Verify calibration before and after.
  4. Download the data from the linked loggers.

  [Vaisala application note B211801EN](https://www.cik-solutions.com/content/files/vim-g-viewlinc-mapping-application-note-b211801en.pdf)

- **Eupry Mapping Kit:** pick the position IDs before placing, record each logger on the placement diagram while placing, and
  never move a logger once the study is active. The data then arrives without an import step.
  [Eupry onboarding guide](https://onboarding.eupry.com/guides/mapping-kit-onboarding-guide)
- **Dickson, common mistakes:** record each logger's calibration certificate and expiry before installing it. Skipping the
  calibration checks leaves no proof that the loggers were accurate, and auditors look for it. Record changes during the study
  as they happen. [Dickson: avoiding 7 common mistakes](https://dicksondata.com/en-my/avoiding-mapping-mistakes)

## Comparison

|                                                              | Current flow (book → place → upload)              | Data first (upload → app books what it finds)            |
| ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| A logger whose calibration runs out mid-study                | Refused before the visit                          | Found after the study: the study must be repeated        |
| Two jobs on the same dates wanting the same logger           | Prevented                                         | Found afterwards                                         |
| Which logger sat where (needed for the annexure and diagram) | Scanned or tapped on site, once                   | Still has to be typed, from paper notes, after the visit |
| Typing                                                       | 1 click to book; a scan or tap per logger on site | No booking, but every position named afterwards          |
| Matches practice (Vaisala, Eupry, Dickson)                   | Yes                                               | No                                                       |

## Decision

- **Keep the current flow.** It is what the guidance and the other tools do. It also catches out-of-date loggers before the
  visit, when they can still be swapped. "Data first" would not remove typing: the positions would still have to be named,
  only later and from paper.
- **Make booking clearer:**
  - "Top up" becomes "Book more".
  - The result explains itself, for example "Booked 26: 23 needed + 3 spare. Left out: 126 out of calibration on these dates,
    10 on another job."
- **Old jobs only (phase 12, migration):** a back-entry path that books from an uploaded file's serials, for studies done
  before QTech. It isn't a daily flow.
