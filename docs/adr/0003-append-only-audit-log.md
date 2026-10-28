# ADR 0003 — Append-only audit log enforced by the database

Status: accepted (28 Oct 2026)

## Context

QA Tech's clients are pharma companies audited against GMP and 21 CFR Part 11 / EU Annex 11.
Every important action (who, what, when, before/after, why) must be recorded and must not be
alterable afterwards.

## Decision

- One `audit_log` table for all modules, with a bigint identity id for insertion order.
- A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on it for every role, so the
  rule holds even for code paths that bypass the app.
- `recordAudit()` validates each event (closed list of actions, snake_case entity types,
  actor rules, 64 KB snapshot cap) and must be called with the same transaction as the
  change, so the change and its record commit or roll back together.
- CHECK constraints duplicate the critical rules (actor type, user actions name a user,
  action format) at the database level.

## Not done yet (revisit)

- Hash-chaining rows for tamper evidence against a database superuser. The trigger plus
  restricted production access is judged enough for go-live; reconsider if a client audit
  asks for cryptographic tamper evidence.
- A restricted database role that has only INSERT/SELECT on `audit_log` (deployment phase).

## Consequences

Audit history can only grow. Corrections are made by adding new events, never by editing old
ones. Large data (files, raw readings) is audited by hash, not copied into the log.
