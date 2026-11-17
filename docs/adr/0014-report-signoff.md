# ADR 0014: Report sign-off signs the frozen PDF's hash; the signed copy is built from it

Status: accepted (Phase 9, November 2026)

> **Update, 10 Nov 2026 (commit f80eeae):** QA Tech's reference report carries two
> signatures, so the chain below was cut to two: **for QA Tech** (a team leader or
> manager who did not prepare the revision, `checked_by`) and **for the client** (the
> client's signatory, `approved_by`). Freezing no longer signs: the preparer is recorded
> as who froze the revision (`frozen_by_user_id`), and can't sign it for QA Tech. The
> client's separate Reviewed By step is gone. Decisions 1, 2 and 5 below still hold; read
> "four signatures", "Freeze and Done By are one step" and "the Reviewed By signer can't
> sign Approved By" as history.

## Context

A mapping report carries four signatures: Done By and Checked By (QA Tech), Reviewed
By and Approved By (the client). A signed record must:

- show each signer's name, the date and time, and what the signature means, on screen
  and on paper (21 CFR 11.50);
- keep each signature linked to its record (11.70, Annex 11 §14).

A frozen report never changes (ADR 0013), but its signatures arrive one by one, over
days.

## Decisions

1. **Signatures are records of their own, over the frozen PDF's SHA-256.**
   - **Where they are kept:** they live in the `signatures` table (phase 1, append
     only), with entity `report`, the revision's id, and the frozen PDF's hash.
   - **The frozen PDF:** it is never rewritten.
   - **One transaction:** a signature and the status change it makes commit together
     (`signRecordTx`). A wrong password changes nothing but the failed-attempt count.
2. **The signed copy is derived.**
   - **How it is built:** the frozen PDF with names and times stamped into the boxes of
     the signature block (their position is recorded at freeze), and a last page listing
     every signature with the frozen hash. pdf-lib builds it with fixed dates, so the
     same signatures give the same bytes.
   - **When it is stored:** the client's approval stores it once, with its own SHA-256,
     as the issued copy.
3. **Freeze and Done By are one step,** so nothing is frozen without its author's
   signature.
   - **A checker's return:** it puts the same revision back to draft. The old PDF and
     its signature stay on record, under the old hash.
   - **A client's return:** it marks the revision Returned. The next revision answers
     it and supersedes it when it is frozen.
4. **Separation of duties is enforced:**
   - the Done By signer can't sign Checked By;
   - the Reviewed By signer can't sign Approved By;
   - only client users sign for the client (admin does not get client actions);
   - client users see only their company's released revisions.
5. **The paper route is a first-class close.**
   - **What is kept:** the scan's SHA-256 next to the frozen PDF's, and who signed and
     when.
   - **Downloads:** the scan is the issued record, and it is downloadable next to the
     frozen PDF.
6. **No mail service yet.** Release gives a ready-written email with a link to the
   client area. The client must sign in to open it, so a forwarded link exposes
   nothing. Email notifications are phase 11.

## Consequences

- **Changing a signature's appearance** (fonts, wording) changes future signed copies
  but never the frozen PDF or a stored issued copy.
- **Verifying an issued report:** hash pages 1 to N of the issued copy's source (the
  frozen PDF, downloadable) and compare it with the hash on the signature page and in
  the database.
