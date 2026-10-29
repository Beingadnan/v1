import { describe, expect, it } from "vitest";

import { planInstrumentImport, type ListRow, type Snapshot } from "./instrument-import";

const row = (over: Partial<ListRow>): ListRow => ({
  sheet: "Testo Temp.RH(MUM)",
  row: 22,
  name: "Portable Datalogger",
  make: "Testo",
  model: "174H",
  code: "",
  serialNo: "",
  certificateNo: "",
  rangeText: "",
  calibratedOn: null,
  validUntil: null,
  carried: false,
  ...over,
});

const snapshot: Snapshot = {
  models: [{ id: "m", make: "Testo", model: "174H" }],
  instruments: [
    { id: "i1", code: "TRH-3611", serialNo: "84028451", make: "Testo", tier: "working" },
  ],
  certificates: [],
  sites: [],
  labName: "QA Tech",
};

describe("a logger relabelled between files (same serial, another ID)", () => {
  it("keeps its history under the ID already registered and says so", () => {
    const plan = planInstrumentImport(
      {
        rows: [
          row({
            code: "T-TRH0124",
            serialNo: "84028451",
            certificateNo: "QATECH/BHIWANDI/08/25/PDL-23",
            calibratedOn: "2025-08-14",
            validUntil: "2026-08-13",
          }),
        ],
        workbookCertificates: [],
        problems: [],
      },
      snapshot,
    );
    expect(plan.instruments).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.certificates[0]!.codes).toEqual(["TRH-3611"]);
    expect(plan.problems[0]).toMatch(/registered as TRH-3611; this file calls it T-TRH0124/);
  });
});
