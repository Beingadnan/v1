"use client";

import { newId } from "@/lib/uuid";
import { Copy, MapPin, Plus, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import {
  describe,
  describeRoom,
  label as labelFor,
  workingZ,
  type Dimensions,
  type LayoutPoint,
} from "@/domain/field/layout";
import {
  PLAN_FEATURE_KINDS,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURE_MARKS,
  type PlanFeature,
  type PlanFeatureKind,
} from "@/domain/field/types";
import { cn } from "@/lib/utils";

import { saveLayoutAction, templateAction } from "../actions";
import { BoxDrawing } from "./box-drawing";
import { Layout3D } from "./layout-3d";
import { PlanDrawing } from "./plan-drawing";

type Point = LayoutPoint & { placed?: boolean; uid: string };
const withUid = (p: LayoutPoint & { placed?: boolean }): Point => ({
  ...p,
  uid: newId(),
});
type Mark = PlanFeature & { uid: string };
const MARK_SPOTS = [
  { x: 0.2, y: 0.02 },
  { x: 0.35, y: 0.02 },
  { x: 0.8, y: 0.02 },
  { x: 0.2, y: 0.98 },
  { x: 0.8, y: 0.98 },
  { x: 0.02, y: 0.3 },
  { x: 0.98, y: 0.3 },
];
const markWithUid = (f: PlanFeature): Mark => ({ ...f, uid: newId() });

const BOX_LEVELS = [
  { z: 0.1, name: "Bottom" },
  { z: 0.5, name: "Middle" },
  { z: 0.9, name: "Top" },
];
/** A room is mostly mapped at working height; floor and ceiling for hot or cold spots. */
const roomLevels = (heightM: number | null) => [
  { z: 0.05, name: "Floor" },
  { z: Math.round(workingZ(heightM) * 1000) / 1000, name: "Working height" },
  { z: 0.95, name: "Ceiling" },
];
const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

/**
 * Positions for a study: filled from a template, then dragged on a top-down
 * plan of each level, renamed or described. Saved in one go.
 */
export function LayoutEditor({
  studyId,
  dims,
  initial,
  loggerCount,
  readOnly,
  previous = null,
  room = false,
  initialFeatures = [],
}: {
  studyId: string;
  dims: Dimensions;
  initial: (LayoutPoint & { placed?: boolean })[];
  loggerCount: number;
  readOnly: boolean;
  /** The last study of this equipment, for a requalification in the same positions. */
  previous?: {
    reportNumber: string;
    points: LayoutPoint[];
    features?: PlanFeature[];
  } | null;
  /** A room mapped as an area: walls numbered clockwise, loggers at working height. */
  room?: boolean;
  /** Doors, pass boxes, LAFs… already marked on the plan. */
  initialFeatures?: PlanFeature[];
}) {
  const router = useRouter();
  const LEVELS = room ? roomLevels(dims.heightM) : BOX_LEVELS;
  const levelOf = (z: number) =>
    LEVELS.reduce((best, l) => (Math.abs(l.z - z) < Math.abs(best - z) ? l.z : best), LEVELS[0]!.z);
  const noteFor = (p: { x: number; y: number; z: number }) =>
    room ? describeRoom(p, dims.heightM) : describe(p);
  const firstLevel = levelOf(initial.find((p) => !p.ambient)?.z ?? (room ? 0.4 : 0.1));
  const [points, setPoints] = useState<Point[]>(() => initial.map(withUid));
  const [level, setLevel] = useState(firstLevel);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, start] = useTransition();
  const [show3d, setShow3d] = useState(false);
  const [marks, setMarks] = useState<Mark[]>(() => initialFeatures.map(markWithUid));
  const [markKind, setMarkKind] = useState<PlanFeatureKind>("door");
  const plan = useRef<SVGSVGElement>(null);
  const room_ = useRef<SVGRectElement>(null);
  const drag = useRef<string | null>(null);
  const dragMark = useRef<string | null>(null);
  const changeMarks = (next: Mark[]) => {
    setMarks(next);
    setDirty(true);
    setMessage(null);
  };

  const change = (next: Point[]) => {
    setPoints(next);
    setDirty(true);
    setMessage(null);
  };
  const update = (uid: string, patch: Partial<Point>) =>
    change(points.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  const selectedLabel = points.find((p) => p.uid === selected)?.label ?? null;

  const onLevel = points.filter((p) => !p.ambient && levelOf(p.z) === level);

  // Plan: length across, width up the screen (front of the equipment at the bottom).
  const PW = 320;
  const ratio = dims.lengthM && dims.widthM ? dims.widthM / dims.lengthM : 1;
  const PH = Math.round(Math.min(420, Math.max(140, PW * ratio)));
  // A margin round the plan for the wall names, so loggers on a wall never hide them.
  const PAD = 18;

  function move(e: PointerEvent<SVGSVGElement>) {
    if ((!drag.current && !dragMark.current) || !plan.current) return;
    // Positions are fractions of the room itself, not of the drawing with its margin.
    const r = (room_.current ?? plan.current).getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width);
    const y = clamp(1 - (e.clientY - r.top) / r.height);
    if (dragMark.current) {
      const id = dragMark.current;
      setMarks((ms) => ms.map((m) => (m.uid === id ? { ...m, x, y } : m)));
      setDirty(true);
      return;
    }
    const uid = drag.current!;
    setPoints((ps) =>
      ps.map((p) => (p.uid === uid ? { ...p, x, y, note: noteFor({ x, y, z: p.z }) } : p)),
    );
    setDirty(true);
  }

  function fill() {
    if (points.some((p) => p.placed)) {
      setMessage({
        ok: false,
        text: "Loggers are already placed. Remove them before starting the layout again.",
      });
      return;
    }
    start(async () => {
      const r = await templateAction(studyId);
      if (!r.ok) setMessage({ ok: false, text: r.error });
      else {
        change(r.data.map(withUid));
        setLevel(levelOf(r.data.find((p) => !p.ambient)?.z ?? LEVELS[0]!.z));
      }
    });
  }

  function add(ambient = false) {
    const used = new Set(points.map((p) => p.label.toLowerCase()));
    let n = points.length + 1;
    while (used.has(labelFor(n).toLowerCase())) n++;
    const p: Point = withUid(
      ambient
        ? {
            label: "AMB",
            x: 0,
            y: 0,
            z: 0.5,
            note: room ? "Outside the room (ambient)" : "Outside the equipment (ambient)",
            ambient: true,
          }
        : {
            label: labelFor(n),
            x: 0.5,
            y: 0.5,
            z: level,
            note: noteFor({ x: 0.5, y: 0.5, z: level }),
            ambient: false,
          },
    );
    if (ambient && used.has("amb")) {
      setMessage({ ok: false, text: "There is already an ambient position (AMB)." });
      return;
    }
    change([...points, p]);
    setSelected(p.uid);
  }

  function save() {
    start(async () => {
      const r = await saveLayoutAction(studyId, {
        points: points.map(({ label, x, y, z, note, ambient }) => ({
          label,
          x,
          y,
          z,
          note,
          ambient,
        })),
        features: marks.map(({ kind, label, x, y }) => ({ kind, label, x, y })),
      });
      setMessage(
        r.ok
          ? { ok: true, text: `Saved ${r.data.count} positions.` }
          : { ok: false, text: r.error },
      );
      if (r.ok) {
        setDirty(false);
        // Stay on Layout (the page would otherwise open the next step and hide this message),
        // unless the person has already moved on while the save was on its way.
        const now = new URLSearchParams(window.location.search).get("tab");
        if (
          window.location.pathname === `/studies/${studyId}` &&
          (now === null || now === "layout")
        ) {
          router.replace(`/studies/${studyId}?tab=layout`, { scroll: false });
        }
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2">
        <div
          role="tablist"
          aria-label="Drawing"
          className="inline-flex w-fit overflow-hidden rounded-md border border-border"
        >
          {(
            [
              [false, room ? "Floor plan" : "As on the report"],
              [true, "3D view"],
            ] as const
          ).map(([three, name]) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={show3d === three}
              onClick={() => setShow3d(three)}
              className={cn(
                "px-3 py-1.5 text-sm",
                show3d === three ? "bg-primary text-primary-foreground" : "bg-surface",
              )}
            >
              {name}
            </button>
          ))}
        </div>
        {show3d ? (
          <Layout3D
            dims={dims}
            points={points.map((p) => ({ ...p, filled: p.placed }))}
            features={marks}
            highlight={selectedLabel}
            onPick={(label) => {
              const p = points.find((q) => q.label === label);
              if (!p) return;
              setSelected(p.uid);
              if (!p.ambient) setLevel(levelOf(p.z));
            }}
          />
        ) : room ? (
          <PlanDrawing
            dims={dims}
            points={points.map((p) => ({ ...p, filled: p.placed }))}
            features={marks}
            highlight={selectedLabel}
            className="h-auto w-full"
          />
        ) : (
          <BoxDrawing
            dims={dims}
            points={points.map((p) => ({ ...p, filled: p.placed }))}
            highlight={selectedLabel}
            className="h-auto w-full"
          />
        )}
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {previous && points.length === 0 ? (
            <Button
              type="button"
              onClick={() => {
                change(previous.points.map(withUid));
                if (previous.features?.length) setMarks(previous.features.map(markWithUid));
                setLevel(levelOf(previous.points.find((p) => !p.ambient)?.z ?? LEVELS[0]!.z));
                setMessage({
                  ok: true,
                  text: `${previous.points.length} positions copied from ${previous.reportNumber}. Check them, then save.`,
                });
              }}
            >
              <Copy aria-hidden="true" />
              Copy positions from the last study
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={fill} disabled={busy}>
            <Wand2 aria-hidden="true" />
            {points.length ? "Start again from template" : `Fill ${loggerCount} positions`}
          </Button>
          <Button type="button" variant="ghost" onClick={() => add()}>
            <Plus aria-hidden="true" />
            Add position
          </Button>
          <Button type="button" variant="ghost" onClick={() => add(true)}>
            <Plus aria-hidden="true" />
            Ambient
          </Button>
        </div>
      ) : null}

      {points.length > 0 ? (
        <section aria-labelledby="plan" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="plan" className="text-sm font-semibold">
              Plan{" "}
              {room
                ? `at ${LEVELS.find((l) => l.z === level)!.name.toLowerCase()}`
                : `of the ${LEVELS.find((l) => l.z === level)!.name.toLowerCase()} level`}
            </h3>
            <div
              role="group"
              aria-label="Level"
              className="inline-flex overflow-hidden rounded-md border border-border"
            >
              {LEVELS.map((l) => (
                <button
                  key={l.z}
                  type="button"
                  aria-pressed={level === l.z}
                  onClick={() => setLevel(l.z)}
                  className={cn(
                    "px-3 py-1.5 text-sm",
                    level === l.z ? "bg-primary text-primary-foreground" : "bg-surface",
                  )}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {readOnly ? "" : "Drag a position to where the logger goes. "}
            {room
              ? "Wall-1 (entrance side) at the bottom; walls numbered clockwise."
              : "Front of the equipment (door side) at the bottom."}
          </p>
          <svg
            ref={plan}
            viewBox={`${-PAD} ${-PAD} ${PW + 2 * PAD} ${PH + 2 * PAD}`}
            className="w-full max-w-md touch-none rounded-md border border-border bg-surface select-none"
            onPointerMove={move}
            onPointerUp={() => {
              drag.current = null;
              dragMark.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
              dragMark.current = null;
            }}
          >
            <rect
              ref={room_}
              x={0}
              y={0}
              width={PW}
              height={PH}
              className="fill-surface-muted stroke-foreground"
              strokeWidth={1.5}
            />
            <text
              x={PW / 2}
              y={PH + 13}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {room ? "wall-1 (entrance)" : "front"}
            </text>
            {room ? (
              <>
                <text
                  transform={`translate(${PW + 12} ${PH / 2}) rotate(90)`}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  wall-2
                </text>
                <text
                  x={PW / 2}
                  y={-6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  wall-3
                </text>
                <text
                  transform={`translate(${-6} ${PH / 2}) rotate(-90)`}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  wall-4
                </text>
              </>
            ) : null}
            {onLevel.map((p) => (
              <g
                key={p.uid}
                transform={`translate(${p.x * PW} ${(1 - p.y) * PH})`}
                onPointerDown={(e) => {
                  if (readOnly) return;
                  plan.current?.setPointerCapture?.(e.pointerId);
                  drag.current = p.uid;
                  setSelected(p.uid);
                }}
                className={readOnly ? "" : "cursor-grab"}
              >
                <circle
                  r={16}
                  className={
                    selected === p.uid
                      ? "fill-attention-soft stroke-attention"
                      : "fill-surface stroke-foreground"
                  }
                  strokeWidth={1.5}
                />
                <text
                  y={4}
                  textAnchor="middle"
                  className="pointer-events-none fill-foreground text-[9px] font-bold"
                >
                  {p.label}
                </text>
              </g>
            ))}
            {/* Marks on top of the loggers, so one under a logger can still be dragged. */}
            {marks.map((m) => {
              const mark = PLAN_FEATURE_MARKS[m.kind];
              const w = Math.max(20, mark.length * 7 + 8);
              return (
                <g
                  key={m.uid}
                  transform={`translate(${m.x * PW} ${(1 - m.y) * PH})`}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    plan.current?.setPointerCapture?.(e.pointerId);
                    dragMark.current = m.uid;
                  }}
                  className={readOnly ? "" : "cursor-grab"}
                >
                  <title>{m.label || PLAN_FEATURE_LABELS[m.kind]}</title>
                  <rect
                    x={-w / 2}
                    y={-9}
                    width={w}
                    height={18}
                    rx={2}
                    className="fill-brand-soft stroke-primary"
                    strokeWidth={1}
                  />
                  <text
                    y={3.5}
                    textAnchor="middle"
                    className="pointer-events-none fill-primary text-[9px] font-bold"
                  >
                    {mark}
                  </text>
                </g>
              );
            })}
          </svg>
          {!readOnly || marks.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">What is in the {room ? "room" : "space"}</p>
              <p className="text-xs text-muted-foreground">
                Mark the door, pass box, LAF, ducts or anything that heats or cools a corner; the
                report&apos;s plan shows them beside the loggers. Drag a mark to its place.
              </p>
              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Mark"
                    value={markKind}
                    onChange={(e) => setMarkKind(e.target.value as PlanFeatureKind)}
                    className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                  >
                    {PLAN_FEATURE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {PLAN_FEATURE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() =>
                      changeMarks([
                        ...marks,
                        markWithUid({
                          kind: markKind,
                          label: markKind === "other" ? "" : PLAN_FEATURE_LABELS[markKind],
                          // Along wall-1 (where doors and pass boxes usually are), each
                          // new mark in its own spot clear of the loggers; drag to place.
                          ...MARK_SPOTS[marks.length % MARK_SPOTS.length]!,
                        }),
                      ])
                    }
                  >
                    <MapPin aria-hidden="true" />
                    Mark on plan
                  </Button>
                </div>
              ) : null}
              {marks.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {marks.map((m) => (
                    <li key={m.uid} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 rounded bg-brand-soft px-1 text-center text-xs font-bold text-primary">
                        {PLAN_FEATURE_MARKS[m.kind]}
                      </span>
                      <Input
                        aria-label={`Name of the ${PLAN_FEATURE_LABELS[m.kind]} mark`}
                        value={m.label}
                        disabled={readOnly}
                        placeholder={PLAN_FEATURE_LABELS[m.kind]}
                        onChange={(e) =>
                          changeMarks(
                            marks.map((x) =>
                              x.uid === m.uid ? { ...x, label: e.target.value.slice(0, 40) } : x,
                            ),
                          )
                        }
                        className="h-8 flex-1"
                      />
                      {!readOnly ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${m.label || PLAN_FEATURE_LABELS[m.kind]}`}
                          onClick={() => changeMarks(marks.filter((x) => x.uid !== m.uid))}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {points.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {points.map((p) => (
            <li
              key={p.uid}
              className={cn(
                "flex flex-wrap items-center gap-2 px-3 py-2",
                selected === p.uid && "bg-attention-soft/40",
              )}
              onFocus={() => setSelected(p.uid)}
            >
              <Input
                aria-label="Position label"
                value={p.label}
                disabled={readOnly || p.placed}
                onChange={(e) => {
                  update(p.uid, { label: e.target.value.toUpperCase().slice(0, 20) });
                }}
                className="w-20 font-mono"
              />
              <Input
                aria-label={`Where ${p.label} goes`}
                value={p.note}
                disabled={readOnly}
                onChange={(e) => update(p.uid, { note: e.target.value.slice(0, 200) })}
                className="min-w-40 flex-1"
              />
              {!p.ambient ? (
                <select
                  aria-label={`${p.label} height`}
                  value={levelOf(p.z)}
                  disabled={readOnly}
                  onChange={(e) => {
                    const z = Number(e.target.value);
                    update(p.uid, { z, note: noteFor({ x: p.x, y: p.y, z }) });
                    setLevel(z);
                  }}
                  className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                >
                  {LEVELS.map((l) => (
                    <option key={l.z} value={l.z}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-muted-foreground">ambient</span>
              )}
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={p.placed}
                  title={p.placed ? "Remove the logger first" : `Remove ${p.label}`}
                  aria-label={`Remove ${p.label}`}
                  onClick={() => change(points.filter((q) => q.uid !== p.uid))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No positions yet. &ldquo;Fill {loggerCount} positions&rdquo; places them{" "}
          {room
            ? "along the walls at working height and in the centre"
            : "at the corners and centre"}
          ; then move any that sit differently on site.
        </p>
      )}

      {message ? (
        <div
          role={message.ok ? "status" : "alert"}
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm",
            message.ok ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
          )}
        >
          {message.text}
          {message.ok && !dirty ? (
            <a href="#loggers" className="font-medium underline">
              Next: put a logger at each position ↓
            </a>
          ) : null}
        </div>
      ) : null}
      {!readOnly && points.length > 0 ? (
        <Button type="button" size="lg" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : dirty ? "Save layout" : "Layout saved"}
        </Button>
      ) : null}
    </div>
  );
}
