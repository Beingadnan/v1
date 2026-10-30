import { describe, expect, it } from "vitest";

import {
  BOX_EDGES,
  describe as where,
  label,
  mm,
  nextEmpty,
  parseRoomSize,
  projector,
  templateLayout,
} from "./layout";
import { evaluatePrecal } from "./precal";
import { markersFor } from "./types";

describe("templateLayout", () => {
  it("lays 9 loggers at the eight corners and the centre, like BE-WF-02", () => {
    const pts = templateLayout(9);
    expect(pts.map((p) => p.label)).toEqual([
      "L-01",
      "L-02",
      "L-03",
      "L-04",
      "L-05",
      "L-06",
      "L-07",
      "L-08",
      "L-09",
    ]);
    expect(pts[0]).toMatchObject({ x: 0.1, y: 0.1, z: 0.1, note: "Bottom front left corner" });
    expect(pts[7]).toMatchObject({ x: 0.9, y: 0.9, z: 0.9, note: "Top back right corner" });
    expect(pts[8]).toMatchObject({ x: 0.5, y: 0.5, z: 0.5, note: "Middle level, centre" });
    // No two points in the same place.
    expect(new Set(pts.map((p) => `${p.x},${p.y},${p.z}`)).size).toBe(9);
  });

  it("adds wall centres for 15 and uses the WHO grid for a room of that count", () => {
    const fifteen = templateLayout(15);
    expect(fifteen).toHaveLength(15);
    expect(fifteen.filter((p) => p.note.endsWith("wall"))).toHaveLength(4);
    // WH013: 12 × 8 × 4 m → 4 × 3 grid at 3 levels = 36.
    const room = templateLayout(36, { lengthM: 12, widthM: 8, heightM: 4 });
    expect(room).toHaveLength(36);
    expect(new Set(room.map((p) => p.z)).size).toBe(3);
    expect(room[0]!.z).toBeCloseTo(0.3 / 4, 3);
  });

  it("spreads any other count over levels and never returns more than asked", () => {
    for (const n of [1, 4, 5, 6, 12, 20, 40]) {
      const pts = templateLayout(n);
      expect(pts).toHaveLength(n);
      for (const p of pts) for (const v of [p.x, p.y, p.z]) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(templateLayout(0)).toEqual([]);
    expect(templateLayout(5)[0]!.note).toBe("Front left corner");
  });
});

describe("helpers", () => {
  it("labels, sizes and next empty position", () => {
    expect([label(1), label(12)]).toEqual(["L-01", "L-12"]);
    expect([mm(3.36), mm(null)]).toEqual(["3360 mm", "—"]);
    expect(where({ x: 0.5, y: 0.1, z: 0.9 })).toBe("Top front wall");
    const pos = [
      { sort: 2, instrumentId: null },
      { sort: 1, instrumentId: "a" },
      { sort: 3, instrumentId: null },
    ];
    expect(nextEmpty(pos)?.sort).toBe(2);
    expect(nextEmpty([{ sort: 1, instrumentId: "a" }])).toBeNull();
  });

  it("draws the box inside the frame", () => {
    const p = projector(
      { lengthM: 3.36, widthM: 6.4, heightM: 2.4 },
      { width: 400, height: 300, margin: 20 },
    );
    for (const [a, b] of BOX_EDGES) {
      for (const q of [p(a), p(b)]) {
        expect(q.x).toBeGreaterThanOrEqual(19.9);
        expect(q.x).toBeLessThanOrEqual(380.1);
        expect(q.y).toBeGreaterThanOrEqual(19.9);
        expect(q.y).toBeLessThanOrEqual(280.1);
      }
    }
    // The front bottom-left corner is left of and below the back top-right one.
    expect(p({ x: 0, y: 0, z: 0 }).x).toBeLessThan(p({ x: 1, y: 1, z: 1 }).x);
    expect(p({ x: 0, y: 0, z: 0 }).y).toBeGreaterThan(p({ x: 1, y: 1, z: 1 }).y);
  });

  it("offers each cycle's markers in order", () => {
    expect(markersFor("door_open")).toEqual(["start", "door_opened", "door_closed", "end"]);
    expect(markersFor("routine")).toEqual(["start", "end"]);
  });
});

describe("evaluatePrecal", () => {
  const spec = { temperature: { tolerance: 0.8, bands: [{ from: -20, to: 40, tolerance: 0.5 }] } };
  it("passes and fails on the logger's accuracy, exactly", () => {
    expect(
      evaluatePrecal({
        reference: "0.02",
        reading: "0.52",
        quantity: "temperature",
        accuracy: spec,
      }),
    ).toMatchObject({
      ok: true,
      deviation: "0.50",
      tolerance: 0.5,
      result: "pass",
    });
    expect(
      evaluatePrecal({
        reference: "-25.1",
        reading: "-24.2",
        quantity: "temperature",
        accuracy: spec,
      }),
    ).toMatchObject({
      tolerance: 0.8,
      result: "fail",
    });
  });

  it("uses ±0.5 °C without an accuracy and catches typing slips", () => {
    expect(
      evaluatePrecal({
        reference: "-24.0 °C",
        reading: "-24,3",
        quantity: "temperature",
        accuracy: null,
      }),
    ).toMatchObject({
      result: "pass",
      tolerance: 0.5,
    });
    expect(
      evaluatePrecal({
        reference: "-24.0",
        reading: "24.1",
        quantity: "temperature",
        accuracy: null,
      }),
    ).toEqual({
      ok: false,
      message: expect.stringContaining("minus sign"),
    });
    expect(
      evaluatePrecal({ reference: "", reading: "1", quantity: "temperature", accuracy: null }),
    ).toEqual({
      ok: false,
      message: "Enter the master's reading.",
    });
  });
});

describe("parseRoomSize", () => {
  it("reads sizes as people type them", () => {
    const m = { ok: true, lengthM: 3.36, widthM: 6.4, heightM: 2.4 };
    expect(parseRoomSize("3.36 x 6.4 x 2.4")).toEqual(m);
    expect(parseRoomSize("3.36m × 6.4m × 2.4m")).toEqual(m);
    expect(parseRoomSize("3360 x 6400 x 2400 mm")).toEqual(m);
    expect(parseRoomSize("336*640*240 cm")).toEqual(m);
    expect(parseRoomSize("3,36 X 6,4 X 2,4")).toEqual(m);
    expect(parseRoomSize("3.36 by 6.4 by 2.4 m")).toEqual(m);
  });
  it("explains what it can't read", () => {
    expect(parseRoomSize("")).toMatchObject({ ok: false });
    expect(parseRoomSize("3.36 x 6.4")).toMatchObject({
      ok: false,
      error: expect.stringContaining("three"),
    });
    expect(parseRoomSize("3.36 x abc x 2")).toMatchObject({
      ok: false,
      error: expect.stringContaining("abc"),
    });
    expect(parseRoomSize("3360 x 6400 x 2400")).toMatchObject({
      ok: false,
      error: expect.stringContaining("mm"),
    });
    expect(parseRoomSize("0 x 1 x 1")).toMatchObject({ ok: false });
  });
});
