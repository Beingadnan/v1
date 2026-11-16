import { describe, expect, it } from "vitest";

import { openAiSketchReader, SketchReadError } from "@/lib/ai/sketch-reader";

import {
  layoutFromRoom,
  matchRoom,
  normaliseLabel,
  shapeOf,
  sketchReadingSchema,
  type SketchReading,
  type SketchRoom,
} from "./sketch";

const room = (patch: Partial<SketchRoom> = {}): SketchRoom => ({
  name: "5-ML-04 Sterilization",
  code: "5-ML-04",
  page: 1,
  kind: "room",
  orientation: "horizontal",
  length: 4,
  width: 3,
  height: 2.5,
  doors: [{ wall: "left", along: 0.3 }],
  objects: [
    { kind: "autoclave", label: "Autoclave", x: 0.8, y: 0.5, w: 0.5, d: 0.2, h: 0.5, shelves: 0 },
  ],
  sensors: [],
  ...patch,
});
const reading = (rooms: SketchRoom[] = [room()]): SketchReading => ({ rooms, notes: "" });
const s = (label: string, level: "top" | "middle" | "bottom", ambient = false) => ({
  label,
  level,
  x: 0.5,
  y: 0.5,
  ambient,
});

describe("layout sketches", () => {
  it("writes labels the way the app does", () => {
    expect(normaliseLabel("L1")).toBe("L-01");
    expect(normaliseLabel(" l-12 ")).toBe("L-12");
    expect(normaliseLabel("T 5")).toBe("L-05");
    expect(normaliseLabel("7")).toBe("L-07");
    expect(normaliseLabel("amb")).toBe("AMB");
  });

  it("makes the shape agree with standing or lying", () => {
    // Drawn standing but the sizes read lying down: the longest side becomes the height.
    expect(
      shapeOf({ kind: "box", orientation: "vertical", length: 1.8, width: 0.6, height: 0.7 }),
    ).toEqual({ length: 0.7, width: 0.6, height: 1.8 });
    expect(
      shapeOf({ kind: "box", orientation: "horizontal", length: 0.6, width: 0.6, height: 1.8 }),
    ).toEqual({ length: 1.8, width: 0.6, height: 0.6 });
    // No sizes: typical ones; one size: the others scaled to it.
    expect(
      shapeOf({ kind: "box", orientation: "vertical", length: 0, width: 0, height: 0 }),
    ).toEqual({ length: 0.8, width: 0.7, height: 1.9 });
    expect(
      shapeOf({ kind: "room", orientation: "horizontal", length: 8, width: 0, height: 0 }),
    ).toEqual({ length: 8, width: 6, height: 5.2 });
  });

  it("turns a drawn room with loggers into positions in label order, with what to check", () => {
    const out = layoutFromRoom(
      room({
        sensors: [
          s("L3", "top"),
          s("L1", "bottom"),
          s("L1", "middle"),
          s("L5", "middle"),
          s("AMB", "middle", true),
        ],
      }),
      4,
    );
    expect(out.points.map((p) => [p.label, p.z, p.ambient])).toEqual([
      ["L-01", 0.1, false],
      ["L-03", 0.9, false],
      ["L-05", 0.5, false],
      ["AMB", 0.5, true],
    ]);
    // The door, and the autoclave as a heat source; it is cut at the wall it runs past.
    expect(out.features).toEqual([
      { kind: "door", label: "Door", x: 0, y: 0.3 },
      { kind: "heat", label: "Autoclave", x: 0.9, y: 0.6 },
    ]);
    expect(out.shape.objects).toEqual([
      { kind: "autoclave", label: "Autoclave", x: 0.8, y: 0.5, w: 0.2, d: 0.2, h: 0.5, shelves: 0 },
    ]);
    expect(out.warnings).toEqual([
      "L-01 was read twice; kept the first.",
      "The sketch has 3 loggers inside; the study has 4.",
      "Not found on the sketch: L-02, L-04.",
    ]);
    const tooMany = layoutFromRoom(room({ sensors: [s("1", "top"), s("2", "top")] }), 1);
    expect(tooMany.warnings[0]).toContain("Remove 1");
  });

  it("spreads the study's loggers when none are drawn, as on QA Tech's sketches", () => {
    const out = layoutFromRoom(room(), 9);
    expect(out.points.filter((p) => !p.ambient)).toHaveLength(9);
    expect(out.warnings[0]).toContain("9 are spread by the template");
  });

  it("marks no door on a box: its front is the door", () => {
    expect(
      layoutFromRoom(room({ kind: "box", doors: [{ wall: "front", along: 0.5 }], objects: [] }), 0)
        .features,
    ).toEqual([]);
  });

  it("finds the equipment's room by its ID however it is written", () => {
    const rooms = [
      { name: "5-ML-05 Cooling Zone", code: "5-ML-05" },
      { name: "5-ML-09 change Room-3", code: "5-ML-09" },
      { name: "SML-07", code: "SML-07" },
      { name: "Media Prep. Room", code: "" },
    ];
    expect(matchRoom(rooms, { code: "5ML09", name: "Change room 3" })).toBe(1);
    expect(matchRoom(rooms, { code: "ABT-5-ML-05", name: "x" })).toBe(0);
    expect(matchRoom(rooms, { code: "MP-1", name: "Media Prep. Room" })).toBe(3);
    expect(matchRoom(rooms, { code: "Z-1", name: "Store" })).toBeNull();
    expect(matchRoom([rooms[0]!], { code: "Z-1", name: "Store" })).toBe(0);
  });

  it("refuses a reading that isn't a layout", () => {
    expect(sketchReadingSchema.safeParse({ rooms: [{ kind: "room" }] }).success).toBe(false);
    expect(sketchReadingSchema.safeParse(reading([room({ length: -1 })])).success).toBe(false);
    expect(sketchReadingSchema.safeParse(reading()).success).toBe(true);
  });

  it("asks OpenAI once with the photo and a strict schema", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const reader = openAiSketchReader({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(reading()) } }] }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    expect(await reader({ bytes: new Uint8Array([1, 2]), mime: "image/png" })).toEqual(reading());
    await reader({ bytes: new Uint8Array([1, 2]), mime: "application/pdf" });
    expect(JSON.stringify(calls[1]!.body)).toContain("data:application/pdf;base64,AQI=");
    expect(reader.model).toBe("gpt-5-mini");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.body).toMatchObject({
      model: "gpt-5-mini",
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(JSON.stringify(calls[0]!.body)).toContain("data:image/png;base64,AQI=");
  });

  it("says plainly when OpenAI refuses", async () => {
    const failing = (status: number) =>
      openAiSketchReader({
        apiKey: "k",
        model: "gpt-5-mini",
        fetch: (async () =>
          new Response(JSON.stringify({ error: { message: "no" } }), {
            status,
          })) as unknown as typeof fetch,
      });
    await expect(failing(401)({ bytes: new Uint8Array(), mime: "image/png" })).rejects.toThrow(
      "OPENAI_API_KEY",
    );
    await expect(
      failing(429)({ bytes: new Uint8Array(), mime: "image/png" }),
    ).rejects.toBeInstanceOf(SketchReadError);
  });
});
