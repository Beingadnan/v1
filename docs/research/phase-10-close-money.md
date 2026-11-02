# Phase 10 research: close and money

Phase 10 takes a job from its reports to the bank:

- the work completion report (WCR), signed by the client;
- the invoice QA Tech raises in Tally;
- the payments that clear it, after tax deducted at source;
- closing the job.

## How QA Tech works today

From the plan document and the job statuses confirmed on 28 Oct 2026:

1. **WCR:** when the work is done, QA Tech sends a WCR listing the equipment covered.
   The client signs it; the client's purchase or accounts team won't pass an invoice
   without it.
2. **Invoice:** accounts raise the GST invoice in Tally.
3. **Payment:** the client pays by bank transfer (the UTR is the reference) or cheque,
   often in parts and nearly always after deducting TDS.
4. **Follow-up:** accounts chase what is outstanding from an Excel sheet. QA Tech's
   blank WCR form has not arrived yet (see phase 8's open items), so the app's WCR
   follows the BE-WF-02 letterhead and layout until it does.

## Rules that shape the design

### The GST invoice (CGST Rules 46 and 47)

- **Rule 46 lists what a tax invoice carries:**
  - the supplier's and recipient's names, addresses and GSTINs;
  - a consecutive invoice number, unique in the financial year, **at most 16
    characters**, of letters, digits, "-" and "/";
  - the date and the place of supply;
  - the SAC, a description, and the taxable value;
  - the rate and amount of CGST and SGST, or IGST;
  - a signature.
- **Rule 47:** an invoice for services is issued **within 30 days of the supply**.

Sources: [Tally on Rule 46](https://tallysolutions.com/gst/gst-invoice-format-mandatory-fields-rules-and-examples-for-businesses/),
[Rule 47 (GSTZen)](https://www.gstzen.in/a/time-limit-for-issuing-tax-invoice-cgst-rule-47.html).

**What this means here:** Tally stays the place invoices are made (and filed for GST).
The app records the Tally invoice and checks it:

- the number's shape, and that it is unique in its financial year (April to March);
- the date, which can't be in the future;
- the sum: taxable value plus GST equals the total, to the rupee.

**Automation:** the app suggests the next number from the last one, the taxable value
from the job's value less what was already invoiced, and GST at 18%. It shows how many
days have passed since the WCR, warning near Rule 47's 30 days.

### TDS (Income-tax Act s.194J)

- **The rate:** fees for technical services carry TDS at **2%**; professional fees at
  10%.
- **The threshold:** neither applies until ₹50,000 a year of that kind.
- **Calibration:** testing services are treated as technical. Calibration is not named,
  so the rate is the client's call; 2% is the default the app suggests.

Source: [CalcGuru on 194J rates, FY 2026-27](https://calcguru.in/?p=7496).

**What this means here:** a payment is recorded as the amount received **plus** the TDS
the client deducted. Both count toward clearing the invoice. TDS is what QA Tech claims
back against Form 26AS, so it is kept per payment.

### Paying micro and small enterprises (MSMED Act s.15, Income-tax Act s.43B(h))

- **The limit:** a buyer must pay a micro or small enterprise within the agreed term,
  and never more than 45 days.
- **The deduction:** since FY 2023-24, a buyer can claim the expense only when paid, if
  they pay later than that. The Finance Ministry confirmed this in July 2026.
- **For QA Tech:** if it is Udyam-registered as micro or small, this is real leverage in
  follow-ups.

Sources: [TaxGuru on the July 2026 clarification](https://taxguru.in/income-tax/finance-ministry-clarifies-section-43bh-45-day-msme-payment-rule.html),
[Busy on s.43B(h)](https://busy.in/accounting/section-43bh-msme-payment-rule-and-45-day-limit-explained/).

**What this means here:** each client has payment terms in days (default 45). An
invoice is overdue after its date plus those days. When QA Tech's Udyam number is set
in Settings, the overdue list says the 45-day MSME limit applies.

## Decisions

1. **The WCR is generated, not typed.** One per job, once every study's report is
   released or signed. It lists:
   - the job, PO and work period;
   - every piece of equipment with its report number and report status;
   - QA Tech's team.

   Issuing it freezes the PDF with its SHA-256, as for reports. The client's QA head
   accepts it in the app with an electronic signature (meaning "Accepted By"), or QA
   Tech records the signed paper scan with the signatory and date. The job moves to WCR
   signed.

2. **"Invoice due" is a list, not a reminder.** The Billing page puts at the top every
   job whose WCR is signed and that isn't fully invoiced. It shows the days since the
   WCR, against Rule 47's 30.
3. **Invoices are records of Tally invoices.**
   - **What is recorded:** number, date, taxable value, GST, and total.
   - **A wrong entry is cancelled with a reason,** never deleted. A job can have more
     than one invoice (part billing).
   - **The job's status:** Invoiced with the first invoice, Paid when every invoice is
     cleared.
4. **Payments clear invoices.** Each payment records:
   - the date, the amount received and the TDS deducted;
   - the mode (NEFT/RTGS/IMPS/UPI, cheque, cash);
   - the reference (UTR or cheque number), which is required except for cash.

   A short payment's last few rupees can be written off with a reason. Nothing is
   cleared beyond the total.

5. **Outstanding and overdue are worked out, never typed.** Balance and days since the
   invoice, the due date from the client's terms, and an overdue list with the oldest
   first.
6. **Closing checks everything.** A manager can close a job only when:
   - its WCR is signed;
   - every study's report is signed by the client;
   - every invoice is cleared.

   The refusal says what is missing. A closed job moves to the jobs History. Reopening
   needs a reason and puts it back to Paid.

7. **Who does what:**
   - **Accounts** record invoices and payments (new action `billing.record`; manager and
     admin too).
   - **Team leaders and managers** issue the WCR (`wcr.issue`).
   - **Only managers and admin** close and reopen (`jobs.close`).
   - **The client's QA head** accepts the WCR (`wcr.accept`, a client action).
