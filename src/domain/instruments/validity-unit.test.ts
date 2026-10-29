import { describe, expect, it } from "vitest";

import { certificateCovering, usableOn, validityState } from "./validity";

const cert = (
  number: string,
  calibratedOn: string,
  validUntil: string | null,
  status = "issued",
) => ({
  id: number,
  number,
  status,
  calibratedOn,
  validUntil,
});

describe("which certificate covers a day", () => {
  const history = [
    cert("ARAI/CAL/2408/1836", "2024-08-20", "2025-08-19"),
    cert("ARAI/CAL/2508/2925", "2025-08-20", "2026-09-08"),
    cert("DRAFT-1", "2026-09-01", "2027-08-31", "draft"),
  ];

  it("finds the certificate in force on 11.08.2025 (BE-WF-02 logger calibration)", () => {
    expect(certificateCovering(history, "2025-08-11")?.number).toBe("ARAI/CAL/2408/1836");
    expect(certificateCovering(history, "2025-08-20")?.number).toBe("ARAI/CAL/2508/2925");
  });

  it("ignores drafts and gaps", () => {
    expect(certificateCovering(history, "2026-10-01")).toBeNull();
    expect(certificateCovering(history, "2024-01-01")).toBeNull();
  });

  it("explains why an instrument can't be used", () => {
    expect(usableOn({ code: "TL-38", status: "active" }, history, "2026-10-01")).toEqual({
      ok: false,
      message: "TL-38's calibration (ARAI/CAL/2508/2925) expired on 08.09.2026.",
    });
    expect(usableOn({ code: "TL-38", status: "retired" }, history, "2025-09-01")).toMatchObject({
      ok: false,
    });
    expect(usableOn({ code: "X", status: "active" }, [], "2025-09-01")).toMatchObject({
      ok: false,
      message: "X has no calibration certificate.",
    });
    expect(usableOn({ code: "TL-38", status: "active" }, history, "2025-09-01")).toMatchObject({
      ok: true,
    });
  });
});

describe("alert levels", () => {
  it.each([
    ["2026-10-28", "expired"],
    ["2026-11-04", "due_7"],
    ["2026-11-12", "due_15"],
    ["2026-11-27", "due_30"],
    ["2027-01-01", "valid"],
  ] as const)("due %s → %s (today 29 Oct 2026)", (due, state) => {
    expect(validityState(due, true, "2026-10-29")).toBe(state);
  });

  it("knows never-calibrated and no-due-date instruments", () => {
    expect(validityState(null, false, "2026-10-29")).toBe("never");
    expect(validityState(null, true, "2026-10-29")).toBe("valid");
  });
});
