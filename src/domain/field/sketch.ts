/**
 * A layout sketch, as the field engineer draws it on site (QA Tech, Nov 2026):
 * the room or box, its door and racks, and each logger with its label and
 * level (top, middle, bottom). A vision model reads the photo into a
 * `SketchReading`; this module checks it and turns it into the study's
 * positions, plan marks and drawn shape. Pure: no I/O.
 *
 * Coordinates are fractions, as everywhere in layouts: x left → right seen
 * from the front, y front → back, z floor → top.
 */
import { z } from "zod";

import { describe, label, templateLayout, type LayoutPoint, type Shape } from "./layout";
import type { PlanFeature } from "./types";

export const SKETCH_LEVELS = ["top", "middle", "bottom"] as const;
export type SketchLevel = (typeof SKETCH_LEVELS)[number];
/** Heights the levels are drawn and stored at, as in the templates. */
export const LEVEL_Z: Record<SketchLevel, number> = { bottom: 0.1, middle: 0.5, top: 0.9 };
export const LEVEL_LABELS: Record<SketchLevel, string> = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};

// A model's numbers are brought into range, not refused: 1.05 is the wall, -0.02 the
// floor, a missing number nothing. Text is cut to length, lists to a sane size.
const num = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }, z.number());
const unit = num(0, 1, 0);
const size = num(0, 1000, 0);
const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : ""), z.string());
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : []), z.array(item));
const whole = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => {
    const n = Math.round(typeof v === "number" ? v : Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }, z.number().int());

/** What stands in a room, as the engineers draw it. */
export const SKETCH_OBJECT_KINDS = [
  "cupboard",
  "rack",
  "pass_box",
  "table",
  "laf",
  "bsc",
  "autoclave",
  "oven",
  "incubator",
  "cold_chamber",
  "refrigerator",
  "ahu",
  "equipment",
  "other",
] as const;
export type SketchObjectKind = (typeof SKETCH_OBJECT_KINDS)[number];

const roomSchema = z.object({
  name: text(120),
  code: text(40),
  page: whole(1, 500, 1),
  kind: z.enum(["room", "box"]).catch("room"),
  orientation: z.enum(["horizontal", "vertical"]).catch("horizontal"),
  length: size,
  width: size,
  height: size,
  doors: list(
    z.object({ wall: z.enum(["front", "back", "left", "right"]).catch("front"), along: unit }),
    10,
  ),
  objects: list(
    z.object({
      kind: z.enum(SKETCH_OBJECT_KINDS).catch("other"),
      label: text(40),
      x: unit,
      y: unit,
      w: unit,
      d: unit,
      h: unit,
      shelves: whole(0, 20, 0),
    }),
    40,
  ),
  sensors: list(
    z.object({
      label: text(20),
      level: z.enum(SKETCH_LEVELS).catch("middle"),
      x: unit,
      y: unit,
      ambient: z.boolean().catch(false),
    }),
    200,
  ),
});
export type SketchRoom = z.infer<typeof roomSchema>;

/** What the model must give back. Checked again here: a model's JSON is never trusted. */
export const sketchReadingSchema = z.object({
  rooms: list(roomSchema, 80),
  notes: text(2000),
});
export type SketchReading = z.infer<typeof sketchReadingSchema>;

const jnum = (description: string) => ({ type: "number", description }) as const;

/**
 * The same, as the JSON Schema a model's structured output follows (strict:
 * every field required, nothing extra).
 */
export const SKETCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rooms", "notes"],
  properties: {
    rooms: {
      type: "array",
      description:
        "Every room, area or equipment drawn, in page order. A page can hold more than one.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "code",
          "page",
          "kind",
          "orientation",
          "length",
          "width",
          "height",
          "doors",
          "objects",
          "sensors",
        ],
        properties: {
          name: {
            type: "string",
            description: 'The title written beside it, e.g. "5-ML-05 Cooling Zone". Empty if none.',
          },
          code: {
            type: "string",
            description: 'Its ID alone as written, e.g. "5-ML-05" or "SML-07". Empty if none.',
          },
          page: { type: "integer", description: "Page it is on, from 1." },
          kind: {
            type: "string",
            enum: ["room", "box"],
            description:
              "room: a room, corridor, air lock, store or area. box: one chamber, fridge, freezer, incubator, oven or cold box.",
          },
          orientation: {
            type: "string",
            enum: ["horizontal", "vertical"],
            description:
              "horizontal: longer than tall (rooms nearly always). vertical: taller than wide (an upright fridge or cabinet).",
          },
          length: jnum(
            "Left-to-right size of the front face as drawn. Metres if written, otherwise relative.",
          ),
          width: jnum("Front-to-back depth as drawn, same unit."),
          height: jnum("Floor-to-ceiling height as drawn, same unit."),
          doors: {
            type: "array",
            description: "Each door drawn on the room's walls (not doors of furniture).",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["wall", "along"],
              properties: {
                wall: { type: "string", enum: ["front", "back", "left", "right"] },
                along: jnum("0 to 1 along that wall: left to right, or front to back."),
              },
            },
          },
          objects: {
            type: "array",
            description:
              "Everything drawn inside: cupboards, racks, pass boxes, tables, LAF, bio-safety cabinets, autoclaves, ovens, incubators, cold chambers, AHU units…",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "label", "x", "y", "w", "d", "h", "shelves"],
              properties: {
                kind: { type: "string", enum: [...SKETCH_OBJECT_KINDS] },
                label: {
                  type: "string",
                  description: 'As written, e.g. "Cupboard", "BOD incubator".',
                },
                x: jnum("Left edge, 0 to 1 of the length."),
                y: jnum("Front edge, 0 to 1 of the depth."),
                w: jnum("Width, 0 to 1 of the length."),
                d: jnum("Depth, 0 to 1 of the depth."),
                h: jnum("Height, 0 to 1 of the room's height."),
                shelves: { type: "integer", description: "Shelves drawn, 0 if none." },
              },
            },
          },
          sensors: {
            type: "array",
            description: "Loggers or sensors drawn (labels like L1, T1). Often none: then empty.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "level", "x", "y", "ambient"],
              properties: {
                label: { type: "string" },
                level: { type: "string", enum: ["top", "middle", "bottom"] },
                x: jnum("0 left to 1 right, seen from the front."),
                y: jnum("0 front to 1 back."),
                ambient: { type: "boolean", description: "True if drawn outside." },
              },
            },
          },
        },
      },
    },
    notes: { type: "string", description: "Anything unreadable or doubtful. Empty if all clear." },
  },
} as const;

/** Instructions given with the sketch. */
export const SKETCH_PROMPT = [
  "These are a field engineer's hand-drawn sketches of rooms and equipment in a pharmaceutical facility, drawn before a temperature mapping study. Pages may be rotated or photographed at an angle; a page can hold more than one room.",
  "Read every room or equipment drawn into the JSON schema, with its written title and ID. IDs look like 5-ML-05 or SML-07: a digit 5 at the start is a five, not the letter S.",
  "A room is usually drawn as seen from its entrance looking in: the rectangle in the middle is the BACK wall (y = 1), the slanted walls on each side are the LEFT (x = 0) and RIGHT (x = 1) walls, and the floor runs from the front (y = 0, nearest the viewer, often left open) to the back wall.",
  "An object drawn against the left wall has x near 0 and runs along y; one against the right wall has x near 1; one against the back wall has y near 1 and runs along x; one standing on the floor sits where it is drawn.",
  "A door drawn in the back rectangle is on the back wall; in a side wall, on that wall. Give its place along the wall: back wall left to right, side walls front to back.",
  "Every room is horizontal. Only a single cabinet, fridge or chamber drawn alone is a box, and it is vertical when drawn taller than wide.",
  "Label each object with the words written on it only, such as Cupboard, Pass box, Table, LAF, Autoclave; put where it is in the numbers, never in the label.",
  "If loggers are drawn (L1, T1, numbers in circles), give each once with its level from colour, legend, written T/M/B or drawn height; otherwise leave sensors empty.",
  "Do not invent anything not drawn.",
].join(" ");

/** "L1", "l-1", "T 05", "7" → "L-01"; anything else kept as written. */
export function normaliseLabel(text: string): string {
  const t = text.trim().toUpperCase();
  const m = /^(?:L|T|S|DL)?\s*[-_.]?\s*(\d{1,3})$/.exec(t);
  return m ? label(Number(m[1])) : t;
}

/**
 * Proportions that agree with the orientation: a vertical box is taller than
 * it is wide, a horizontal one is not. Missing sizes take typical ones.
 */
export function shapeOf(
  given: Pick<SketchRoom, "kind" | "orientation" | "length" | "width" | "height">,
): Shape {
  // A room never stands on end: a model reading a narrow room as "vertical" is wrong.
  const r = given.kind === "room" ? { ...given, orientation: "horizontal" as const } : given;
  const typical =
    r.kind === "room"
      ? { length: 4, width: 3, height: 2.6 }
      : r.orientation === "vertical"
        ? { length: 0.8, width: 0.7, height: 1.9 }
        : { length: 1.6, width: 0.8, height: 0.9 };
  let length = r.length > 0 ? r.length : typical.length;
  let width = r.width > 0 ? r.width : typical.width;
  let height = r.height > 0 ? r.height : typical.height;
  // Only one or two sizes given: scale the typical ones to them.
  if (!(r.length > 0 && r.width > 0 && r.height > 0)) {
    const known = [
      r.length > 0 ? r.length / typical.length : null,
      r.width > 0 ? r.width / typical.width : null,
      r.height > 0 ? r.height / typical.height : null,
    ].filter((v): v is number => v !== null);
    const k = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    if (!(r.length > 0)) length = typical.length * k;
    if (!(r.width > 0)) width = typical.width * k;
    if (!(r.height > 0)) height = typical.height * k;
  }
  const across = Math.max(length, width);
  if (r.orientation === "vertical" && height <= across) {
    // Drawn standing up: the longest side is the height.
    if (length >= width) [length, height] = [height, length];
    else [width, height] = [height, width];
    if (height <= Math.max(length, width)) height = Math.max(length, width) * 1.5;
  } else if (r.orientation === "horizontal" && height > across) {
    [length, height] = [height, length];
  }
  // Hand sketches draw rooms nearly as tall as long; a room is rarely taller than
  // two-thirds of its longer side, so its drawing is kept to that.
  if (r.kind === "room") height = Math.min(height, Math.max(length, width) * 0.65);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { length: round(length), width: round(width), height: round(height) };
}

export type SketchLayout = {
  points: LayoutPoint[];
  features: PlanFeature[];
  shape: Shape;
  /** Things the engineer should check before saving. */
  warnings: string[];
};

const r3 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

/** Plan marks for objects that matter to airflow and heat. */
const OBJECT_MARK: Partial<Record<SketchObjectKind, PlanFeature["kind"]>> = {
  pass_box: "pass_box",
  laf: "laf",
  bsc: "laf",
  ahu: "supply",
  autoclave: "heat",
  oven: "heat",
};

const wallPoint = (wall: "front" | "back" | "left" | "right", along: number) => {
  const a = r3(along);
  return wall === "front"
    ? { x: a, y: 0 }
    : wall === "back"
      ? { x: a, y: 1 }
      : wall === "left"
        ? { x: 0, y: a }
        : { x: 1, y: a };
};

/**
 * One room of a sketch as the study's layout: its loggers if drawn (in label
 * order), otherwise the template's positions for the study's logger count
 * inside the drawn shape; its doors and objects; its shape.
 */
export function layoutFromRoom(room: SketchRoom, loggerCount: number): SketchLayout {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const sensors = room.sensors
    .map((s) => ({ ...s, label: normaliseLabel(s.label) }))
    .filter((s) => {
      if (!s.label) return false;
      if (seen.has(s.label)) {
        warnings.push(`${s.label} was read twice; kept the first.`);
        return false;
      }
      seen.add(s.label);
      return true;
    });
  const num = (l: string) => Number(/(\d+)$/.exec(l)?.[1] ?? Infinity);
  sensors.sort((a, b) => num(a.label) - num(b.label) || a.label.localeCompare(b.label));

  const shape: Shape = {
    ...shapeOf(room),
    orientation: room.kind === "room" ? "horizontal" : room.orientation,
    objects: room.objects
      .map((o) => ({
        kind: o.kind,
        label: cleanLabel(o.label),
        x: r3(o.x),
        y: r3(o.y),
        w: r3(Math.min(o.w, 1 - o.x)),
        d: r3(Math.min(o.d, 1 - o.y)),
        h: r3(o.h || 0.6),
        shelves: o.shelves,
      }))
      .filter((o) => o.w > 0.01 && o.d > 0.01),
  };

  let points: LayoutPoint[];
  if (sensors.length) {
    points = sensors.map((s) => {
      const p = { x: r3(s.x), y: r3(s.y), z: LEVEL_Z[s.level] };
      return {
        ...p,
        label: s.label,
        note: s.ambient ? "Ambient, outside" : describe(p),
        ambient: s.ambient,
      };
    });
    const inside = points.filter((p) => !p.ambient).length;
    if (loggerCount > 0 && inside > loggerCount) {
      warnings.push(
        `The sketch has ${inside} loggers inside but the study has ${loggerCount}. Remove ${inside - loggerCount}, or raise the study's loggers.`,
      );
    } else if (loggerCount > 0 && inside < loggerCount) {
      warnings.push(`The sketch has ${inside} loggers inside; the study has ${loggerCount}.`);
    }
    const numbers = points.map((p) => num(p.label)).filter(Number.isFinite);
    const missing: string[] = [];
    if (numbers.length)
      for (let i = 1; i <= Math.max(...numbers); i++)
        if (!numbers.includes(i)) missing.push(label(i));
    if (missing.length)
      warnings.push(
        `Not found on the sketch: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}.`,
      );
  } else {
    // Sketches are drawn before the loggers go in: spread the study's loggers.
    points = templateLayout(
      loggerCount,
      { lengthM: null, widthM: null, heightM: null, shape },
      { room: room.kind === "room" },
    );
    warnings.push(
      loggerCount > 0
        ? `No loggers are drawn: ${loggerCount} are spread by the template. Move them to where they were placed.`
        : "No loggers are drawn and the study has no logger count: add the positions.",
    );
  }

  const features: PlanFeature[] = [];
  // A box's door is its whole front; only a room's doors are marked.
  if (room.kind === "room") {
    for (const d of room.doors)
      features.push({ kind: "door", label: "Door", ...wallPoint(d.wall, d.along) });
  }
  for (const o of shape.objects ?? []) {
    const kind = OBJECT_MARK[o.kind as SketchObjectKind];
    if (kind)
      features.push({
        kind,
        label: o.label || o.kind,
        x: r3(o.x + o.w / 2),
        y: r3(o.y + o.d / 2),
      });
  }
  return { points, features, shape, warnings };
}

// Handwriting reads 5 as S, 0 as O, 1 as I or l: compare IDs with those as one.
const key = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s/g, "5")
    .replace(/o/g, "0")
    .replace(/[il]/g, "1");

/** "cupboard (tall, back centre)" → "Cupboard": the place is in the numbers. */
export function cleanLabel(label: string): string {
  const t = label
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : "";
}

/**
 * Which drawn room is this equipment: its code written as the room's ID
 * (5-ML-05 = 5ML05), else in the title, else its name in the title; the only
 * room if there is one. Null when unsure.
 */
export function matchRoom(
  rooms: Pick<SketchRoom, "name" | "code">[],
  equipment: { code: string; name: string },
): number | null {
  if (rooms.length === 1) return 0;
  const code = key(equipment.code);
  const name = key(equipment.name);
  const tries: ((r: Pick<SketchRoom, "name" | "code">) => boolean)[] = [
    (r) => !!code && key(r.code) === code,
    (r) => !!code && key(r.name).includes(code),
    (r) => !!code && !!key(r.code) && code.endsWith(key(r.code)),
    (r) => name.length > 3 && key(r.name).includes(name),
  ];
  for (const t of tries) {
    const hits = rooms.flatMap((r, i) => (t(r) ? [i] : []));
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}
