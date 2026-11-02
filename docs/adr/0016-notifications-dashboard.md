# ADR 0016: Notifications are rows written with the event; email is optional and sent after the response

Status: accepted (Phase 11, November 2026)

## Context

Phase 11 adds alerts in the app and by email, a daily digest, role home pages, search
and an archive. QA Tech has no mail service yet. The app runs on one server with no
job queue, and Neon is its only store.

## Decisions

1. **A notification is a row** (person, kind, title, link, read or not, email status).
   It is written by `notify()` inside the same transaction as the event that hands the
   work over, so an alert can't be lost or sent for something that rolled back. The
   person who acted is never notified of their own action.
2. **Email is optional and pluggable.**
   - **The interface:** `EmailSender`, with Resend by default (`RESEND_API_KEY`,
     `MAIL_FROM`).
   - **Without a key,** nothing leaves the server and each alert says "email isn't set
     up". The bell is the record.
   - **What goes at once:** kinds that block someone (a report returned, a report
     released, a WCR to accept, a deviation to decide, a CAPA assigned) are marked
     pending and sent by `after()` once the response has gone.
   - **Exactly once:** a send claims the row first, so two runs never send one twice.
3. **The daily digest** is a route (`POST /api/cron/digest`) behind a bearer secret
   (`CRON_SECRET`, compared in constant time), called by the host's scheduler.
   - **Who gets one:** each person with unread items since their last digest. Accounts
     and managers also get the overdue invoices.
   - **How often:** never twice within 20 hours.
   - **Opting out:** people turn email off for themselves.
4. **The home page is computed, never stored:** tiles of counts with links, chosen by
   what the role can act on. A manager's tiles are the Monday review. Thresholds (data
   overdue after 2 days, unsigned after 7, requalification in 60) are named constants.
5. **Search is plain `ILIKE`** on indexed columns, five hits per kind, filtered by
   permission, with wildcards escaped. The tables are small (thousands of rows), so no
   search engine is needed.
6. **The archive** is the signed reports grouped in memory into Company → Site →
   Year → Month → Department → Equipment.
7. **CAPA belongs to a deviation.**
   - **The record:** owner, due date, the root cause it answers, what was done.
   - **Verification:** by someone other than the owner.
   - **A due date** moves only with a reason in the audit trail.
