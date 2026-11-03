import { describe, expect, it } from "vitest";

import {
  planInstrumentImport,
  readingPrint,
  type ListRow,
  type Snapshot,
} from "./instrument-import";

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

describe("a certificate number QA Tech printed on two calibrations", () => {
  const wb = (sheet: string, calibratedOn: string, codes: string[]) => ({
    sheet,
    number: "QATECH/BHIWANDI/07/26/PDL-13",
    calibratedOn,
    validUntil: null,
    customerName: "",
    customerAddress: "",
    location: "Bhiwandi",
    department: "",
    equipmentName: "Portable Datalogger",
    make: "Testo",
    model: "174H",
    rangeText: "-20 to 70 °C",
    resolutionText: "",
    sopNo: "",
    conditionOnReceipt: "",
    accuracyText: "",
    environmentTemperature: "",
    environmentHumidity: "",
    masters: [],
    points: [{ quantity: "temperature" as const, reference: "-20.1", condition: "" }],
    instruments: codes.map((code, i) => ({ code, serialNo: `9000${i}` })),
    readings: [codes.map(() => "-20.2")],
  });

  it("records the second under the number and its date, and says so, instead of dropping it", () => {
    const plan = planInstrumentImport(
      {
        rows: [],
        workbookCertificates: [wb("T-TRH041 to T-TRH-060", "2026-07-24", ["T-TRH041", "T-TRH042"])],
        problems: [],
      },
      {
        ...snapshot,
        certificates: [
          {
            id: "c1",
            number: "QATECH/BHIWANDI/07/26/PDL-13",
            labName: "QA Tech",
            itemIds: [],
            calibratedOn: "2026-07-23",
          },
        ],
      },
    );
    expect(plan.alreadyRecorded).toEqual([]);
    expect(plan.fullCertificates.map((c) => c.number)).toEqual([
      "QATECH/BHIWANDI/07/26/PDL-13 (24.07.2026)",
    ]);
    expect(plan.fullCertificates[0]!.note).toMatch(
      /printed QATECH\/BHIWANDI\/07\/26\/PDL-13 on two/,
    );
    expect(plan.problems.join("\n")).toMatch(
      /already recorded for a calibration on 23\.07\.2026; this file's is dated 24\.07\.2026 \(T-TRH041 to T-TRH042\)/,
    );
  });

  it("still skips a file imported a second time (same number, same date)", () => {
    const plan = planInstrumentImport(
      { rows: [], workbookCertificates: [wb("s", "2026-07-23", ["T-TRH041"])], problems: [] },
      {
        ...snapshot,
        certificates: [
          {
            id: "c1",
            number: "QATECH/BHIWANDI/07/26/PDL-13",
            labName: "QA Tech",
            itemIds: [],
            calibratedOn: "2026-07-23",
          },
        ],
      },
    );
    expect(plan.alreadyRecorded).toEqual(["QATECH/BHIWANDI/07/26/PDL-13"]);
    expect(plan.fullCertificates).toEqual([]);
  });
});

describe("a logger list printed as blocks side by side", () => {
  it("reads each block, and skips serials pasted into an ID column", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { readInstrumentList } = await import("./instrument-import");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Testo Temp.RH(Nagpur)");
    ws.addRow(["SR. No.", "Serial No.", "ID", "SR. No.", "Serial No.", "ID"]);
    ws.addRow([1, 37343995, "T-TRH0269", 51, 84666231, "T-TRH0552"]);
    ws.addRow([2, 37337771, "T-TRH0439", 52, 83592650, "T-TRH0236"]);
    ws.addRow([3, 37339498, "T-TRH0598", null, 84870418, 84055315]);
    const r = await readInstrumentList(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(r.rows.map((x) => `${x.code}:${x.serialNo}`)).toEqual([
      "T-TRH0269:37343995",
      "T-TRH0439:37337771",
      "T-TRH0598:37339498",
      "T-TRH0552:84666231",
      "T-TRH0236:83592650",
    ]);
    expect(r.problems).toEqual([
      "Testo Temp.RH(Nagpur) row 4: ID “84055315” looks like a serial number, not a QA Tech ID; skipped.",
    ]);
  });
});

describe("a list that names neither make nor model", () => {
  it("gives its new instruments the model picked, so they take its accuracy", () => {
    const plan = planInstrumentImport(
      {
        rows: [row({ make: "", model: "", name: "", code: "T-TRH0269", serialNo: "37343995" })],
        workbookCertificates: [],
        problems: [],
      },
      snapshot,
      { defaultType: "portable_logger", listModelId: "m" },
    );
    expect(plan.instruments[0]).toMatchObject({ make: "Testo", model: "174H" });
    expect(plan.instruments[0]!.modelKey).toBe("testo|174h");
    expect(plan.models).toEqual([]);
  });
});

describe("readings copied from another certificate", () => {
  it("are flagged before they are recorded", () => {
    const codes = ["E1", "E2", "E3", "E4", "E5", "E6"];
    const base = {
      sheet: "s",
      validUntil: null,
      customerName: "",
      customerAddress: "",
      location: "",
      department: "",
      equipmentName: "Portable Datalogger",
      make: "Elitech",
      model: "RC-4PRO",
      rangeText: "",
      resolutionText: "",
      sopNo: "",
      conditionOnReceipt: "",
      accuracyText: "",
      environmentTemperature: "",
      environmentHumidity: "",
      masters: [],
      points: [
        { quantity: "temperature" as const, reference: "-20.1", condition: "" },
        { quantity: "temperature" as const, reference: "15.07", condition: "" },
      ],
      instruments: codes.map((code, i) => ({ code, serialNo: `EF72000${i}` })),
      readings: [
        ["-20.2", "-20.3", "-20.1", "-20.1", "-20.2", "-20.1"],
        ["15.1", "15.1", "15.2", "15.1", "15", "15.2"],
      ],
    };
    const prints = codes.map((_, ii) =>
      readingPrint(
        base.points.map((p, pi) => ({ reference: p.reference, reading: base.readings[pi]![ii]! })),
      ),
    );
    const plan = planInstrumentImport(
      {
        rows: [],
        workbookCertificates: [
          { ...base, number: "QATECH/BHIWANDI/08/26/PDL-01", calibratedOn: "2026-08-06" },
        ],
        problems: [],
      },
      { ...snapshot, readingPrints: [{ number: "QATECH/BHIWANDI/07/26/PDL-12", prints }] },
    );
    expect(plan.problems).toEqual([
      "QATECH/BHIWANDI/08/26/PDL-01: 6 of its 6 instruments read exactly what QATECH/BHIWANDI/07/26/PDL-12 reads, at every point. Check that these readings were measured, not copied from that sheet.",
    ]);
  });
});

describe("an ID that isn't one", () => {
  it("is skipped with the reason, never registered", () => {
    const plan = planInstrumentImport(
      { rows: [row({ code: "-25.2", serialNo: "" })], workbookCertificates: [], problems: [] },
      snapshot,
    );
    expect(plan.instruments).toEqual([]);
    expect(plan.skipped[0]!.reason).toMatch(/^“-25\.2” isn't a QA Tech ID/);
  });
});
