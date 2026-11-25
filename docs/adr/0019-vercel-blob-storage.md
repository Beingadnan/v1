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

## Update, 25 Nov 2026: files above 4.5 MB on Vercel

The audit found real files over the limit (an 8.4 MB scanned sketch PDF), and a report
with its certificate annexes can pass it on the way out too. So:

- **Uploads above 4 MB** go from the browser straight into the store when
  `BLOB_READ_WRITE_TOKEN` is set (`src/lib/upload-client.ts`). The browser asks
  `GET /api/files/direct` for its own folder, uploads one private file to
  `incoming/<user id>/<random id>` with a short-lived token from `POST /api/files/direct`
  (size capped at `UPLOAD_MAX_MB`, valid 10 minutes, only that folder), then calls
  `POST /api/files/register`. That route reads the file back, makes exactly the checks
  `POST /api/files` makes (size, content type, hash), stores it content-addressed and
  deletes the incoming copy. The daily cron deletes incoming files older than a day.
  Smaller files, and every file without Blob, still go to `POST /api/files`.
- **Downloads are streamed** (`src/lib/storage/stream.ts`), which Vercel doesn't cap.
- The Content-Security-Policy allows `connect-src https://vercel.com` only when Blob is on.
