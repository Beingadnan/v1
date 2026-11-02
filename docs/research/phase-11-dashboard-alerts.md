# Phase 11 research: dashboard, alerts and archive

Phase 11 lets people work from the app instead of spreadsheets:

- a home page for each role;
- the manager's Monday review;
- alerts in the app and by email;
- the company archive;
- search;
- deviation and CAPA lists.

**The exit test:** the manager runs the Monday review from the dashboard without opening
Excel.

## What the Monday review covers today

From the plan document and the phases built so far, the manager asks:

- **Jobs:** where is each one (by stage)?
- **Data:** which loggers came back without data?
- **QA Tech's queue:** which reports wait for a check or a release?
- **The client's queue:** which reports and WCRs are with clients, and for how long?
- **Money:** what is invoiced and unpaid, and what is overdue?
- **Instruments:** which loggers and masters expire this month (bookings fail
  otherwise)?
- **Deviations:** which are open, and which wait for a client's decision?
- **Requalifications:** whose are due, so QA Tech can quote before the client asks?

Each of these is a query on data the app already holds, so the dashboard computes them.
None is typed.

## Alerts without alert fatigue

Notification practice is to send at once only what needs someone to act now, batch the
rest into a digest, keep digests short with the most important first, and let people
opt out. Sources: [SuprSend on batching and digests](https://docs.suprsend.com/docs/best-practices-for-batching-digest),
[Courier on notification fatigue](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas).

**What this means here:**

- **Every event that hands work to someone** puts a notification in their bell, in the
  same transaction as the event. Examples:
  - a report sent for checking or returned;
  - a report released or sent back;
  - a WCR to accept;
  - a deviation to decide.
- **Email at once** only when the person is outside QA Tech or the work is blocked on
  them:
  - **the client:** a report released, a WCR to accept, a deviation to decide;
  - **QA Tech:** a report returned to its preparer.
- **Everything else goes into one daily digest per person:** their unread items, plus
  overdue invoices for accounts and the manager.
- **Each person can turn email off;** the bell stays.

## Sending email from India

| Provider            | Price                                      | Setup                            | Notes                                        |
| ------------------- | ------------------------------------------ | -------------------------------- | -------------------------------------------- |
| Resend              | free up to 3,000 a month (about 100 a day) | DNS records in minutes           | the simplest start                           |
| Amazon SES (Mumbai) | about $0.10 per 1,000                      | manual DKIM/SPF, a sandbox first | cheapest; the only one with an Indian region |
| SendGrid            | from about $20 a month                     | manual                           | more reporting                               |

Source: [Rohit Raj, Resend vs SendGrid vs SES for India (2026)](https://rohitraj.tech/en/notes/resend-vs-sendgrid-vs-aws-ses-india-mvp-2026).

QA Tech's volume is tens of emails a day, so Resend's free tier fits. The app talks to
an `EmailSender` interface, so SES can replace it at go-live (phase 12) if data
residency matters. **No key is in the code:**

- with `RESEND_API_KEY` unset, emails are recorded as "not sent: email isn't set up",
  and the bell still works;
- the daily digest runs from a route protected by `CRON_SECRET`, called by the host's
  scheduler.

## CAPA

A CAPA record carries:

- the problem and its linked deviation;
- the root cause;
- each corrective or preventive action, with an owner and a due date (any extension
  justified);
- an effectiveness check, with its method and evidence, before it closes.

21 CFR 211.192 asks for any unexplained discrepancy to be investigated. Inspectors cite
a "disconnect between the deviation, the root cause, and CAPA". Source: [IntuitionLabs,
Deviations, CAPA and change control](https://intuitionlabs.ai/articles/deviations-capa-change-control).

**What this means here:** a CAPA belongs to a deviation (phase 7) and carries:

- kind (corrective or preventive), the action, the root cause it answers;
- the owner and the due date; changing the due date needs a reason;
- done, with what was done;
- verified, with the effectiveness check, by someone other than the owner.

The Deviations page lists open deviations and every CAPA due or overdue.

## Decisions

1. **The home page is built from tiles,** each a count with a link, shown when the
   person's role can act on it. A manager sees them all: the Monday review.
2. **Notifications are rows** (person, kind, title, link, read or not, email status).
   They are written with the event, never by a later job, so none is lost.
3. **Search (Ctrl+K, or the search button on a phone)** covers:
   - jobs by number and PO;
   - studies by report number;
   - equipment by ID;
   - instruments by code and serial;
   - certificates by number;
   - clients by name.

   It shows at most five of each, and only what the person's role can open.

4. **The archive:** Company → Site → Year → Month → Department → Equipment → studies
   whose report is signed, from the signing date. Each level shows its count.
5. **The Deviations page** lists:
   - deviations (open first, oldest first, with who decides);
   - CAPAs (overdue first).
