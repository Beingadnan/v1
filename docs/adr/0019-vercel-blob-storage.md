# ADR 0019 — Files in Vercel Blob

Status: accepted (11 Nov 2026). Replaces the "cloud storage at deployment" note in
`src/lib/storage/blob-store.ts`.

## Context

Uploaded and generated files (logger exports, certificates, gate pass scans, frozen and
issued reports, photos, letterheads) were kept on local disk under `STORAGE_LOCAL_DIR`.
A hosted app has no lasting disk, and QA Tech chose Vercel Blob for files.

## Decision

- `VercelBlobStore` implements the existing `BlobStore` interface. Nothing else in the app
  changes: every caller already goes through `blobStore` and `stored_files`.
- It is used when `BLOB_READ_WRITE_TOKEN` is set; otherwise local disk, as before. Tests
  never reach Vercel (the unit test replaces the SDK with an in-memory map).
- Blobs are stored with `access: "private"`. There is no public URL to a client's report
  or certificate; the app reads the bytes with the token and serves them after its own
  organisation and role checks, exactly as with local disk.
- Keys stay content-addressed (`sha256/ab/cd/<hash>`), with no random suffix and no
  overwrite, so the same bytes are stored once and a key never points at other bytes.
  Cached reads are therefore always correct.
- `npm run storage:to-blob` copies files already on local disk into the store once. It
  can be run again; files already there are skipped.

## Consequences

- If the app itself is hosted on Vercel, a request body is limited to 4.5 MB, so uploads
  through `/api/files` above that size fail there. QA Tech's logger exports are well below
  it; large certificate scans would need client uploads (browser straight to Blob with a
  short-lived token), which is a later change if it is needed. Hosting elsewhere (Railway,
  a VM) has no such limit.
- Reading a file is one HTTPS request to the store instead of a disk read; downloads are
  occasional, so this is not on any page's critical path.
- The token is a secret: it lives only in `.env.local` and the host's environment
  settings, never in the repository.
