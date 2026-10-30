import { BOX_EDGES, mm, projector, spreadLabels, type Dimensions } from "@/domain/field/layout";

type P = { label: string; x: number; y: number; z: number; ambient: boolean; filled?: boolean };

/**
 * The equipment drawn as on the report (BE-WF-02 page 4): the box with its
 * sizes and each position as a labelled oval. Filled ovals have a logger.
 */
export function BoxDrawing({
  dims,
  points,
  highlight,
  className,
}: {
  dims: Dimensions;
  points: P[];
  highlight?: string | null;
  className?: string;
}) {
  const W = 480;
  const H = 300;
  const project = projector(dims, { width: W, height: H, margin: 34 });
  const inside = points.filter((p) => !p.ambient);
  const labels = spreadLabels(
    inside.map((p) => ({ ...project(p), p })),
    { w: 34, h: 15 },
  );
  const at = (x: number, y: number, z: number) => project({ x, y, z });
  const l = at(0.5, 0, 0);
  const w = at(1, 0.5, 0);
  const h = at(1, 1, 0.5);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`Drawing of the equipment with ${inside.length} positions`}
    >
      {BOX_EDGES.map(([a, b], i) => {
        const pa = project(a);
        const pb = project(b);
        const hidden =
          (a.x === 0 && a.y === 1 && a.z === 0) || (b.x === 0 && b.y === 1 && b.z === 0);
        return (
          <line
            key={i}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            className="stroke-foreground"
            strokeWidth={1.2}
            strokeDasharray={hidden ? "4 3" : undefined}
          />
        );
      })}
      <text x={l.x} y={l.y + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">
        L {mm(dims.lengthM)}
      </text>
      <text x={w.x + 8} y={w.y + 4} className="fill-muted-foreground text-[11px]">
        W {mm(dims.widthM)}
      </text>
      <text x={h.x + 8} y={h.y} className="fill-muted-foreground text-[11px]">
        H {mm(dims.heightM)}
      </text>
      {labels.map(({ x, y, p }) => (
        <g key={p.label}>
          <ellipse
            cx={x}
            cy={y}
            rx={16}
            ry={7}
            strokeWidth={highlight === p.label ? 2.5 : 1}
            className={
              highlight === p.label
                ? "fill-attention-soft stroke-attention"
                : p.filled
                  ? "fill-pass-soft stroke-pass"
                  : "fill-surface stroke-foreground"
            }
          />
          <text
            x={x}
            y={y + 3}
            textAnchor="middle"
            className="fill-foreground text-[8px] font-bold"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
