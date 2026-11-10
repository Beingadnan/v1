"use client";

import { RotateCcw } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";

import { BOX_EDGES, mm, orbitProjector, type Dimensions, type Point } from "@/domain/field/layout";
import { PLAN_FEATURE_MARKS, type PlanFeature } from "@/domain/field/types";
import { cn } from "@/lib/utils";

type P = { label: string; x: number; y: number; z: number; ambient: boolean; filled?: boolean };

const VIEWS = [
  { name: "3D", yaw: -30, pitch: 28 },
  { name: "Top", yaw: 0, pitch: 90 },
  { name: "Front", yaw: 0, pitch: 0 },
  { name: "Side", yaw: -90, pitch: 0 },
] as const;

/**
 * The layout in 3-D (QA Tech, Nov 2026): drag to turn it, or pick top,
 * front or side. Each logger has a dotted line down to the floor so its
 * height reads at a glance; marks on a room's plan sit on the floor. Tap a
 * logger to pick it in the list below.
 */
export function Layout3D({
  dims,
  points,
  features = [],
  highlight,
  onPick,
}: {
  dims: Dimensions;
  points: P[];
  features?: PlanFeature[];
  highlight?: string | null;
  onPick?: (label: string) => void;
}) {
  const W = 480;
  const H = 340;
  const [view, setView] = useState<{ yaw: number; pitch: number }>(VIEWS[0]);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const at = orbitProjector(dims, view, { width: W, height: H, margin: 24 });
  const inside = points.filter((p) => !p.ambient);
  // Far things first, so near ones are drawn on top.
  const spots = inside
    .map((p) => ({ p, q: at(p), floor: at({ ...p, z: 0 }) }))
    .sort((a, b) => b.q.depth - a.q.depth);
  const depths = spots.map((s) => s.q.depth);
  const near = Math.min(...depths, 0);
  const far = Math.max(...depths, 1);
  const shade = (d: number) => (far === near ? 1 : 1 - (0.45 * (d - near)) / (far - near));
  const corners = BOX_EDGES.flat();
  const farCorner = corners.reduce((f, c) => (at(c).depth > at(f).depth ? c : f), corners[0]!);
  const sameCorner = (a: Point, b: Point) => a.x === b.x && a.y === b.y && a.z === b.z;
  const lines = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    setView({
      yaw: d.yaw - (e.clientX - d.x) * 0.5,
      pitch: Math.max(0, Math.min(90, d.pitch + (e.clientY - d.y) * 0.4)),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="View"
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {VIEWS.map((v) => (
            <button
              key={v.name}
              type="button"
              aria-pressed={view.yaw === v.yaw && view.pitch === v.pitch}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 text-sm",
                view.yaw === v.yaw && view.pitch === v.pitch
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface",
              )}
            >
              {v.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setView(VIEWS[0])}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Drag the drawing to turn it
        </button>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`3-D view of the layout with ${inside.length} positions`}
        onPointerDown={(e) => {
          (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ...view };
        }}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {/* The floor, in quarters, so heights have something to stand on. */}
        {lines(4).map((t) => {
          const a1 = at({ x: t, y: 0, z: 0 });
          const b1 = at({ x: t, y: 1, z: 0 });
          const a2 = at({ x: 0, y: t, z: 0 });
          const b2 = at({ x: 1, y: t, z: 0 });
          return (
            <g key={t} className="stroke-border" strokeWidth={0.8}>
              <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y} />
              <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} />
            </g>
          );
        })}
        {BOX_EDGES.map(([a, b], i) => {
          const pa = at(a);
          const pb = at(b);
          // The three edges at the corner furthest away are behind the box.
          const back = sameCorner(a, farCorner) || sameCorner(b, farCorner);
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              className="stroke-foreground"
              strokeWidth={back ? 0.8 : 1.4}
              strokeDasharray={back ? "4 3" : undefined}
            />
          );
        })}
        <text x={W / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          L {mm(dims.lengthM)} · W {mm(dims.widthM)} · H {mm(dims.heightM)}
        </text>
        {features.map((f, i) => {
          const q = at({ x: f.x, y: f.y, z: 0 });
          const mark = PLAN_FEATURE_MARKS[f.kind];
          const w = Math.max(16, mark.length * 6 + 6);
          return (
            <g key={`f${i}`}>
              <rect
                x={q.x - w / 2}
                y={q.y - 7}
                width={w}
                height={14}
                rx={2}
                className="fill-brand-soft stroke-primary"
                strokeWidth={0.8}
              />
              <text
                x={q.x}
                y={q.y + 3}
                textAnchor="middle"
                className="fill-primary text-[8px] font-bold"
              >
                {mark}
              </text>
            </g>
          );
        })}
        {spots.map(({ p, q, floor }) => {
          const k = shade(q.depth);
          const on = highlight === p.label;
          return (
            <g
              key={p.label}
              opacity={0.55 + 0.45 * k}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPick?.(p.label);
              }}
              className={onPick ? "cursor-pointer" : undefined}
            >
              <line
                x1={q.x}
                y1={q.y}
                x2={floor.x}
                y2={floor.y}
                className="stroke-muted-foreground"
                strokeWidth={0.8}
                strokeDasharray="2 2"
              />
              <circle cx={floor.x} cy={floor.y} r={1.8} className="fill-muted-foreground" />
              <circle
                cx={q.x}
                cy={q.y}
                r={9 + 4 * k}
                strokeWidth={on ? 2.5 : 1}
                className={
                  on
                    ? "fill-attention-soft stroke-attention"
                    : p.filled
                      ? "fill-pass-soft stroke-pass"
                      : "fill-surface stroke-foreground"
                }
              />
              <text
                x={q.x}
                y={q.y + 3}
                textAnchor="middle"
                className="pointer-events-none fill-foreground text-[8px] font-bold"
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
