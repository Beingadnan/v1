# Phase 9 research: review and sign-off

Phase 9 takes a drafted report (phase 8) through QA Tech's own check and the client's
sign-off:

- the preparer signs Done By, and the checker signs Checked By or sends it back;
- the report is released to the client;
- the client's QA signs Reviewed By and their QA head signs Approved By, in the app or
  on paper;
- the signed report goes to the company's archive.

## What the issued BE-WF-02 report shows

Page 6 ends with one signature block of four columns:

| Column      | Who signs             |
| ----------- | --------------------- |
| Done By     | QA Tech, the preparer |
| Checked By  | QA Tech, the checker  |
| Reviewed By | the client            |
| Approved By | the client            |

Each column has rows for Signature, Name and Organisation. On the paper report all four
are signed in ink. The Organisation row reads "QA Tech (GMP Technical Solutions Pvt.
Ltd.)" under the first two columns and the client's name under the last two.

WHO TRS 961 Suppl. 8 §2.4.5 says the report is reviewed by an independent, competent
person. When a third party wrote the report, the party that commissioned it approves
it (see the phase 8 research). That matches the block: QA Tech checks, and the client
reviews and approves.

## What the regulations ask of an electronic signature

### 21 CFR Part 11 (FDA)

- **§11.50 Signature manifestations:** the signed record shows the signer's printed
  name, the date and time of signing, and what the signature means (review, approval,
  responsibility or authorship). This shows on screen and on every printout.
- **§11.70 Signature/record linking:** a signature is linked to its record, so it
  can't be cut out, copied or moved to falsify another record.
- **§11.100:** each signature belongs to one person and is never reused or reassigned.
- **§11.200(a)(1):** a non-biometric signature has at least two parts, an ID and a
  password.
  - In one continuous session, the first signing uses both parts.
  - Later signings in that session use at least one part known only to the signer.
  - A signing outside a continuous session uses both parts again.
- **§11.300:** IDs and passwords are unique and checked over time. Attempts to use
  them without authority are detected and reported.

Sources: [21 CFR 11.200 (Cornell LII)](https://www.law.cornell.edu/cfr/text/21/11.200),
[21 CFR Part 11 full text](https://chanrobles.com/usa/uslaws/cfr/title21/21-1.0.1.1.7.php).

### EU GMP Annex 11 §14

An electronic signature:

- has the same impact as a handwritten one within the company;
- is permanently linked to its record;
- includes the time and date it was applied.

Annex 11 states principles. Part 11 is more prescriptive about how.

Sources: [Scilife on Annex 11](https://www.scilife.io/blog/electronic-records-signatures-annex-11),
[SimplerQMS, Part 11 vs Annex 11](https://simplerqms.com/21-cfr-part-11-vs-eu-annex-11/).

### Hybrid records (signed paper for an electronic record)

- **WHO:** discourages hybrid systems. Where they are used, there must be a secure link
  between the paper and the electronic record for the whole retention period.
- **PIC/S PI 041 §9.3:** hybrid systems need more review. The reviewer checks the paper,
  the electronic record and the link between them.

Source: [LCGC, Data Integrity Focus part III](https://chromatographyonline.com/view/data-integrity-focus-part-iii-what-problem-hybrid-systems).

### India

- **Schedule M (revised 2023, in force for all manufacturers from 2025–26):** brings
  Indian GMP close to WHO and PIC/S, including qualification and validation records
  that QA approves.
- **The IT Act 2000:** recognises electronic signatures in its Second Schedule, which
  covers Aadhaar eSign and DSC.
  - The app's in-app signature is a closed-system GMP signature in the Part 11 and
    Annex 11 sense. It is not an IT Act eSign.
  - Some clients' QA will still want ink, so the paper route stays a first-class way
    to close a report.

Sources: [India Briefing on Schedule M](https://india-briefing.com/news/india-tightens-pharmaceutical-gmp-standards-from-january-2025-35679.html),
[Leegality on Aadhaar eSign](https://www.leegality.com/legalprimer/aadhaar-esign-enforceability).

## What validation tools do

Paperless validation tools route a document through review and approval with
e-signatures, return it with comments, and keep every version. Kneat Gx is an example:
it describes review, approval and execution with audit trails
([Kneat](https://kneat.com/solution)). The common pattern:

- a signature always re-asks for the password;
- the signature's meaning is fixed by the step, not typed by the user;
- the author can't approve their own work;
- the export is a PDF with a signature page listing each signature;
- comments are tied to a place in the document and must be answered before the
  document moves on.

## Decisions

1. **One record, many signatures.**
   - **Done By:** the preparer's Submit for check freezes the report (phase 8's
     freeze) and signs Done By, in one action.
   - **The other three:** Checked By, Reviewed By and Approved By are signed over the
     same SHA-256 of the frozen PDF.
   - **The frozen PDF never changes.** The signatures live in the `signatures` table
     (phase 1), linked by the PDF's hash.
2. **The signed copy is built from the frozen PDF.** The download of a signed revision
   is the frozen PDF with two additions:
   - the names and the signing time stamped into the signature block on page 6;
   - a last page, "Electronic signatures", listing for each signature its meaning, name,
     role, organisation and time (IST), with the frozen PDF's SHA-256. This meets §11.50
     on the printout.

   The stamping uses pdf-lib, with fixed dates, so the same signatures always give the
   same file. When the client approves, that copy is stored with its own SHA-256 as the
   issued report.

3. **The password is asked at every signing,** not only the first in a session. This is
   stricter than §11.200(a)(1)(i) and simpler to explain. Wrong passwords count toward
   the sign-in lockout (phase 1).
4. **No one checks their own report.**
   - Checked By is refused when the checker signed Done By on that revision.
   - Approved By is refused when the approver signed Reviewed By on it.
5. **Returns don't create revisions, unless the report was released.**
   - **QA Tech's checker returns it:** the same revision goes back to draft. Rev 00 is
     the first revision the client sees.
   - **The client returns it:** the revision is marked Returned, and the preparer starts
     the next one with a reason (Rev 01). The exit test goes this way.
6. **Comments are pinned to a section of the report.**
   - **The sections and their page numbers** come from the frozen PDF: cover, details,
     diagram, graphs, observation and conclusion, raw data, post-cal, deviations and
     certificates.
   - **A return needs at least one comment.**
   - **Submitting again needs every open comment answered** ("Fixed: …"). The answer is
     kept with the comment.
7. **Release, with an email the person sends.**
   - **What Release does:** it marks the revision released to chosen client users and
     opens a ready-written email with a link to the report in the client area. The link
     needs the client to sign in, so it is not a bearer token that could be forwarded.
   - **Why no automatic email:** the app has no mail service yet. Notifications by
     email are phase 11.
8. **The paper route.** For a checked or released revision, QA Tech uploads the scan of
   the signed paper (PDF or image). They enter who reviewed and who approved, with their
   dates.
   - **The link to the record:** the scan is stored with its SHA-256, next to the frozen
     PDF's SHA-256. This is WHO's secure link.
   - **Checks:** the dates can't be in the future or before the report was checked.
9. **The client's QA head decides deviations in the app.** The decision on a post-cal
   failure (no impact, exclude probe or repeat study) is signed with meaning "Deviation
   decision", over a hash of the deviation's number, assessment and decision.
   - **What happens next:** it closes the deviation as phase 7's paper decision does,
     with the signer's name and date.
   - **The paper way stays:** QA Tech can still record a decision from paper.
10. **The job follows its reports.**
    - **The rule:** the job's status follows the least advanced study (Checked, Sent to
      client, Client signed).
    - **Going back:** any return, or any revision started after checking, moves it to
      Rework.
    - **The archive:** a signed report puts its study in the company archive. The full
      archive tree is phase 11.
