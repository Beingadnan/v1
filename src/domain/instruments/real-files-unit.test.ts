/**
 * QA Tech's real instrument files, read as they are. They live in
 * fixtures/client/instruments (git-ignored: client data is never committed);
 * without them these tests are skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deviation } from "./calibration-math";
import {
  planInstrumentImport,
  planSummary,
  readInstrumentList,
  type Snapshot,
} from "./instrument-import";

const dir = path.resolve(__dirname, "../../../fixtures/client/instruments");
const file = (name: string) => path.join(dir, name);
const has = (name: string) => existsSync(file(name));
const read = (name: string) => readInstrumentList(new Uint8Array(readFileSync(file(name))));
const snapshot: Snapshot = {
  models: [
    { id: "ebro", make: "ebro", model: "EBI 20-TH1" },
    { id: "testo", make: "Testo", model: "174H" },
  ],
  instruments: [],
  certificates: [],
  sites: [{ id: "bhw", code: "BHW", name: "Bhiwandi" }],
  labName: "QA Tech",
};

describe.skipIf(!has("TRH-3601 to TRH-3620.xlsx"))("FT-05 workbook TRH-3601 to TRH-3620", () => {
  it("reads the certificate with all 120 readings, exactly", async () => {
    const r = await read("TRH-3601 to TRH-3620.xlsx");
    const [c] = r.workbookCertificates;
    expect(c).toMatchObject({
      number: "QATECH/BHIWANDI/07/26/PDL-01",
      calibratedOn: "2026-07-06",
      validUntil: "2027-07-05",
      make: "Testo",
      model: "174H",
      sopNo: "QATECH/CAL-026",
      environmentTemperature: "22 °C",
    });
    expect(c!.instruments[0]).toEqual({ code: "TRH-3601", serialNo: "84028189" });
    expect(c!.instruments).toHaveLength(20);
    expect(c!.readings.flat().filter(Boolean)).toHaveLength(120);
    expect(c!.masters.map((m) => m.certificateNo)).toEqual([
      "ARAI/CAL/2508/2925",
      "SAN/25/1165/TH/1",
    ]);
    // Excel shows -0.09499999999999886; the exact deviation is -0.095.
    expect(deviation(c!.readings[0]![0]!, c!.points[0]!.reference)).toBe("-0.095");
  });
});

describe.skipIf(!has("TRH-001 To TRH-040.xlsx"))(
  "FT-05 workbook TRH-001 To TRH-040 (Sri Lanka)",
  () => {
    it("follows the uncalculated date formula on later sheets and joins PDL-02 over two sheets", async () => {
      const plan = planInstrumentImport(await read("TRH-001 To TRH-040.xlsx"), snapshot, {
        defaultType: "portable_logger",
        assign: { prefix: "E-TRH", modelId: "ebro" },
      });
      expect(plan.fullCertificates.map((c) => [c.number, c.calibratedOn, c.codes.length])).toEqual([
        ["QATECH/BHIWANDI/09/26/PDL-01", "2026-09-01", 20],
        ["QATECH/BHIWANDI/09/26/PDL-02", "2026-09-01", 30],
      ]);
      expect(planSummary(plan)).toMatchObject({ idsGiven: 50, readings: 300, models: 0 });
    });
  },
);

describe.skipIf(!has("24.08.2026  calibration certificate Zydus Ambernath.xlsx"))(
  "Zydus PDL-18",
  () => {
    it("is one certificate of 25 loggers over two sheets", async () => {
      const plan = planInstrumentImport(
        await read("24.08.2026  calibration certificate Zydus Ambernath.xlsx"),
        snapshot,
        {
          defaultType: "portable_logger",
          assign: { prefix: "T-TRH", modelId: "testo" },
        },
      );
      expect(plan.fullCertificates).toHaveLength(1);
      expect(plan.fullCertificates[0]).toMatchObject({ number: "QATECH/BHIWANDI/08/26/PDL-18" });
      expect(plan.fullCertificates[0]!.codes).toHaveLength(25);
    });
  },
);

describe.skipIf(!has("08.05.2026 QATECH  YEARLY Calibration certificate (TC-K type)  TC-001.xlsx"))(
  "TC-001",
  () => {
    it("reads 30 thermocouples with °C points only, ignoring Excel's working cells", async () => {
      const r = await read(
        "08.05.2026 QATECH  YEARLY Calibration certificate (TC-K type)  TC-001.xlsx",
      );
      const plan = planInstrumentImport(r, snapshot, { defaultType: "thermocouple" });
      expect(plan.fullCertificates[0]!.codes).toHaveLength(30);
      expect(plan.fullCertificates[0]!.points.map((p) => p.reference)).toEqual([
        "50.006",
        "100.057",
        "150.098",
        "200.01",
        "250.08",
        "400.02",
      ]);
    });
  },
);

describe.skipIf(!has("new data logger serial.xlsx"))("serial lists", () => {
  it("reads an 'Id No' column of model names as the model, not as IDs", async () => {
    const r = await read("new data logger serial.xlsx");
    expect(r.problems.join(" ")).toMatch(/repeats “EBI 20-T1”/);
    const plan = planInstrumentImport(r, snapshot, { defaultType: "portable_logger" });
    expect(plan.instruments).toHaveLength(0);
    expect(plan.unassigned.length).toBeGreaterThan(100);
  });

  it.skipIf(!has("SRI LANKA DATA LIST.xlsx"))(
    "finds the serial column of a sheet with no headings",
    async () => {
      const r = await read("SRI LANKA DATA LIST.xlsx");
      expect(r.problems.join(" ")).toMatch(/column B was read as serial numbers/);
      expect(planInstrumentImport(r, snapshot).unassigned).toHaveLength(50);
    },
  );
});

describe.skipIf(!has("All site portable datalogger lis Baddi.xlsx"))("Baddi list", () => {
  it("still imports 184 loggers and 16 certificates", async () => {
    const plan = planInstrumentImport(
      await read("All site portable datalogger lis Baddi.xlsx"),
      snapshot,
    );
    expect(planSummary(plan)).toMatchObject({ instruments: 184, certificates: 16, unassigned: 9 });
  });
});
