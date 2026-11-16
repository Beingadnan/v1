/**
 * Sensor layouts: where loggers go in a box, drawn the way QA Tech's reports
 * draw it (BE-WF-02 page 4). Pure, shared by the phone screen and the FT-12 PDF.
 *
 * Coordinates are fractions of the inside size: x along the length (left →
 * right), y along the width (front → back), z up the height (floor → top).
 */
import { roomWalls, suggestLoggerCount } from "@/domain/clients/study-defaults";

export type Point = { x: number; y: number; z: number };
export type LayoutPoint = Point & { label: string; note: string; ambient: boolean };
/** Something drawn inside the room on the sketch: footprint and height as fractions. */
export type ShapeObject = {
  kind: string;
  label: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  shelves: number;
};
/**
 * The shape as drawn on the engineer's sketch: proportions in any unit (or
 * metres), standing up or lying flat, with what stands in it. Draws the box
 * when the measured size isn't known.
 */
export type Shape = {
  length: number;
  width: number;
  height: number;
  orientation?: "horizontal" | "vertical";
  objects?: ShapeObject[];
};
export type Dimensions = {
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  shape?: Shape | null;
};

/**
 * The sizes a drawing uses: the measured ones when all three are known,
 * otherwise the sketch's proportions, otherwise a cube.
 */
export function sizeOf(dims?: Dimensions | null): { L: number; W: number; H: number } {
  if (dims && dims.lengthM && dims.widthM && dims.heightM)
    return { L: dims.lengthM, W: dims.widthM, H: dims.heightM };
  const s = dims?.shape;
  if (s && s.length > 0 && s.width > 0 && s.height > 0)
    return { L: s.length, W: s.width, H: s.height };
  return { L: dims?.lengthM ?? 1, W: dims?.widthM ?? 1, H: dims?.heightM ?? 1 };
}

/** Sensors sit just inside the walls, as placed on site. */
const IN = 0.1;
const OUT = 0.9;

export const label = (n: number) => `L-${String(n).padStart(2, "0")}`;

/** "Bottom front left corner", "Middle level centre"… for the table and FT-12. */
export function describe({ x, y, z }: Point, levels = 3): string {
  const level = levels === 1 ? "" : z <= 0.25 ? "Bottom" : z >= 0.75 ? "Top" : "Middle";
  const side = (v: number, low: string, high: string) => (v <= 0.25 ? low : v >= 0.75 ? high : "");
  const depth = side(y, "front", "back");
  const across = side(x, "left", "right");
  const where = [depth, across].filter(Boolean).join(" ");
  if (!where) return level ? `${level} level, centre` : "Centre";
  const corner = depth && across ? "corner" : "wall";
  return [level, where, corner]
    .filter(Boolean)
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

function grid(along: number, across: number, levels: number[]): Point[] {
  const steps = (n: number) =>
    n === 1 ? [0.5] : Array.from({ length: n }, (_, i) => IN + ((OUT - IN) * i) / (n - 1));
  const points: Point[] = [];
  for (const z of levels) {
    for (const y of steps(across)) for (const x of steps(along)) points.push({ x, y, z });
  }
  return points;
}

const corners = (z: number): Point[] => [
  { x: IN, y: IN, z },
  { x: OUT, y: IN, z },
  { x: IN, y: OUT, z },
  { x: OUT, y: OUT, z },
];

/**
 * A starting layout for `count` loggers:
 * - 9: the eight corners and the centre (as BE-WF-02);
 * - 15: corners, the centre of each wall at mid height and the centre;
 * - a room whose size gives the WHO grid of exactly `count`: that grid;
 * - otherwise a near-square grid per level (2 levels, 3 from 18 loggers).
 * People move points afterwards; this saves placing them one by one.
 */
export function templateLayout(
  count: number,
  dims?: Dimensions,
  options: { room?: boolean } = {},
): LayoutPoint[] {
  if (count <= 0) return [];
  if (options.room) return roomLayout(count, dims);
  let points: Point[];
  const centre: Point = { x: 0.5, y: 0.5, z: 0.5 };
  if (count === 9) {
    points = [...corners(IN), ...corners(OUT), centre];
  } else if (count === 15) {
    const walls: Point[] = [
      { x: 0.5, y: IN, z: 0.5 },
      { x: 0.5, y: OUT, z: 0.5 },
      { x: IN, y: 0.5, z: 0.5 },
      { x: OUT, y: 0.5, z: 0.5 },
      { x: 0.5, y: 0.5, z: IN },
      { x: 0.5, y: 0.5, z: OUT },
    ];
    points = [...corners(IN), ...corners(OUT), ...walls, centre];
  } else {
    const who = dims ? suggestLoggerCount(dims) : null;
    const match = who && who.count === count ? whoGrid(dims!) : null;
    if (match) {
      points = match;
    } else {
      const levelCount = count < 6 ? 1 : count >= 18 ? 3 : 2;
      const levels =
        levelCount === 1
          ? [0.5]
          : Array.from({ length: levelCount }, (_, i) => IN + ((OUT - IN) * i) / (levelCount - 1));
      const perLevel = Math.ceil(count / levelCount);
      const across = Math.max(1, Math.round(Math.sqrt(perLevel)));
      const along = Math.ceil(perLevel / across);
      points = grid(along, across, levels).slice(0, count);
    }
  }
  const levels = new Set(points.map((p) => p.z)).size;
  return points.map((p, i) => ({
    ...round(p),
    label: label(i + 1),
    note: describe(p, levels),
    ambient: false,
  }));
}

/** Bench height in a room: where product is handled (dispensing, sampling). */
export const WORKING_HEIGHT_M = 1;

const wallName = (n: number) => `wall-${n}`;

/**
 * A room: loggers at working height along the four walls, numbered clockwise
 * from wall-1 at the front, then one in the centre (QA Tech's WH013 report).
 * A count other than the suggested one is shared by wall length.
 */
function roomLayout(count: number, dims?: Dimensions): LayoutPoint[] {
  const { L, W } = sizeOf(dims);
  const z = workingZ(dims?.heightM ?? null);
  // One in the centre from five loggers on (or the only one); the rest on the walls.
  const onWalls = count === 1 ? 0 : count >= 5 ? count - 1 : count;
  let walls = roomWalls(L, W) as number[];
  if (walls.reduce((a, b) => a + b, 0) !== onWalls) {
    // Share the loggers by wall length, the longer walls first.
    const lengths = [L, W, L, W];
    walls = [0, 0, 0, 0];
    for (let i = 0; i < onWalls; i++) {
      const next = [0, 1, 2, 3].sort(
        (a, b) => walls[a]! / lengths[a]! - walls[b]! / lengths[b]! || a - b,
      )[0]!;
      walls[next]! += 1;
    }
  }
  const along = (k: number, i: number) => IN + ((OUT - IN) * (i + 0.5)) / k;
  const points: { p: Point; note: string }[] = [];
  walls.forEach((k, w) => {
    for (let i = 0; i < k; i++) {
      const t = along(k, i);
      const p: Point =
        w === 0
          ? { x: t, y: IN, z }
          : w === 1
            ? { x: OUT, y: t, z }
            : w === 2
              ? { x: 1 - t, y: OUT, z }
              : { x: IN, y: 1 - t, z };
      points.push({ p, note: `Working height on ${wallName(w + 1)}` });
    }
  });
  if (points.length < count) {
    points.push({ p: { x: 0.5, y: 0.5, z }, note: "Working height, centre of the room" });
  }
  return points.slice(0, count).map(({ p, note }, i) => ({
    ...round(p),
    label: label(i + 1),
    note,
    ambient: false,
  }));
}

export function workingZ(heightM: number | null): number {
  if (!heightM || heightM <= 0) return 0.4;
  return Math.min(0.95, Math.max(0.05, WORKING_HEIGHT_M / heightM));
}

/**
 * Where a point is in a room, in QA Tech's words: the nearest wall (or the
 * centre) and the height ("Working height on wall-2", "Near the ceiling,
 * centre of the room").
 */
export function describeRoom({ x, y, z }: Point, heightM: number | null): string {
  const near = [
    { wall: 1, d: y },
    { wall: 2, d: 1 - x },
    { wall: 3, d: 1 - y },
    { wall: 4, d: x },
  ].sort((a, b) => a.d - b.d);
  const where =
    near[0]!.d > 0.25
      ? "centre of the room"
      : near[1]!.d <= 0.2
        ? `corner of ${wallName(Math.min(near[0]!.wall, near[1]!.wall))} & ${wallName(Math.max(near[0]!.wall, near[1]!.wall))}`
        : wallName(near[0]!.wall);
  const metres = heightM ? z * heightM : null;
  const height =
    metres === null
      ? z <= 0.15
        ? "Floor level"
        : z >= 0.85
          ? "Near the ceiling"
          : "Working height"
      : Math.abs(metres - WORKING_HEIGHT_M) <= 0.4
        ? "Working height"
        : z <= 0.15
          ? "Floor level"
          : z >= 0.85
            ? "Near the ceiling"
            : `At ${metres.toFixed(1)} m`;
  return where === "centre of the room" ? `${height}, ${where}` : `${height} on ${where}`;
}

/** The WHO grid used for the logger count (see suggestLoggerCount). */
function whoGrid(dims: Dimensions): Point[] | null {
  const { lengthM: l, widthM: w, heightM: h } = dims;
  if (!l || !w || !h) return null;
  if (l * w * h <= 20) return null;
  const floor = l * w;
  const spacing = floor <= 200 ? 5 : floor <= 5000 ? 10 : 20;
  const along = (d: number) => Math.max(2, Math.ceil(d / spacing) + 1);
  const levelCount = Math.max(3, 1 + Math.ceil((h - 0.6) / 1.8));
  // Levels from 0.3 m every ~1.8 m, as fractions of the height.
  const levels = Array.from({ length: levelCount }, (_, i) =>
    Math.min(0.98, Math.max(0.02, (0.3 + (i * (h - 0.6)) / (levelCount - 1)) / h)),
  );
  return grid(along(l), along(w), levels);
}

function round(p: Point): Point {
  const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  return { x: r(p.x), y: r(p.y), z: r(p.z) };
}

/** The first empty position, in label order. */
export function nextEmpty<
  T extends { sort: number; instrumentId: string | null; ambient?: boolean },
>(positions: T[]): T | null {
  return (
    [...positions].sort((a, b) => a.sort - b.sort).find((p) => p.instrumentId === null) ?? null
  );
}

/**
 * Oblique drawing of the box, like the report: front face square-on, depth
 * going up and right. Returns 2-D points in a frame of `width` × `height`.
 */
export function projector(
  dims: Dimensions,
  frame: { width: number; height: number; margin: number },
) {
  // Unknown sizes draw as the sketch's shape, or a cube.
  const { L, W, H } = sizeOf(dims);
  // The depth is drawn shortened (at most half the length and height), so a
  // back corner never lands on a front one, as when drawn by hand.
  const depth = Math.min(W * 0.35, L * 0.5, H * 0.5);
  const dx = depth;
  const dy = depth;
  const spanX = L + dx;
  const spanY = H + dy;
  const scale = Math.min(
    (frame.width - 2 * frame.margin) / spanX,
    (frame.height - 2 * frame.margin) / spanY,
  );
  const ox = frame.margin + (frame.width - 2 * frame.margin - spanX * scale) / 2;
  const oy = frame.height - frame.margin - (frame.height - 2 * frame.margin - spanY * scale) / 2;
  return (p: Point) => ({
    x: ox + (p.x * L + p.y * dx) * scale,
    y: oy - (p.z * H + p.y * dy) * scale,
  });
}

/**
 * A floor plan (top view) in a frame: length across, width up the page, the
 * front (wall-1, the entrance side) at the bottom, true to the room's
 * proportions. Returns the mapping and the drawn rectangle.
 */
export function planProjector(
  dims: Dimensions,
  frame: { width: number; height: number; margin: number },
) {
  const { L, W } = sizeOf(dims);
  const scale = Math.min(
    (frame.width - 2 * frame.margin) / L,
    (frame.height - 2 * frame.margin) / W,
  );
  const w = L * scale;
  const h = W * scale;
  const left = (frame.width - w) / 2;
  const top = (frame.height - h) / 2;
  return {
    rect: { x: left, y: top, w, h },
    at: (p: { x: number; y: number }) => ({ x: left + p.x * w, y: top + (1 - p.y) * h }),
  };
}

/**
 * A 3-D view of the box or room from any side: turned by `yaw` around the
 * upright axis and looked at from `pitch` above the floor (degrees), drawn
 * without perspective so sizes stay comparable. `yaw` 0 and `pitch` 0 look
 * straight at the front (wall-1); `pitch` 90 looks down from the top.
 * Returns each point's place on screen and its depth (larger = further).
 */
export function orbitProjector(
  dims: Dimensions,
  view: { yaw: number; pitch: number },
  frame: { width: number; height: number; margin: number },
) {
  const { L, W, H } = sizeOf(dims);
  const a = (view.yaw * Math.PI) / 180;
  const e = (Math.max(0, Math.min(90, view.pitch)) * Math.PI) / 180;
  const radius = Math.sqrt(L * L + W * W + H * H) / 2;
  const scale = Math.min(
    (frame.width - 2 * frame.margin) / (2 * radius),
    (frame.height - 2 * frame.margin) / (2 * radius),
  );
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return (p: Point) => {
    const X = (p.x - 0.5) * L;
    const Y = (p.y - 0.5) * W;
    const Z = (p.z - 0.5) * H;
    const x1 = X * Math.cos(a) - Y * Math.sin(a);
    const y1 = X * Math.sin(a) + Y * Math.cos(a);
    const up = Z * Math.cos(e) + y1 * Math.sin(e);
    const depth = y1 * Math.cos(e) - Z * Math.sin(e);
    return { x: cx + x1 * scale, y: cy - up * scale, depth };
  };
}

/** The 12 edges of the box, as pairs of corners. */
export const BOX_EDGES: [Point, Point][] = (() => {
  const c = (x: number, y: number, z: number): Point => ({ x, y, z });
  const v = [
    c(0, 0, 0),
    c(1, 0, 0),
    c(1, 1, 0),
    c(0, 1, 0),
    c(0, 0, 1),
    c(1, 0, 1),
    c(1, 1, 1),
    c(0, 1, 1),
  ];
  const pairs: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return pairs.map(([a, b]) => [v[a]!, v[b]!]);
})();

/** Sizes as QA Tech writes them on the diagram: "L-3360 mm". */
export function mm(metres: number | null): string {
  return metres === null ? "—" : `${Math.round(metres * 1000)} mm`;
}

/**
 * Moves labels that would print on top of each other apart (down, then
 * right), so every position stays readable on the drawing.
 */
export function spreadLabels<T extends { x: number; y: number }>(
  points: T[],
  size: { w: number; h: number },
): T[] {
  const placed: T[] = [];
  for (const p of points) {
    let q = { ...p };
    for (let tries = 0; tries < 12; tries++) {
      const hit = placed.some((o) => Math.abs(o.x - q.x) < size.w && Math.abs(o.y - q.y) < size.h);
      if (!hit) break;
      q = tries % 2 === 0 ? { ...q, y: q.y + size.h } : { ...q, x: q.x + size.w * 0.6 };
    }
    placed.push(q);
  }
  return placed;
}

/**
 * Reads a room size as people type it: "3.36 x 6.4 x 2.4", "3.36m × 6.4m × 2.4m",
 * "3360 x 6400 x 2400 mm", "336*640*240 cm", "3,36 x 6,4 x 2,4". Returns metres
 * (length, width, height), or a reason it can't be read.
 */
export function parseRoomSize(
  text: string,
): { ok: true; lengthM: number; widthM: number; heightM: number } | { ok: false; error: string } {
  const raw = text.trim().toLowerCase();
  if (!raw)
    return {
      ok: false,
      error: "Type the size as length × width × height, e.g. 3.36 x 6.4 x 2.4 m.",
    };
  const unitOf = (s: string) =>
    /mm/.test(s) ? 0.001 : /cm/.test(s) ? 0.01 : /(ft|feet|')/.test(s) ? 0.3048 : null;
  const overall = unitOf(raw);
  const parts = raw
    .split(/\s*(?:x|×|\*|by)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 3) {
    return {
      ok: false,
      error: "Give three numbers, length × width × height, e.g. 3.36 x 6.4 x 2.4 m.",
    };
  }
  const values: number[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|m|ft|feet|')?$/);
    if (!m) return { ok: false, error: `“${p}” is not a size.` };
    const n = Number(m[1]!.replace(",", "."));
    const unit = m[2] ? (unitOf(m[2]) ?? 1) : (overall ?? 1);
    values.push(Math.round(n * unit * 1000) / 1000);
  }
  if (values.some((v) => v <= 0)) return { ok: false, error: "Sizes must be more than 0." };
  if (values.some((v) => v > 500)) {
    return { ok: false, error: "That is over 500 m. If it is in millimetres, add “mm”." };
  }
  const [lengthM, widthM, heightM] = values as [number, number, number];
  return { ok: true, lengthM, widthM, heightM };
}
