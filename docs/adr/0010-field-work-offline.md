# ADR 0010: Field work on phones — positions, scanning and the offline outbox

Status: accepted (Phase 5, October 2026)

## Context

Engineers work inside cold rooms, freezers and warehouses, often with no signal, on
Android phones, sometimes with gloves. What they record on site (where each logger went,
when each cycle started and ended) becomes the report's evidence, so it must not be lost,
duplicated or re-timed.

## Decisions

1. **Positions are stored as fractions of the box** (x along the length, y along the
   width, z up the height, each 0 to 1), with a label (L-01…) and a note. One pure
   module draws them on the phone screen and in the FT-12 PDF, so both show the same
   picture whatever the box size.

2. **Scanning uses the browser's BarcodeDetector**, which Chrome on Android has had since
   version 83. Where it is missing (iPhone, Firefox, desktop), people type, or use a
   scanner gun, which types and presses Enter. No barcode library is added.

3. **An offline outbox in the browser.**
   - Taps for times, logger placements and pre-cal readings are sent straight away. If
     the network fails, or the session has ended, they are kept in `localStorage` and
     sent again when the phone is online (on the `online` event and every 15 s).
   - Each time marker and pre-cal reading carries an id made on the phone. The server
     inserts once and treats a repeat as already done, so a retry never doubles a
     record.
   - **A time is the moment it was tapped**, not when it reached the server. The server
     accepts it if it is no more than 10 minutes in the future and no more than 30 days
     in the past.

4. **Studies follow their times.**
   - A study is Running from its first start, and Done when every cycle has ended.
   - The first start moves a Ready job to Field Work, after the readiness checklist is
     recalculated.
   - A start is refused while any position has no logger.
   - Wrong times are struck out with a reason, never deleted.

5. **Placement rules live on the server.** A logger is refused if it is:
   - a master;
   - out of calibration for the study's dates;
   - on another job on those dates;
   - already at another position on this job;
   - failed pre-cal, or has no passing pre-cal on a thermal validation.

   Bookings are taken under the same per-organisation lock as in phase 4.

## Consequences

- Photos are not queued offline; files are too large for `localStorage`. IndexedDB is
  the way to add it later.
- The outbox is per browser. An engineer who switches phones before reconnecting must
  resend from the first phone.
