"use client";

import { useState } from "react";

const time = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);

/**
 * One logger's readings as a small line (one series: no legend; the row
 * names it). The study's recorded windows are shaded; hovering shows the
 * reading nearest the pointer.
 */
export function Sparkline({
  points,
  windows,
  unit,
  label,
}: {
  points: [number, number][];
  windows: { start: number | null; end: number | null }[];
  unit: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const W = 240;
  const H = 48;
  const pad = 3;
  const t0 = points[0]![0];
  const t1 = points[points.length - 1]![0];
  const vs = points.map((p) => p[1]);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 0.5) {
    lo -= 0.25;
    hi += 0.25;
  }
  const x = (t: number) => pad + ((t - t0) / Math.max(t1 - t0, 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const d = points
    .map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
  const h = hover === null ? null : points[hover]!;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-12 w-full touch-none"
        role="img"
        aria-label={`${label}: ${points.length} readings from ${time(t0)} to ${time(t1)}, ${lo.toFixed(1)} to ${hi.toFixed(1)} ${unit}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
          let best = 0;
          for (let i = 1; i < points.length; i += 1) {
            if (Math.abs(points[i]![0] - t) < Math.abs(points[best]![0] - t)) best = i;
          }
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {windows.map((w, i) =>
          w.start !== null && w.end !== null ? (
            <rect
              key={i}
              x={x(Math.max(w.start, t0))}
              y={0}
              width={Math.max(0, x(Math.min(w.end, t1)) - x(Math.max(w.start, t0)))}
              height={H}
              className="fill-info-soft"
            />
          ) : null,
        )}
        <path
          d={d}
          fill="none"
          strokeWidth={1.5}
          className="stroke-primary"
          vectorEffect="non-scaling-stroke"
        />
        {h ? (
          <>
            <line
              x1={x(h[0])}
              x2={x(h[0])}
              y1={0}
              y2={H}
              className="stroke-border"
              strokeWidth={1}
            />
            <circle
              cx={x(h[0])}
              cy={y(h[1])}
              r={2.5}
              className="fill-primary stroke-surface"
              strokeWidth={1.5}
            />
          </>
        ) : null}
      </svg>
      {h ? (
        <span className="pointer-events-none absolute -top-6 right-0 rounded bg-foreground px-1.5 py-0.5 text-xs text-surface">
          {time(h[0])} · {h[1]} {unit}
        </span>
      ) : null}
    </div>
  );
}
