# ADR 0022 — Every status field has a declared flow

Status: accepted (15 Nov 2026).

## Context

Ten records carry a status that moves: job, study, a study's data, report revision,
calibration certificate, WCR, invoice, corrective action (CAPA), user account and pre/post-cal
override. Only the job had a table, and that covered just the four manual actions (start
field work, hold, resume, cancel). Every other move was implicit: an `if (status !== …)`
guard in one action, a literal `.set({ status: "…" })` in another, and syncing code that
wrote whatever it computed. Nobody could say what moves a record could make, and nothing
stopped a new code path from writing a move nobody intended.

Reading them all found:

- **Two writers for one status.** A study's status is derived from its cycle events (field
  work), but setting the study period after upload (13 Nov) set it to Done directly, even
  when another cycle hadn't ended; the next event would then have moved it back. It now
  uses the same derivation (`studyStatusFrom`).
- **A state nothing reaches.** Report status "reviewed" belonged to the four-signature flow
  that Fix 5.1 removed. Nothing leads to it now; older revisions may still be in it, so it
  keeps its moves out.
- **The automatic job moves were unchecked.** Readiness, data, analysis, reports, WCR and
  money each moved the job by computing a target and writing it.
- A deactivated admin restored by `user:create-admin` went to "invited" even with a
  password; that is now an explicit, declared move.

## Decision

1. `src/lib/state-machine.ts` declares a machine as states and, per state, where it may go.
   `move(machine, from, to)` returns `to` or throws `IllegalMove`; every status write in a
   service goes through it (`.set({ status: move(FLOW, current, "next") })`).
2. Each flow lives beside its statuses: `JOB_FLOW`, `STUDY_FLOW`, `OVERRIDE_FLOW`,
   `DATA_FLOW`, `REPORT_FLOW`, `CERTIFICATE_FLOW`, `WCR_FLOW`, `INVOICE_FLOW`, `CAPA_FLOW`,
   `USER_FLOW`. The rules each action already enforced (who may, what must be true) stay in
   the action; the flow is the outer bound.
3. The guards that selected rows by status (reports a new revision supersedes) are derived
   from the flow, so the two can't drift.
4. A unit test checks every flow: each state is reachable from where records start, and
   exactly the intended states are final.
5. An `IllegalMove` reaching an action is logged and shown as a plain message, never a
   silent wrong state.

Instrument status (active, out of service, retired, lost) and readiness items are choices
a person makes freely, not flows; they stay as checked values.

## Consequences

- A new move is a one-line change to a flow, reviewed with the code that makes it.
- A code path that tries an undeclared move fails in tests instead of in a client's record.
