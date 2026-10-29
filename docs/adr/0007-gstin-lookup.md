# ADR 0007 — Filling client details from a GSTIN (Cashfree)

Status: accepted (29 Oct 2026)

## Context

QA Tech wants the client's name and address filled in automatically. Indian clients are
best identified by their GSTIN, and the registered legal name and principal address are
what reports and invoices should carry. The government portal's free search is for people
(captcha) and must not be automated; official API access goes through paid providers.
QA Tech chose Cashfree's Verify GSTIN API (free trial credits, then prepaid per lookup).

## Decision

- `POST {sandbox|api}.cashfree.com/verification/gstin` with `x-client-id` /
  `x-client-secret`, and `x-cf-signature` (RSA-OAEP SHA-1 of `clientId.unixTime`) when the
  account uses public-key 2FA instead of IP whitelisting. Keys only in the server's
  environment; the feature is off when they are missing.
- A valid GSTIN typed in the client or site form is looked up once, automatically; a
  "Fill from GST" button repeats it. Only empty fields are filled; the person checks and
  saves as usual. A GSTIN that is not Active is flagged.
- Cost and abuse guards: production lookups only for GSTINs that pass the local check
  character test; results cached 30 days per organisation (`gstin_lookups`); 30 paid
  lookups per person per hour; every paid lookup audited (`gstin.looked_up`).
- Only `clients.manage` roles can look up.

## Consequences

A paid external dependency, kept optional and replaceable: the domain code
(`src/domain/clients/gst-lookup.ts`) maps the provider's answer to our own `GstDetails`, so
another provider is one new function. Live behaviour can only be verified from a machine
that can reach Cashfree; the tests use the documented response shape.
