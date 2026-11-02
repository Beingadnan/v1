# ADR 0015: Tally stays the invoice book; the app records invoices and payments against jobs

Status: accepted (Phase 10, November 2026)

## Context

QA Tech raises GST invoices in Tally, which also files its GST returns. The plan asks
the app to know:

- when a job can be invoiced;
- what was invoiced and paid;
- what is outstanding;
- when a job can close.

Two invoice books would disagree.

## Decisions

1. **Tally makes invoices; the app records them.**
   - **What is recorded:** number, date, taxable value, GST and total. Nothing is
     printed here.
   - **Checks:** the number follows GST Rule 46 (16 characters at most, of letters,
     digits, "-" and "/"). It is unique within its financial year (a partial unique
     index, upper-cased).
   - **The sum:** a database check holds total = taxable + GST.
2. **Money is kept in paise in the code and numeric(12,2) in the database,** so sums
   never drift. A payment records:
   - the amount received;
   - the TDS deducted;
   - a small write-off with a reason.

   All three clear the invoice, and nothing can clear more than the balance.

3. **Nothing about money is edited or deleted.**
   - **A wrong invoice** is cancelled with a reason, and only while nothing is paid
     against it.
   - **A wrong payment** is reversed by a negative entry that points at it (a unique
     index allows one reversal).
   - **Every step** is audited.
4. **The WCR follows the report pattern (ADR 0013, 0014).**
   - **The PDF:** drawn by pdfkit and frozen with its SHA-256.
   - **App acceptance:** an electronic signature over that hash (meaning "Accepted
     By"), stamped into the client's box when the WCR is downloaded.
   - **Paper:** the scan's hash is kept. A wrong WCR is voided and issued again; a
     signed one can't be voided.
5. **The job's status follows the money once the WCR is signed:**
   - WCR signed, then Invoiced (any invoice open), then Paid (all cleared);
   - closing is a manager's decision, refused until the WCR, every report and every
     invoice are done;
   - reopening needs a reason.

   Report changes after the WCR no longer move the job's status. Closing still checks
   that every report is signed.

## Consequences

- **Tally and the app can still differ** if someone forgets to record an invoice. The
  "Invoice due" list and Rule 47's 30 days make the gap visible. A Tally import is a
  later option.
- **Credit notes are Tally's:** a cancelled invoice here is a wrong entry, not a credit
  note.
