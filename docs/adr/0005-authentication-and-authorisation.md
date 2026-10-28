# ADR 0005 — Authentication, authorisation and e-signatures

Status: accepted (28 Oct 2026)

## Context

The build plan named Better Auth. Its documentation is not reachable from the build
environment, so its current API could only be guessed. The scope we need is small and
well understood: email + password, database sessions, lockout, invite/reset links,
roles, and 21 CFR Part 11-style electronic signatures that reuse the same credential
check. QA Tech has tens of users; no social login, no SSO in scope.

## Decision

Follow the official Next.js 16 authentication guide (database sessions + a data access
layer) with no auth library:

- **Passwords**: Node's built-in scrypt, N=2^17, r=8, p=1 (OWASP). Parameters stored in
  each hash; weaker hashes are upgraded on the next successful sign-in. NIST 800-63B
  rules: at least 12 characters, no forced symbols, refuse common choices and the user's
  own name or email.
- **Sessions**: 256-bit random token in an httpOnly, SameSite=Lax cookie (Secure +
  `__Host-` prefix on https). Only the SHA-256 of the token is stored. 30-minute idle
  timeout (organisation setting) and a 12-hour absolute limit. Revoked on sign-out,
  password change (other sessions), role change and deactivation.
- **Sign-in protection**: identical message and timing for unknown email and wrong
  password; 5 wrong passwords lock the account for 15 minutes; 30 failures from one IP
  in 15 minutes throttle that IP. `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`.
- **Invites and resets**: single-use links, only the newest works, 72 h / 24 h expiry.
  Admins copy the link and send it themselves until email is added.
- **Authorisation**: a role × action matrix in `src/domain/auth/permissions.ts`, checked
  inside every domain service (not only in pages). Admin actions re-read the actor inside
  the transaction, so a just-deactivated admin can't finish an action in flight. Admin
  rows are locked in a fixed order, so concurrent removals can't deadlock and the last
  active admin can't be removed.
- **The proxy** only redirects visitors without a session cookie; the data access layer
  (`src/lib/auth/dal.ts`) is the real check on every page, action and API route.
- **E-signatures**: re-enter password at signing; store signer name and role as they
  were, meaning, timestamp and SHA-256 of the exact content signed. Append-only by
  database trigger. Wrong passwords count toward the same lockout and are audited.
- **CSRF**: server actions are protected by Next.js's Origin check; the upload route
  checks Origin itself; cookies are SameSite=Lax.

## Consequences

About 600 lines of auth code that we own and test (unit + integration + browser). No
third-party auth upgrades to track. Adding SSO or OTP later means adding a sign-in method
in front of the same session layer. Password reset by email arrives with the email
service; until then admins hand out links.
