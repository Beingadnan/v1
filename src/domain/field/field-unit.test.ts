import { describe, expect, it } from "vitest";

import { equipmentTypeFromText, isArea } from "@/domain/clients/equipment-types";
import { roomWalls, suggestLoggerCount } from "@/domain/clients/study-defaults";

import {
  BOX_EDGES,
  describe as where,
  describeRoom,
  label,
  mm,
  nextEmpty,
  orbitProjector,
  parseRoomSize,
  planProjector,
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

describe("rooms mapped as areas (QA Tech, Nov 2026)", () => {
  it("knows rooms and stores are areas, from the words people use", () => {
    expect(isArea("room")).toBe(true);
    expect(isArea("warehouse")).toBe(true);
    expect(isArea("cold_room")).toBe(false);
    expect(isArea("autoclave")).toBe(false);
    expect(equipmentTypeFromText("Dispensing area")).toBe("room");
    expect(equipmentTypeFromText("Sampling booth")).toBe("room");
  });

  it("suggests a logger every ~5 m along each wall and one in the centre", () => {
    // WH013, Dispensing-2: about 6 × 4 m, five loggers plus the ambient.
    expect(roomWalls(6, 4)).toEqual([1, 1, 1, 1]);
    expect(suggestLoggerCount({ lengthM: 6, widthM: 4, heightM: 3 }, "room")).toMatchObject({
      count: 5,
    });
    expect(roomWalls(16, 9)).toEqual([3, 2, 3, 2]);
    expect(suggestLoggerCount({ lengthM: 16, widthM: 9, heightM: null }, "room")?.count).toBe(11);
    expect(suggestLoggerCount({ lengthM: 6, widthM: null, heightM: 3 }, "room")).toBeNull();
  });

  it("lays the loggers at working height on walls 1 to 4, then the centre", () => {
    const pts = templateLayout(5, { lengthM: 6, widthM: 4, heightM: 2.5 }, { room: true });
    expect(pts.map((p) => p.note)).toEqual([
      "Working height on wall-1",
      "Working height on wall-2",
      "Working height on wall-3",
      "Working height on wall-4",
      "Working height, centre of the room",
    ]);
    expect(pts.every((p) => p.z === 0.4)).toBe(true);
    expect(pts[0]).toMatchObject({ x: 0.5, y: 0.1 });
    expect(pts[1]).toMatchObject({ x: 0.9, y: 0.5 });
    // Another count is shared by wall length, longer walls first.
    const seven = templateLayout(7, { lengthM: 12, widthM: 4, heightM: 3 }, { room: true });
    expect(seven).toHaveLength(7);
    expect(seven.filter((p) => p.note.endsWith("wall-1"))).toHaveLength(2);
    expect(seven.filter((p) => p.note.endsWith("wall-3"))).toHaveLength(2);
    expect(seven.at(-1)!.note).toBe("Working height, centre of the room");
    expect(templateLayout(3, { lengthM: 6, widthM: 4, heightM: 3 }, { room: true })).toHaveLength(
      3,
    );
  });

  it("describes a moved point by its wall and height", () => {
    expect(describeRoom({ x: 0.5, y: 0.05, z: 0.4 }, 2.5)).toBe("Working height on wall-1");
    expect(describeRoom({ x: 0.05, y: 0.05, z: 0.4 }, 2.5)).toBe(
      "Working height on corner of wall-1 & wall-4",
    );
    expect(describeRoom({ x: 0.5, y: 0.5, z: 0.95 }, 3)).toBe(
      "Near the ceiling, centre of the room",
    );
    expect(describeRoom({ x: 0.95, y: 0.5, z: 0.6 }, 3)).toBe("At 1.8 m on wall-2");
  });
});

describe("orbitProjector", () => {
  const dims = { lengthM: 4, widthM: 2, heightM: 2 };
  const frame = { width: 400, height: 400, margin: 20 };
  it("looks at the front from the side, and down from the top", () => {
    const front = orbitProjector(dims, { yaw: 0, pitch: 0 }, frame);
    // Front and back corners line up; the top is higher on screen.
    expect(front({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(front({ x: 0, y: 1, z: 0 }).x);
    expect(front({ x: 0, y: 0, z: 1 }).y).toBeLessThan(front({ x: 0, y: 0, z: 0 }).y);
    expect(front({ x: 0, y: 1, z: 0 }).depth).toBeGreaterThan(front({ x: 0, y: 0, z: 0 }).depth);
    const top = orbitProjector(dims, { yaw: 0, pitch: 90 }, frame);
    // From the top, floor and ceiling of a corner coincide; the back is up the screen.
    expect(top({ x: 1, y: 0, z: 0 }).y).toBeCloseTo(top({ x: 1, y: 0, z: 1 }).y);
    expect(top({ x: 0, y: 1, z: 0 }).y).toBeLessThan(top({ x: 0, y: 0, z: 0 }).y);
  });
  it("keeps every corner inside the frame from any side", () => {
    for (const yaw of [0, 35, 90, 200]) {
      for (const pitch of [0, 30, 90]) {
        const at = orbitProjector(dims, { yaw, pitch }, frame);
        for (const [a] of BOX_EDGES) {
          const q = at(a);
          expect(q.x).toBeGreaterThanOrEqual(0);
          expect(q.x).toBeLessThanOrEqual(400);
          expect(q.y).toBeGreaterThanOrEqual(0);
          expect(q.y).toBeLessThanOrEqual(400);
        }
      }
    }
  });
});

describe("planProjector", () => {
  it("draws the room true to its proportions, wall-1 at the bottom", () => {
    const { rect, at } = planProjector(
      { lengthM: 12, widthM: 4, heightM: 3 },
      { width: 480, height: 320, margin: 40 },
    );
    expect(rect.w / rect.h).toBeCloseTo(3);
    expect(rect.x).toBeGreaterThanOrEqual(40);
    expect(at({ x: 0, y: 0 })).toEqual({ x: rect.x, y: rect.y + rect.h });
    expect(at({ x: 1, y: 1 })).toEqual({ x: rect.x + rect.w, y: rect.y });
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
