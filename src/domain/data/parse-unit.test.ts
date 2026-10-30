/**
 * The parser on QA Tech's real logger exports (fixtures/client, git-ignored;
 * skipped without them) and on messy hand-made grids.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fromCsv, readGrid } from "./grid";
import { parseWorkbook, readingOf, serialIn, type Cell, type Sheet } from "./parse";

const dir = path.resolve(__dirname, "../../../fixtures/client");
const has = (name: string) => existsSync(path.join(dir, name));
async function parseFile(name: string) {
  const g = await readGrid(readFileSync(path.join(dir, name)), name);
  if (!g.ok) throw new Error(g.error);
  const r = parseWorkbook(g.sheets);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const ist = (s: string) => new Date(`${s}+05:30`).getTime();
const stats = (v: (number | null)[]) => {
  const n = v.filter((x): x is number => x !== null);
  return {
    min: Math.min(...n),
    max: Math.max(...n),
    avg: Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10,
  };
};

describe.skipIf(!has("Dispensing-2 WH013.xlsx"))("WH013 (Glenmark Indore), as emailed", () => {
  it("reads 145 readings of 5 loggers + ambient, °C and %RH, from the Rawdata sheet", async () => {
    const { best } = await parseFile("Dispensing-2 WH013.xlsx");
    expect(best.sheet).toBe("Rawdata");
    expect(best.times).toHaveLength(145);
    expect(best.times[0]).toBe(ist("2026-09-13T18:00:00"));
    expect(best.times.at(-1)).toBe(ist("2026-09-14T18:00:00"));
    expect(best.channels.map((c) => `${c.serial}:${c.quantity}`)).toEqual([
      "83561878:temp",
      "83561878:rh",
      "83562086:temp",
      "83562086:rh",
      "83563766:temp",
      "83563766:rh",
      "83597943:temp",
      "83597943:rh",
      "83623686:temp",
      "83623686:rh",
      "84197505:temp",
      "84197505:rh",
    ]);
    expect(best.channels.filter((c) => c.ambient)).toHaveLength(2);
    expect(best.unreadable).toEqual([]);
    expect(best.badTimeRows).toEqual([]);
    expect(best.notes.join(" ")).toMatch(/Stopped at row \d+ \(“Minimum”\)/);
  });

  it("matches the sheet's own Minimum, Maximum and Average rows", async () => {
    const { best } = await parseFile("Dispensing-2 WH013.xlsx");
    // From the workbook's summary rows under the data.
    expect(stats(best.channels[0]!.values)).toEqual({ min: 22, max: 22.4, avg: 22.2 });
    expect(stats(best.channels[1]!.values)).toEqual({ min: 30.6, max: 34.6, avg: 32.1 });
    expect(stats(best.channels[10]!.values)).toEqual({ min: 23.8, max: 28.6, avg: 24.9 });
    expect(stats(best.channels[11]!.values)).toEqual({ min: 74.4, max: 93.7, avg: 88.4 });
  });
});

describe.skipIf(!has("pasted_raw_data.xlsx"))("WH013 pasted as text", () => {
  it("reads text dates, text times and text numbers the same way", async () => {
    const { best } = await parseFile("pasted_raw_data.xlsx");
    expect(best.times[0]).toBe(ist("2026-09-13T18:00:00"));
    expect(best.channels).toHaveLength(12);
    expect(best.channels[0]).toMatchObject({ serial: "83561878", quantity: "temp" });
    expect(best.channels[0]!.values[0]).toBe(22);
  });
});

describe.skipIf(!has("BE-WF-02 raw data.xlsx"))("BE-WF-02 (Watson walk-in freezer)", () => {
  it("reads 145 readings of 9 loggers matching page 5 of the issued report", async () => {
    const { best } = await parseFile("BE-WF-02 raw data.xlsx");
    expect(best.times).toHaveLength(145);
    expect(best.times[0]).toBe(ist("2026-05-22T22:30:00"));
    expect(best.channels.map((c) => c.serial)).toEqual([
      "62281257",
      "62230434",
      "62283621",
      "62220170",
      "62283645",
      "62273014",
      "62219287",
      "62283553",
      "62283563",
    ]);
    // Page 5: L-04 coldest on average, L-05 hottest.
    expect(stats(best.channels[3]!.values)).toEqual({ min: -23, max: -20, avg: -21.9 });
    expect(stats(best.channels[4]!.values)).toEqual({ min: -17.6, max: -15, avg: -16.7 });
  });
});

describe.skipIf(!has("Refrigerator_Temperature_Mapping_Raw_Data.xlsx"))(
  "refrigerator export",
  () => {
    it("skips the Sr. No. column, reads 20-Sep-2026 dates and names channels DL-01…", async () => {
      const { best } = await parseFile("Refrigerator_Temperature_Mapping_Raw_Data.xlsx");
      expect(best.sheet).toBe("24hr Continuous Raw Data");
      expect(best.times).toHaveLength(288);
      expect(best.times[1]! - best.times[0]!).toBe(5 * 60_000);
      expect(best.channels.map((c) => c.serial)).toEqual([
        "DL-01",
        "DL-02",
        "DL-03",
        "DL-04",
        "DL-05",
        "DL-06",
      ]);
      expect(best.channels[5]!.ambient).toBe(true);
      expect(best.notes.join(" ")).toMatch(/row number/);
    });
  },
);

describe("messy input", () => {
  const sheet = (rows: Cell[][]): Sheet[] => [{ name: "S", rows }];

  it("reads numbers with units and commas, and reports what it can't read", () => {
    const r = parseWorkbook(
      sheet([
        ["Date", "Time", "L-01 °C", "L-02 °C"],
        ["13.09.2026", "18:00", "22,4", "22.5 °C"],
        ["13.09.2026", "18:10", "Err", "22.6"],
        ["13.09.2026", "18:20", "22.6", ""],
        ["13.09.2026", "6:30 PM", "22.7", "22.8"],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.best.channels[0]!.values).toEqual([22.4, null, 22.6, 22.7]);
    expect(r.best.channels[1]!.values).toEqual([22.5, 22.6, null, 22.8]);
    expect(r.best.unreadable).toEqual([{ row: 3, column: 3, text: "Err" }]);
    expect(r.best.times[3]! - r.best.times[2]!).toBe(10 * 60_000);
  });

  it("reports a row whose time is unreadable instead of dropping it", () => {
    const r = parseWorkbook(
      sheet([
        ["Date & time", "62281257"],
        ["22.05.2026 22:30:00", -22.2],
        ["22.05.2026 22:40:00", -22.3],
        ["22.05.2026 22:50:00", -22.5],
        ["22.05.2026 25:00:00", -22.6],
        ["22.05.2026 23:10:00", -22.7],
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.best.times).toHaveLength(4);
    expect(r.best.badTimeRows).toEqual([{ row: 5, text: "22.05.2026 25:00:00" }]);
  });

  it("reads month-first dates when the day is over 12, and Excel serial numbers", () => {
    const r = parseWorkbook(
      sheet([
        ["When", "T1"],
        [46278.75, 5.1],
        [46278.756944444, 5.2],
        [46278.763888889, 5.3],
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.best.times[0]).toBe(ist("2026-09-13T18:00:00"));
    expect(r.best.times[1]! - r.best.times[0]!).toBe(10 * 60_000);
  });

  it("refuses a sheet with no readings, saying why", () => {
    const r = parseWorkbook(sheet([["Report"], ["Customer", "Watson"]]));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("No readings found") });
  });

  it("reads CSV with semicolons and quotes", () => {
    const s = fromCsv(
      '"Date";"Time";"84028189 °C";"84028189 %RH"\n06.11.2026;10:00;-20,1;45\n06.11.2026;10:10;-20,2;46\n06.11.2026;10:20;-20,3;47\n',
    );
    const r = parseWorkbook([s]);
    if (!r.ok) throw new Error(r.error);
    expect(r.best.channels.map((c) => [c.serial, c.quantity, c.values[0]])).toEqual([
      ["84028189", "temp", -20.1],
      ["84028189", "rh", 45],
    ]);
  });

  it("finds serials and codes in headers", () => {
    expect(serialIn("Ambient (84197505)")).toBe("84197505");
    expect(serialIn("DL-01 (°C) Top Front L")).toBe("DL-01");
    expect(serialIn("SN-100234")).toBe("100234");
    expect(readingOf("−21.6").value).toBe(-21.6);
    expect(readingOf("---")).toEqual({ value: null, unreadable: false });
  });
});
