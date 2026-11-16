"use client";

import { Check, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dimensions } from "@/domain/field/layout";
import type { ReadSketch, SketchRoomLayout } from "@/domain/field/field-service";
import { cn } from "@/lib/utils";

import { readSketchAction } from "../actions";
import { LayoutDiagram, levelOfZ } from "./layout-diagram";

export type UseSketch = SketchRoomLayout & { fileId: string };

/**
 * "Read a sketch" (QA Tech, Nov 2026): the engineer photographs the layout
 * drawn on site (or scans the site's sketches into one PDF); each room is
 * read into its doors, what stands in it, the shape and any loggers drawn, the
 * study's room is picked by its ID, and it is
 * shape, drawn as the report's diagram for checking, then used in the editor
 * (still to be saved there).
 */
export function SketchUpload({
  studyId,
  dims,
  onUse,
  configured,
}: {
  /** False when no OpenAI key is set: say so, but still allow a file read before. */
  configured: boolean;
  studyId: string;
  dims: Dimensions;
  onUse: (layout: UseSketch) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "reading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sketch, setSketch] = useState<ReadSketch | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const read = sketch && pick !== null ? sketch.rooms[pick] : null;

  async function choose(file: File) {
    setError(null);
    setSketch(null);
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)) {
      setError("Choose the scanned PDF or a photo (JPEG or PNG) of the sketches.");
      return;
    }
    setStage("uploading");
    const body = new FormData();
    body.append("file", file, file.name || "sketch.jpg");
    let res: Response;
    try {
      res = await fetch("/api/files", { method: "POST", body });
    } catch {
      setStage("idle");
      setError("No connection. Try again when you're online.");
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !json.id) {
      setStage("idle");
      setError(
        res.status === 401
          ? "You were signed out. Sign in again in a new tab, then choose the photo again."
          : (json.error ?? "The photo couldn't be uploaded."),
      );
      return;
    }
    setStage("reading");
    const r = await readSketchAction(studyId, json.id);
    setStage("idle");
    if (r.ok) {
      setSketch(r.data);
      setPick(r.data.matched);
    } else setError(r.error);
  }

  const count = (level: string) =>
    read?.points.filter((p) => !p.ambient && levelOfZ(p.z) === level).length ?? 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-primary/40 bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Upload the layout sketch</h3>
        <p className="text-sm text-muted-foreground">
          The scanned PDF or a photo of the rooms drawn on site. Each room is read into a diagram
          with its doors and what stands inside; this equipment&apos;s room is picked by its ID.
        </p>
      </div>
      {!configured ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          Sketch reading isn&apos;t switched on: add <code>ANTHROPIC_API_KEY</code> (Claude) or{" "}
          <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the app. A PDF already
          read still works.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={stage !== "idle"} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          {stage === "uploading"
            ? "Uploading…"
            : stage === "reading"
              ? "Reading the sketch…"
              : "Upload sketch (PDF or photo)"}
        </Button>
        <span className="text-xs text-muted-foreground">Or lay out the positions below.</span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          aria-label="Scanned PDF or photo of the layout sketches"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void choose(f);
          }}
        />
      </div>
      {stage === "reading" ? (
        <p className="text-sm text-muted-foreground" role="status">
          This takes up to a minute for a PDF of many rooms.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {error}
        </p>
      ) : null}
      {sketch && sketch.rooms.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Room on the sketch ({sketch.rooms.length} read)
          <select
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            value={pick ?? ""}
            onChange={(e) => setPick(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Choose the room with this equipment…</option>
            {sketch.rooms.map((r) => (
              <option key={r.index} value={r.index}>
                {[r.name || r.code || `Room ${r.index + 1}`, `page ${r.page}`].join(" · ")}
              </option>
            ))}
          </select>
          {sketch.matched === null ? (
            <span className="text-xs font-normal text-attention">
              No room carries this equipment&apos;s ID; choose it.
            </span>
          ) : null}
        </label>
      ) : null}
      {read ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <span className="font-semibold">{read.name || read.code || "The room"}</span>:{" "}
            {read.points.length} positions, {count("top")} top, {count("middle")} middle,{" "}
            {count("bottom")} bottom
            {read.points.some((p) => p.ambient)
              ? `, ${read.points.filter((p) => p.ambient).length} ambient`
              : ""}
            . {read.shape.orientation === "vertical" ? "Standing (vertical)" : "Lying (horizontal)"}
            {read.shape.objects?.length ? `, ${read.shape.objects.length} things inside` : ""}
            {read.features.some((f) => f.kind === "door") ? ", door marked" : ""}.
          </p>
          {read.warnings.length ? (
            <ul className="list-disc rounded-md bg-attention-soft py-2 pr-3 pl-7 text-sm text-attention">
              {read.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="overflow-hidden rounded-md border border-border">
            <LayoutDiagram
              dims={{ ...dims, shape: read.shape }}
              points={read.points}
              features={read.features}
              className="h-auto w-full"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                onUse({ ...read, fileId: sketch!.fileId });
                setSketch(null);
              }}
            >
              <Check aria-hidden="true" />
              Use this layout
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSketch(null)}>
              <X aria-hidden="true" />
              Discard
            </Button>
          </div>
          <p className={cn("text-xs text-muted-foreground")}>
            Using it replaces the positions below; move or rename any, then press Save.
          </p>
        </div>
      ) : null}
    </div>
  );
}
