import { describe, expect, it } from "vitest";

import { applyPaste, parseClipboard } from "./paste";

const instruments = [
  { code: "TRH-3601", serialNo: "84028189" },
  { code: "TRH-3602", serialNo: "84028227" },
  { code: "TRH-3603", serialNo: "84028248" },
];
const empty = () => [
  ["", "", ""],
  ["", "", ""],
];
const base = { instruments, grid: empty(), references: ["-20.105", "15.12"] };

describe("pasting readings", () => {
  it("drops units and fixes comma decimals and the Unicode minus", () => {
    const r = applyPaste({
      ...base,
      text: "-20.2 °C\t−20,3 °C\t-20.1°C",
      at: { point: 0, column: 0 },
    });
    expect(r.grid[0]).toEqual(["-20.2", "-20.3", "-20.1"]);
    expect(r.placed).toBe(3);
  });

  it("uses a copied header row of serials to put each column under its logger", () => {
    // Columns in a different order than the grid; the serial row is not a reading.
    const text = "84028248\t84028189\t84028227\n-20.1\t-20.2\t-20.3\n15.3\t15.2\t15.1";
    const r = applyPaste({ ...base, text, at: { point: 0, column: 0 } });
    expect(r.byHeader).toBe(true);
    expect(r.grid).toEqual([
      ["-20.2", "-20.3", "-20.1"],
      ["15.2", "15.1", "15.3"],
    ]);
  });

  it("reads an FT-05 block copied whole: ID/serial cells, labels and deviation rows", () => {
    const text = [
      'Sr. No.\t°C\t% RH\t"ID No.\nSerial No."\t"TRH-3601\n84028189"\t"TRH-3602\n84028227"\t"TRH-3603\n84028248"',
      "1\t-20.105\t-\tActual Output in °C\t-20.2\t-20.3\t-20.1",
      "1\t-20.105\t-\tDeviation °C\t-0.09499999999999886\t-0.19500000000000028\t0.004999999999999005",
      "2\t15.12\t@50\tActual Output in °C\t15.2\t15.1\t15.3",
    ].join("\n");
    const r = applyPaste({ ...base, text, at: { point: 0, column: 0 } });
    expect(r.byHeader).toBe(true);
    expect(r.skippedRows).toBe(1);
    expect(r.grid).toEqual([
      ["-20.2", "-20.3", "-20.1"],
      ["15.2", "15.1", "15.3"],
    ]);
  });

  it("pasted into the master column, fills the master reading and then the loggers", () => {
    const r = applyPaste({
      ...base,
      text: "-20.106\t-20.2\t-20.3\t-20.1\n15.121\t15.2",
      at: { point: 0, column: -1 },
    });
    expect(r.references).toEqual(["-20.106", "15.121"]);
    expect(r.grid).toEqual([
      ["-20.2", "-20.3", "-20.1"],
      ["15.2", "", ""],
    ]);
  });

  it("counts what doesn't fit instead of dropping it silently", () => {
    const r = applyPaste({ ...base, text: "1\t2\t3\t4\t5\n6\n7\n8", at: { point: 0, column: 1 } });
    expect(r.grid[0]).toEqual(["", "1", "2"]);
    expect(r.overflow).toBe(3 + 2);
  });

  it("keeps a value that is not a number so the screen can mark it", () => {
    const r = applyPaste({ ...base, text: "abc\t-20.3", at: { point: 0, column: 0 } });
    expect(r.grid[0]).toEqual(["abc", "-20.3", ""]);
  });

  it("parses Excel's clipboard text, including quoted cells with line breaks", () => {
    expect(parseClipboard('a\t"b\nc"\td\r\n1\t2\t3\r\n')).toEqual([
      ["a", "b\nc", "d"],
      ["1", "2", "3"],
    ]);
  });
});
