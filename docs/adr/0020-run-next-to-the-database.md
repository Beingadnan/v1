# ADR 0020 — Run the production build next to the database

Status: accepted (13 Nov 2026). Builds on ADR 0017 and ADR 0018.

## Context

On 12 Nov 2026 a client tried the app on his laptop and found every page, tab and save slow.
The app was served by `npm run dev` on a Mac in India, over the office network, against Neon
in Singapore.

Measured on 13 Nov with every database round trip held back 30 ms each way (about India to
Singapore), warm, same pages and data:

| Page                      |  `next dev` | Production build | Queries |
| ------------------------- | ----------: | ---------------: | ------: |
| Home                      |      661 ms |           148 ms |      18 |
| Jobs                      |      1.32 s |           169 ms |       2 |
| Job                       |      3.36 s |           173 ms |      16 |
| Study                     |      3.97 s |           175 ms |      11 |
| Study, Data tab           |      786 ms |           228 ms |      19 |
| Instruments               |      1.71 s |           124 ms |       5 |
| Instrument                |      2.16 s |           145 ms |       9 |
| Reports, Reviews, Billing | 0.96–1.35 s |       129–134 ms |     3–7 |

The development server compiles each page and action on first use, ships unminified
JavaScript and checks everything twice in strict mode. On a laptop it is slower again.

Pages read in one or two rounds (ADR 0018), so they cost one or two round trips. A save is
different: it runs in one transaction, and a transaction's statements go one after another
(creating a job is about 24, booking loggers about 20, saving a layout about 21). Each pays
the full round trip to the database: about 60 ms from India to Singapore, so 1–1.5 s per
save, and roughly 250 ms each to a US region. Next to the database a round trip is about
1 ms.

## Decision

1. **Never show the app on `npm run dev`.** For a demo on the office network, run the
   production build: `npm run build`, then `npm run start:lan` (listens on the network;
   `npm start` listens on this computer only). `scripts/start-standalone.mjs` reads
   `.env.local`.
2. **Host the app in the database's region.** `vercel.json` pins the functions to
   Singapore (`sin1`), next to Neon `ap-southeast-1`, so a save's ~20 statements cost
   ~20 ms instead of ~1.2 s. The daily digest runs from Vercel Cron at 08:00 India time
   (the route accepts GET for it).
3. **Neon's free tier suspends the database after 5 idle minutes.** The first click after
   that waits about a second while it wakes. Turn auto-suspend off (paid plan) before
   go-live, or accept it.

## Consequences

- On Vercel the files must go to Vercel Blob (`BLOB_READ_WRITE_TOKEN`, ADR 0019): the
  function's disk is not kept.
- If the database moves region, the `regions` entry moves with it.
