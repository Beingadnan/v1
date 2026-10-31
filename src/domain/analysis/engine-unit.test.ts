/**
 * The analysis engine: golden tests on QA Tech's issued numbers (fixtures/client,
 * git-ignored; skipped without them) and hand-made series for the rules.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readGrid } from "../data/grid";
import { parseWorkbook } from "../data/parse";
import {
  analyse,
  DEFAULT_CONSTANTS,
  ENGINE_VERSION,
  excursionsOf,
  f0,
  hotCold,
  mkt,
  type EngineInput,
  type Series,
  type Stats,
} from "./engine";

const dir = path.resolve(__dirname, "../../../fixtures/client");
const has = (name: string) => existsSync(path.join(dir, name));
const r1 = (v: number) => Math.round(v * 10) / 10;
const MIN = 60_000;
const T0 = Date.UTC(2026, 4, 22, 17, 0);

async function seriesFrom(name: string, label: (i: number) => string): Promise<Series[]> {
  const g = await readGrid(readFileSync(path.join(dir, name)), name);
  if (!g.ok) throw new Error(g.error);
  const r = parseWorkbook(g.sheets);
  if (!r.ok) throw new Error(r.error);
  const serials = [...new Set(r.best.channels.map((c) => c.serial))];
  return r.best.channels.map((c) => ({
    positionId: c.serial!,
    label: label(serials.indexOf(c.serial)),
    ambient: c.ambient,
    quantity: c.quantity,
    logger: { code: c.serial!, serialNo: c.serial! },
    times: r.best.times,
    values: c.values,
  }));
}

function input(series: Series[], over: Partial<EngineInput> = {}): EngineInput {
  const all = series.flatMap((s) => s.times);
  return {
    series,
    windows: [
      {
        cycle: "empty",
        label: "Empty",
        start: Math.min(...all),
        end: Math.max(...all),
        markers: [],
      },
    ],
    limits: { tempMin: null, tempMax: null, rhMin: null, rhMax: null },
    constants: DEFAULT_CONSTANTS,
    thermal: false,
    excluded: [],
    ...over,
  };
}

function line(id: string, values: number[], o: Partial<Series> = {}): Series {
  return {
    positionId: id,
    label: id,
    ambient: false,
    quantity: "temp",
    logger: null,
    times: values.map((_, i) => T0 + i * MIN),
    values,
    ...o,
  };
}

describe.skipIf(!has("BE-WF-02 raw data.xlsx"))("BE-WF-02 golden (report page 5)", () => {
  const PAGE5: [string, number, number, number][] = [
    ["L-01", -22.9, -17.9, -21.0],
    ["L-02", -23.4, -18.7, -21.8],
    ["L-03", -22.8, -18.5, -21.7],
    ["L-04", -23.0, -20.0, -21.9],
    ["L-05", -17.6, -15.0, -16.7],
    ["L-06", -21.9, -19.0, -21.1],
    ["L-07", -23.0, -17.8, -21.1],
    ["L-08", -23.3, -15.0, -19.7],
    ["L-09", -22.9, -18.7, -21.3],
  ];

  it("matches every minimum, maximum and average, L-05 hot and L-04 cold", async () => {
    const s = await seriesFrom("BE-WF-02 raw data.xlsx", (i) => `L-0${i + 1}`);
    const res = analyse(
      input(s, { limits: { tempMin: -25, tempMax: -15, rhMin: null, rhMax: null } }),
    );
    const c = res.cycles[0]!;
    expect(
      c.positions.map((p) => [p.label, r1(p.temp!.min), r1(p.temp!.max), r1(p.temp!.avg)]),
    ).toEqual(PAGE5);
    expect(c.hot).toMatchObject({ label: "L-05" });
    expect(r1(c.hot!.avg)).toBe(-16.7);
    expect(c.cold).toMatchObject({ label: "L-04" });
    expect(r1(c.cold!.avg)).toBe(-21.9);
    // The single highest reading is at L-08, which is not the hot spot.
    expect(c.highest).toMatchObject({ value: -15 });
    expect(c.pass).toBe(true);
    expect(res.version).toBe(ENGINE_VERSION);
  });

  it("drops a position from hot/cold and pass/fail when it is excluded", async () => {
    const s = await seriesFrom("BE-WF-02 raw data.xlsx", (i) => `L-0${i + 1}`);
    const l05 = s[4]!.positionId;
    const res = analyse(input(s, { excluded: [{ positionId: l05, reason: "Failed post-cal" }] }));
    const c = res.cycles[0]!;
    expect(c.hot!.label).toBe("L-08");
    expect(c.positions[4]!.excluded).toBe("Failed post-cal");
    expect(res.notes.join(" ")).toMatch(/L-05 left out: Failed post-cal/);
  });
});

describe.skipIf(!has("Dispensing-2 WH013.xlsx"))("WH013 golden (workbook summary rows)", () => {
  it("matches the Minimum, Maximum and Average rows; ambient is not judged", async () => {
    const s = await seriesFrom("Dispensing-2 WH013.xlsx", (i) => `P-${i + 1}`);
    const res = analyse(input(s, { limits: { tempMin: 15, tempMax: 25, rhMin: null, rhMax: 60 } }));
    const c = res.cycles[0]!;
    const first = c.positions.find((p) => p.positionId === "83561878")!;
    expect([first.temp!.min, first.temp!.max, Number(first.temp!.avg.toFixed(2))]).toEqual([
      22, 22.4, 22.19,
    ]);
    expect([first.rh!.min, first.rh!.max, Number(first.rh!.avg.toFixed(2))]).toEqual([
      30.6, 34.6, 32.12,
    ]);
    const amb = c.positions.find((p) => p.ambient)!;
    expect([amb.temp!.min, amb.temp!.max, Number(amb.temp!.avg.toFixed(2))]).toEqual([
      23.8, 28.6, 24.88,
    ]);
    expect([amb.rh!.min, amb.rh!.max, Number(amb.rh!.avg.toFixed(2))]).toEqual([74.4, 93.7, 88.44]);
    expect(amb.pass).toBeNull();
    // Ambient RH 93.7 is over 60 but doesn't make an excursion.
    expect(c.excursions.filter((e) => e.positionId === amb.positionId)).toEqual([]);
    // Per-reading MKT is never below the mean; for a steady room it is within 0.01.
    expect(first.temp!.mkt!).toBeGreaterThanOrEqual(first.temp!.avg);
    expect(first.temp!.mkt! - first.temp!.avg).toBeLessThan(0.01);
  });
});

describe("MKT", () => {
  it("equals the temperature when it is steady", () => {
    expect(mkt([25, 25, 25])).toBeCloseTo(25, 9);
  });
  it("weights warm readings: 15 and 30 °C give 25.2, 2.7 over the mean", () => {
    // Checked independently in Python: 25.2242.
    expect(mkt([15, 30])!).toBeCloseTo(25.2242, 3);
  });
  it("a daily swing of 15–30 °C gives about 1.4 °C over the mean", () => {
    const v = Array.from(
      { length: 96 },
      (_, i) => 15 + 7.5 * (1 + Math.sin((2 * Math.PI * i) / 96)),
    );
    expect(mkt(v)!).toBeCloseTo(23.946, 2);
  });
  it("is null without readings", () => expect(mkt([])).toBeNull());
});

describe("F0", () => {
  it("is one minute per minute at 121.1 °C", () => {
    const pts = Array.from({ length: 16 }, (_, i) => ({ at: i * MIN, value: 121.1 }));
    expect(f0(pts)).toBeCloseTo(15, 9);
  });
  it("is a tenth as much 10 °C lower (z = 10)", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ at: i * MIN, value: 111.1 }));
    expect(f0(pts)).toBeCloseTo(1, 9);
  });
  it("needs two readings", () => expect(f0([{ at: 0, value: 121 }])).toBeNull());
});

describe("hot and cold spots", () => {
  const st = (avg: number, min: number, max: number): Stats => ({
    count: 1,
    min,
    max,
    avg,
    minAt: 0,
    maxAt: 0,
    mkt: null,
  });
  it("in a tie at one decimal, the unrounded average decides", () => {
    const r = hotCold([
      { positionId: "a", label: "A", temp: st(5.04, 2, 8) },
      { positionId: "b", label: "B", temp: st(5.01, 2, 9) },
    ]);
    expect(r.hot!.label).toBe("A");
    expect(r.cold!.label).toBe("B");
  });
  it("then the higher maximum (hot) and lower minimum (cold), then position order", () => {
    const r = hotCold([
      { positionId: "a", label: "A", temp: st(5, 2, 8) },
      { positionId: "b", label: "B", temp: st(5, 1, 9) },
      { positionId: "c", label: "C", temp: st(5, 1, 9) },
    ]);
    expect(r.hot!.label).toBe("B");
    expect(r.cold!.label).toBe("B");
  });
});

describe("excursions", () => {
  it("groups consecutive readings beyond one limit into one event", () => {
    const s = line("a", [5, 9, 9.5, 8, 5, 1, 5]);
    const ex = excursionsOf(
      s,
      s.times.map((at, i) => ({ at, value: s.values[i]! })),
      2,
      8,
      MIN,
    );
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ side: "high", readings: 2, peak: 9.5, minutes: 2, limit: 8 });
    expect(ex[1]).toMatchObject({ side: "low", readings: 1, peak: 1, minutes: 1 });
  });
  it("makes a position fail and the cycle fail", () => {
    const res = analyse(
      input([line("a", [5, 9, 5]), line("b", [5, 5, 5])], {
        limits: { tempMin: 2, tempMax: 8, rhMin: null, rhMax: null },
      }),
    );
    const c = res.cycles[0]!;
    expect(c.positions.map((p) => p.pass)).toEqual([false, true]);
    expect(c.pass).toBe(false);
    expect(c.excursions).toHaveLength(1);
  });
  it("gives no verdict without limits", () => {
    expect(analyse(input([line("a", [5, 9])])).cycles[0]!.pass).toBeNull();
  });
});

describe("windows, door and power", () => {
  const limits = { tempMin: 2, tempMax: 8, rhMin: null, rhMax: null };
  it("splits results by the cycle windows recorded on site", () => {
    const s = line("a", [4, 4, 4, 6, 6, 6]);
    const res = analyse(
      input([s], {
        windows: [
          { cycle: "empty", label: "Empty", start: T0, end: T0 + 2 * MIN, markers: [] },
          { cycle: "loaded", label: "Loaded", start: T0 + 3 * MIN, end: T0 + 5 * MIN, markers: [] },
        ],
      }),
    );
    expect(res.cycles.map((c) => c.positions[0]!.temp!.avg)).toEqual([4, 6]);
  });

  it("times recovery after the door closes, from the last position back in limits", () => {
    const res = analyse(
      input([line("a", [5, 9, 10, 9, 7, 5]), line("b", [5, 8, 9, 7, 6, 5])], {
        limits,
        windows: [
          {
            cycle: "door",
            label: "Door open",
            start: T0,
            end: T0 + 5 * MIN,
            markers: [
              { kind: "door_opened", at: T0 + MIN },
              { kind: "door_closed", at: T0 + 2 * MIN },
            ],
          },
        ],
      }),
    );
    expect(res.cycles[0]!.door).toEqual([
      { openedAt: T0 + MIN, closedAt: T0 + 2 * MIN, peak: 10, recoveryMinutes: 2 },
    ]);
  });

  it("times holdover from power off to the first reading out, and recovery after power on", () => {
    const res = analyse(
      input([line("a", [5, 6, 7, 8.5, 9, 7, 5])], {
        limits,
        windows: [
          {
            cycle: "power",
            label: "Power failure",
            start: T0,
            end: T0 + 6 * MIN,
            markers: [
              { kind: "power_off", at: T0 + MIN },
              { kind: "power_on", at: T0 + 4 * MIN },
            ],
          },
        ],
      }),
    );
    expect(res.cycles[0]!.power).toEqual([
      {
        offAt: T0 + MIN,
        onAt: T0 + 4 * MIN,
        holdoverMinutes: 2,
        heldThroughout: false,
        recoveryMinutes: 1,
      },
    ]);
  });

  it("works out F0 per position over the hold, and the minimum", () => {
    const hold = (v: number) => [100, ...Array(11).fill(v), 100];
    const res = analyse(
      input([line("a", hold(121.1)), line("b", hold(111.1))], {
        thermal: true,
        windows: [
          {
            cycle: "thermal",
            label: "Cycle 1",
            start: T0,
            end: T0 + 12 * MIN,
            markers: [
              { kind: "hold_start", at: T0 + MIN },
              { kind: "hold_end", at: T0 + 11 * MIN },
            ],
          },
        ],
      }),
    );
    const c = res.cycles[0]!;
    expect(c.positions[0]!.f0).toBeCloseTo(10, 6);
    expect(c.hold!.minF0!.label).toBe("b");
    expect(c.hold!.minF0!.value).toBeCloseTo(1, 6);
  });

  it("says so when a thermal cycle has no hold times", () => {
    const res = analyse(input([line("a", [120, 121])], { thermal: true }));
    expect(res.notes.join(" ")).toMatch(/no hold start and end/);
  });
});

describe("impact recalculation", () => {
  it("applies the post-cal error and can change the verdict", () => {
    const s = [line("a", [7.6, 7.8, 7.7])];
    const limits = { tempMin: 2, tempMax: 8, rhMin: null, rhMax: null };
    expect(analyse(input(s, { limits })).cycles[0]!.pass).toBe(true);
    // The logger read 0.5 low at post-cal: true values were 0.5 higher.
    const res = analyse(
      input(s, { limits, corrections: [{ positionId: "a", quantity: "temp", offset: -0.5 }] }),
    );
    expect(res.cycles[0]!.pass).toBe(false);
    expect(res.notes.join(" ")).toMatch(/a corrected by \+0.5/);
  });
});
