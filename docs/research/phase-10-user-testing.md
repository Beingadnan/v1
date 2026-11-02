# Phase 10 user testing: close and money

Tested on 2 Nov 2026, on the production build.

**Data**

- **QA Tech's BE-WF-02 export**, in the integration test `billing.test.ts` (12 tests,
  two organisations): the report released, the WCR issued and accepted, the Tally
  invoice, part payments with TDS, a reversal, a write-off, closing and reopening. A
  second job's WCR is voided, issued again and signed on paper, and an invoice past
  the client's terms shows as overdue.
- **Seeded FE-WF-05, in the browser test** `report.spec.ts`:
  - after the client's QA head approves the report, the manager issues the WCR from
    the Billing page;
  - the client's QA head accepts it;
  - the manager records the invoice and the payment, then closes the job.

**Roles:** manager, team leader, accounts, client QA, client QA head, and another
company's QA head. **Messy input:**

- an invoice number with spaces and "#";
- an invoice dated in the future;
- the same number twice in one financial year;
- a payment without a UTR;
- overpaying;
- a write-off without a reason;
- a paper WCR dated before it was issued.

Everything below was fixed and has a test unless marked **open**.

## The exit test

1. **The job can't be invoiced** while the WCR is unsigned: "WCR isn't signed yet".
2. **The invoice:** QT/26-27/101, ₹25,000 + ₹4,500 GST = ₹29,500 is recorded. The job is
   Invoiced.
3. **Closing is refused, with the reasons:** "… isn't signed by the client. Invoice
   QT/26-27/101 isn't fully paid."
4. **The payments:**
   - ₹15,000 by NEFT, then reversed as a typo;
   - ₹14,000 by NEFT;
   - ₹14,997 by cheque with ₹500 TDS (2% of the taxable value) and ₹3 of bank charges
     written off.

   The invoice is cleared and the job is Paid.

5. **Still not closable** until the client signs the report. Signing it does not move
   the Paid job back.
6. **Closed.** Reopening needs a reason ("no" is refused), then it closes again. Every
   step is in the audit trail.

## What broke, and the fix

| Found                                                                                                                                                                                                                 | Fix                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **After "Record invoice" or "Record payment", the page said nothing.** The invoice was saved, but the reply re-drew the page and the form was replaced (a fresh invoice form, or the payment form gone once cleared). | The forms tell the panel as soon as the action returns: "Invoice recorded.", "Payment recorded. Invoice QT/E2E/001 cleared.". The paper WCR form does the same. |
| A WCR row with a long report number cut it short.                                                                                                                                                                     | Taller rows, so the report number wraps onto three lines.                                                                                                       |
| Accounts were going to get file upload, which they don't need.                                                                                                                                                        | Taken out. Accounts record invoices and payments, and see the money; the WCR is the team's.                                                                     |
| Admin had every action, including accepting a WCR for the client.                                                                                                                                                     | `wcr.accept` is a client action, like the report signatures (phase 9).                                                                                          |

## Two people, one record

- **Two people record a payment at once:** the invoice is locked while each is checked
  against the balance. The second is refused if it would overpay ("only ₹… is left").
- **Two people issue the WCR at once:** "already has a WCR".

## Roles

| Role           | What happened                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Accounts       | Billing page; record and cancel invoices; record and reverse payments. Can't issue a WCR or close a job.                      |
| Team leader    | Issues, voids and records the paper WCR. Doesn't see money.                                                                   |
| Manager        | Everything above, and closes and reopens jobs.                                                                                |
| Client QA head | Sees "Work completion reports to accept" on their home and accepts with a signature. Another company's gets "does not exist". |
| Client QA      | Sees the report, can't accept the WCR.                                                                                        |

## Open

- **QA Tech's blank WCR form:** the app's WCR follows the BE-WF-02 letterhead until it
  arrives.
- **Udyam number:** set it under Settings → Organisation if QA Tech is registered. The
  Billing page then quotes the 45-day MSME rule on overdue invoices.
- **Tally import:** the app suggests the next number, but a forgotten invoice is still
  possible. A Tally export import could close that gap later.
