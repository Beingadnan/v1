# ADR 0004 — Content-addressed file storage

Status: accepted (28 Oct 2026)

## Context

Raw logger exports, certificate scans, generated reports and client-signed copies must be
kept exactly as received, provably unchanged, for years.

## Decision

- Files are stored under the SHA-256 of their content (`sha256/ab/cd/<hash>`). Identical
  content gets the same key; an existing file is never overwritten.
- Writes go to a temporary file, are flushed, then renamed into place, so a crash never
  leaves a partial file under a real key. Keys are validated against a strict pattern, so
  no path can escape the storage folder.
- The file's real type is detected from its content (PDF, XLSX, XLS, CSV, PNG, JPEG) and
  must match its extension. Other types are refused with a plain message.
- `stored_files` holds one row per distinct content per organisation. The name a person gave
  a file belongs to the record that uses it (import, certificate…), because the same bytes
  can be attached in several places.
- Bytes are written before the database row commits, so a row never points to a missing
  file. A failed database step leaves at most an unreferenced blob, which is harmless.
- Local disk is used in development; an S3/R2 implementation of the same `BlobStore`
  interface is added at deployment.
- No HTTP upload endpoint exists until login exists (phase 1).

## Consequences

Integrity checks are trivial (re-hash and compare). Duplicate uploads cost no extra space.
Deleting files is deliberately not supported; retention rules will be decided with the client.
