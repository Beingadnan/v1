/**
 * Sensor layouts: where loggers go in a box, drawn the way QA Tech's reports
 * draw it (BE-WF-02 page 4). Pure, shared by the phone screen and the FT-12 PDF.
 *
 * Coordinates are fractions of the inside size: x along the length (left →
 * right), y along the width (front → back), z up the height (floor → top).
 */
import { suggestLoggerCount } from "@/domain/clients/study-defaults";

export type Point = { x: number; y: number; z: number };
export type LayoutPoint = Point & { label: string; note: string; ambient: boolean };
export type Dimensions = { lengthM: number | null; widthM: number | null; heightM: number | null };

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
export function templateLayout(count: number, dims?: Dimensions): LayoutPoint[] {
  if (count <= 0) return [];
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
  // Unknown sizes draw as a cube.
  const L = dims.lengthM ?? 1;
  const W = dims.widthM ?? 1;
  const H = dims.heightM ?? 1;
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
