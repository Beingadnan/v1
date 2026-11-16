import {
  BOX_EDGES,
  projector,
  sizeOf,
  type Dimensions,
  type Point,
  type ShapeObject,
} from "@/domain/field/layout";
import type { PlanFeature } from "@/domain/field/types";

type P = { label: string; x: number; y: number; z: number; ambient: boolean };

/** Level colours, as on QA Tech's diagrams: top green, middle white, bottom blue. */
export const LEVEL_FILL = { top: "#a6c93c", middle: "#ffffff", bottom: "#a8c8f8" } as const;
export const levelOfZ = (z: number) => (z >= 0.67 ? "top" : z <= 0.33 ? "bottom" : "middle");

/**
 * "Diagram indicating sensor locations" (QA Tech, Nov 2026): the room or box
 * in an oblique 3-D view with what stands in it and its doors, each logger as a circle at
 * its place, coloured by level. Drawn from the sketch's shape when the size
 * wasn't measured. Paper colours, as it prints.
 */
export function LayoutDiagram({
  dims,
  points,
  features = [],
  className,
}: {
  dims: Dimensions;
  points: P[];
  features?: PlanFeature[];
  className?: string;
}) {
  const W = 760;
  const H = 480;
  const legendW = 110;
  const project = projector(dims, { width: W - legendW, height: H - 30, margin: 50 });
  const at = (p: Point) => {
    const q = project(p);
    return { x: q.x, y: q.y + 30 };
  };
  const line = (a: Point, b: Point) => {
    const pa = at(a);
    const pb = at(b);
    return `M${pa.x.toFixed(1)},${pa.y.toFixed(1)}L${pb.x.toFixed(1)},${pb.y.toFixed(1)}`;
  };
  const poly = (ps: Point[]) =>
    ps.map((p, i) => `${i ? "L" : "M"}${at(p).x.toFixed(1)},${at(p).y.toFixed(1)}`).join("") + "Z";

  const { L, H: tall } = sizeOf(dims);
  const objects: ShapeObject[] = dims.shape?.objects ?? [];
  const doors = features.filter((f) => f.kind === "door");
  const inside = points.filter((p) => !p.ambient);
  const outside = points.filter((p) => p.ambient);
  // Back loggers first, so front ones are drawn over them.
  const spots = inside.map((p) => ({ p, q: at(p) })).sort((a, b) => b.p.y - a.p.y || a.p.z - b.p.z);
  const r = inside.length > 30 ? 11 : inside.length > 18 ? 13 : 15;
  const hiddenEdge = (a: Point, b: Point) =>
    (a.x === 0 && a.y === 1 && a.z === 0) || (b.x === 0 && b.y === 1 && b.z === 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`Diagram of ${inside.length} sensor locations`}
      style={{ background: "#ffffff" }}
    >
      <text x={14} y={22} fill="#1d4ed8" fontSize={15}>
        Diagram indicating sensor locations
      </text>

      {/* What stands in the room: a box each, with shelves and its name; back ones first. */}
      {[...objects]
        .sort((a, b) => b.y + b.d - (a.y + a.d))
        .map((o, i) => {
          const x0 = o.x;
          const x1 = o.x + o.w;
          const y0 = o.y;
          const y1 = o.y + o.d;
          const top = Math.max(0.05, Math.min(1, o.h || 0.6));
          const face = (ps: Point[], shade: string) => (
            <path d={poly(ps)} fill={shade} fillOpacity={0.75} stroke="#555555" strokeWidth={1} />
          );
          const shelves = o.shelves > 0 ? o.shelves : 0;
          const front = at({ x: (x0 + x1) / 2, y: y0, z: top / 2 });
          return (
            <g key={`obj-${i}`}>
              {face(
                [
                  { x: x1, y: y0, z: 0 },
                  { x: x1, y: y1, z: 0 },
                  { x: x1, y: y1, z: top },
                  { x: x1, y: y0, z: top },
                ],
                "#e4e1dd",
              )}
              {face(
                [
                  { x: x0, y: y0, z: top },
                  { x: x1, y: y0, z: top },
                  { x: x1, y: y1, z: top },
                  { x: x0, y: y1, z: top },
                ],
                "#f1efec",
              )}
              {face(
                [
                  { x: x0, y: y0, z: 0 },
                  { x: x1, y: y0, z: 0 },
                  { x: x1, y: y0, z: top },
                  { x: x0, y: y0, z: top },
                ],
                "#fbfaf8",
              )}
              {Array.from({ length: shelves }, (_, s) => {
                const z = (top * (s + 1)) / (shelves + 1);
                return (
                  <path
                    key={s}
                    d={poly([
                      { x: x0, y: y0, z },
                      { x: x1, y: y0, z },
                      { x: x1, y: y1, z },
                      { x: x0, y: y1, z },
                    ])}
                    fill="#c8c8c8"
                    fillOpacity={0.8}
                    stroke="#777777"
                    strokeWidth={0.8}
                  />
                );
              })}
              {o.label ? (
                <text
                  x={front.x}
                  y={front.y + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#333333"
                  stroke="#ffffff"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {o.label.length > 18 ? `${o.label.slice(0, 17)}…` : o.label}
                </text>
              ) : null}
            </g>
          );
        })}

      {/* The room or box. */}
      {BOX_EDGES.map(([a, b], i) => (
        <path
          key={i}
          d={line(a, b)}
          stroke="#111111"
          strokeWidth={hiddenEdge(a, b) ? 1.2 : 2.6}
          strokeDasharray={hiddenEdge(a, b) ? "5 4" : undefined}
        />
      ))}

      {doors.map((d, i) => (
        <Door key={i} door={d} at={at} L={L} H={tall} />
      ))}

      {spots.map(({ p, q }) => {
        const level = levelOfZ(p.z);
        return (
          <g key={p.label}>
            <circle
              cx={q.x}
              cy={q.y}
              r={r}
              fill={LEVEL_FILL[level]}
              stroke="#111111"
              strokeWidth={1.2}
            />
            <text
              x={q.x}
              y={q.y + 4}
              textAnchor="middle"
              fontSize={r * 0.75}
              fontWeight={700}
              fill="#111111"
            >
              {p.label.replace(/^L-0?/, "L")}
            </text>
          </g>
        );
      })}

      {outside.length ? (
        <text x={14} y={H - 12} fontSize={12} fill="#111111">
          Ambient (outside): {outside.map((p) => p.label).join(", ")}
        </text>
      ) : null}

      {/* Legend */}
      <line x1={W - legendW} y1={36} x2={W - legendW} y2={H - 8} stroke="#cccccc" />
      {(["top", "bottom", "middle"] as const).map((level, i) => (
        <g key={level}>
          <circle
            cx={W - legendW / 2}
            cy={110 + i * 110}
            r={22}
            fill={LEVEL_FILL[level]}
            stroke="#111111"
            strokeWidth={1.2}
          />
          <text
            x={W - legendW / 2}
            y={155 + i * 110}
            textAnchor="middle"
            fontSize={14}
            fontWeight={700}
            fill="#111111"
          >
            {level[0]!.toUpperCase() + level.slice(1)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** A door on its wall, floor to about 2 m (or 75% of a box), with its name. */
function Door({
  door,
  at,
  L,
  H,
}: {
  door: PlanFeature;
  at: (p: Point) => { x: number; y: number };
  L: number;
  H: number;
}) {
  const top = Math.min(0.75, H > 0 ? 2.1 / H : 0.75) || 0.75;
  const half = Math.min(0.12, L > 0 ? 0.5 / L : 0.12) || 0.12;
  // On the front or back wall it runs along x; on a side wall along y.
  const along = door.y === 0 || door.y === 1;
  const c = along ? door.x : door.y;
  const a = Math.max(0, c - half);
  const b = Math.min(1, c + half);
  const corner = (t: number, z: number): Point =>
    along ? { x: t, y: door.y, z } : { x: door.x, y: t, z };
  const ps = [corner(a, 0), corner(a, top), corner(b, top), corner(b, 0)].map(at);
  const foot = at(corner(c, 0));
  return (
    <g>
      <path
        d={ps.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("")}
        fill="#ffffff"
        fillOpacity={0.7}
        stroke="#111111"
        strokeWidth={1.8}
      />
      <text
        x={foot.x}
        y={foot.y + 18}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill="#111111"
      >
        Door
      </text>
    </g>
  );
}
