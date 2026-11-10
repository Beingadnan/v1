import { mm, planProjector, spreadLabels, type Dimensions } from "@/domain/field/layout";
import { PLAN_FEATURE_MARKS, type PlanFeature } from "@/domain/field/types";

type P = { label: string; x: number; y: number; ambient: boolean; filled?: boolean };

/**
 * A room drawn as on QA Tech's area reports (WH013): the floor plan with its
 * walls numbered clockwise from the entrance side, what is in the room (door,
 * pass box, LAF, ducts) and each logger as a labelled circle.
 */
export function PlanDrawing({
  dims,
  points,
  features,
  highlight,
  className,
}: {
  dims: Dimensions;
  points: P[];
  features: PlanFeature[];
  highlight?: string | null;
  className?: string;
}) {
  const W = 480;
  const H = 320;
  const { rect, at } = planProjector(dims, { width: W, height: H, margin: 64 });
  const inside = points.filter((p) => !p.ambient);
  const labels = spreadLabels(
    inside.map((p) => ({ ...at(p), p })),
    { w: 30, h: 15 },
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`Floor plan of the room with ${inside.length} positions and ${features.length} marks`}
    >
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        className="fill-surface stroke-foreground"
        strokeWidth={2}
      />
      <text
        x={rect.x + rect.w / 2}
        y={rect.y + rect.h + 14}
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        wall-1 · L {mm(dims.lengthM)}
      </text>
      <text
        x={rect.x + rect.w + 6}
        y={rect.y + rect.h / 2}
        className="fill-muted-foreground text-[10px]"
      >
        wall-2
      </text>
      <text
        x={rect.x + rect.w / 2}
        y={rect.y - 6}
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        wall-3
      </text>
      <text
        x={rect.x - 6}
        y={rect.y + rect.h / 2}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        wall-4
      </text>
      <text
        x={rect.x - 6}
        y={rect.y + rect.h / 2 + 12}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        W {mm(dims.widthM)}
      </text>
      {features.map((f, i) => {
        const q = at(f);
        const mark = PLAN_FEATURE_MARKS[f.kind];
        const w = Math.max(18, mark.length * 7 + 6);
        return (
          <g key={i}>
            <rect
              x={q.x - w / 2}
              y={q.y - 8}
              width={w}
              height={16}
              rx={2}
              className="fill-brand-soft stroke-primary"
              strokeWidth={1}
            />
            <text
              x={q.x}
              y={q.y + 3.5}
              textAnchor="middle"
              className="fill-primary text-[9px] font-bold"
            >
              {mark}
            </text>
            {f.label ? (
              <text
                x={q.x}
                y={q.y + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[8px]"
              >
                {f.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {labels.map(({ x, y, p }) => (
        <g key={p.label}>
          <circle
            cx={x}
            cy={y}
            r={13}
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
