"use client";

import { newId } from "@/lib/uuid";
import { Plus, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import {
  describe,
  label as labelFor,
  type Dimensions,
  type LayoutPoint,
} from "@/domain/field/layout";
import { cn } from "@/lib/utils";

import { saveLayoutAction, templateAction } from "../actions";
import { BoxDrawing } from "./box-drawing";

type Point = LayoutPoint & { placed?: boolean; uid: string };
const withUid = (p: LayoutPoint & { placed?: boolean }): Point => ({
  ...p,
  uid: newId(),
});

const LEVELS = [
  { z: 0.1, name: "Bottom" },
  { z: 0.5, name: "Middle" },
  { z: 0.9, name: "Top" },
];
const levelOf = (z: number) => (z <= 0.3 ? 0.1 : z >= 0.7 ? 0.9 : 0.5);
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
}: {
  studyId: string;
  dims: Dimensions;
  initial: (LayoutPoint & { placed?: boolean })[];
  loggerCount: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [points, setPoints] = useState<Point[]>(() => initial.map(withUid));
  const [level, setLevel] = useState(0.1);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, start] = useTransition();
  const plan = useRef<SVGSVGElement>(null);
  const drag = useRef<string | null>(null);

  const change = (next: Point[]) => {
    setPoints(next);
    setDirty(true);
    setMessage(null);
  };
  const update = (uid: string, patch: Partial<Point>) =>
    change(points.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  const selectedLabel = points.find((p) => p.uid === selected)?.label ?? null;

  const onLevel = useMemo(
    () => points.filter((p) => !p.ambient && levelOf(p.z) === level),
    [points, level],
  );

  // Plan: length across, width up the screen (front of the equipment at the bottom).
  const PW = 320;
  const ratio = dims.lengthM && dims.widthM ? dims.widthM / dims.lengthM : 1;
  const PH = Math.round(Math.min(420, Math.max(140, PW * ratio)));

  function move(e: PointerEvent<SVGSVGElement>) {
    if (!drag.current || !plan.current) return;
    const r = plan.current.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width);
    const y = clamp(1 - (e.clientY - r.top) / r.height);
    const uid = drag.current;
    setPoints((ps) =>
      ps.map((p) => (p.uid === uid ? { ...p, x, y, note: describe({ x, y, z: p.z }) } : p)),
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
        setLevel(0.1);
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
            note: "Outside the equipment (ambient)",
            ambient: true,
          }
        : {
            label: labelFor(n),
            x: 0.5,
            y: 0.5,
            z: level,
            note: describe({ x: 0.5, y: 0.5, z: level }),
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
      const r = await saveLayoutAction(
        studyId,
        points.map(({ label, x, y, z, note, ambient }) => ({ label, x, y, z, note, ambient })),
      );
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
      <div className="rounded-lg border border-border bg-surface p-2">
        <BoxDrawing
          dims={dims}
          points={points.map((p) => ({ ...p, filled: p.placed }))}
          highlight={selectedLabel}
          className="h-auto w-full"
        />
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
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
              Plan of the {LEVELS.find((l) => l.z === level)!.name.toLowerCase()} level
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
            {readOnly ? "" : "Drag a position to where the logger goes. "}Front of the equipment
            (door side) at the bottom.
          </p>
          <svg
            ref={plan}
            viewBox={`0 0 ${PW} ${PH}`}
            className="w-full max-w-md touch-none rounded-md border border-border bg-surface-muted"
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <text
              x={PW / 2}
              y={PH - 4}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              front
            </text>
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
          </svg>
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
                    update(p.uid, { z, note: describe({ x: p.x, y: p.y, z }) });
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
          No positions yet. &ldquo;Fill {loggerCount} positions&rdquo; places them at the corners
          and centre; then move any that sit differently on site.
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
            <Link href={`/studies/${studyId}?tab=loggers`} className="font-medium underline">
              Next: place the loggers →
            </Link>
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
