# ADR 0023 — The client page is the company folder

Status: accepted (16 Nov 2026). Follows the plan's "Company archive" (step 16) and ADR on the
client explorer (commit f9b5636).

## Context

QA Tech asked whether a study "goes to the company folder" once done. The plan says a study
moves into the company archive when the client signs its report, filed as Company → Region →
Year → Month → Department → Equipment → Studies. The client page instead filed every study,
signed or not, under Site → Department → Year by the job's start date; the signed tree lived
only on the separate Archive page.

## Decision

The client page's Explorer holds both of the plan's trees under each site:

- **Reports**: only studies whose report the client signed, as Year → Month (of signing,
  India time) → Department → Equipment → the signed report files (with PDF), and an
  **In progress** folder for studies not signed yet (cancelled jobs left out).
- **Equipment, by department**: the customer record, Site → Department → equipment.

`companyArchive()` reads the signed reports for one client; the Archive page keeps the
all-clients view of the same tree.

## Update, 16 Nov 2026: one page, no folder tree

QA Tech found the Explorer tree confusing (reports and departments side by side in the
sidebar, six clicks to a report). The client page is now one page: a short tree on the left (All sites, each site, its
departments) narrows four tabs on the right:

- **Equipment**: grouped by department (and site), with next due and the last signed
  report, which opens the PDF.
- **Signed reports**: pick a year; its months follow, newest first, each a table of
  equipment, department, report, signing date, job and PDF. The plan's Year → Month →
  Department → Equipment order is kept as grouping and columns instead of folders.
- **In progress**: studies not signed yet.
- **Contracts & contacts**: contracts, signatories, client users and the client's terms.

## Update, 16 Nov 2026 (later): back to the Explorer window, three kinds of folder

QA Tech preferred the Explorer window to the tabs, asking only that it be cleaner. The
confusion had come from mixing report folders and department folders as siblings under a
site. Each site now holds three kinds of folder, each with its own icon so they are never
mixed up:

- **Year folders** (yellow): year → month → department → equipment → signed reports, the
  plan's archive order.
- **Equipment** (blue clipboard): the site's register, by department, with next due.
  URL `view=equipment`, and `dept=` for one department.
- **In progress** (orange clock): studies not signed yet.

The tree unfolds only the open path. The client's terms, contracts, signatories and users
sit below the window on the client's own folder.
