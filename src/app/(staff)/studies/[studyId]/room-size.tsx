"use client";

import { Ruler } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import type { Dimensions } from "@/domain/field/layout";
import { cn } from "@/lib/utils";

import { roomSizeAction } from "../actions";

const fmt = (v: number | null) => (v === null ? "?" : String(v));

/**
 * The room's size, typed in one box as measured on site. Shown open when the
 * equipment has no size yet, since the WHO grid and FT-12 need it.
 */
export function RoomSize({
  studyId,
  dims,
  readOnly,
}: {
  studyId: string;
  dims: Dimensions;
  readOnly: boolean;
}) {
  const router = useRouter();
  const missing = dims.lengthM === null || dims.widthM === null || dims.heightM === null;
  const [open, setOpen] = useState(missing);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const current = `${fmt(dims.lengthM)} × ${fmt(dims.widthM)} × ${fmt(dims.heightM)} m`;

  function save() {
    setMessage(null);
    start(async () => {
      const r = await roomSizeAction(studyId, text);
      if (r.ok) {
        setMessage({
          ok: true,
          text: `Size saved: ${r.data.lengthM} × ${r.data.widthM} × ${r.data.heightM} m.`,
        });
        setOpen(false);
        setText("");
        router.refresh();
      } else setMessage({ ok: false, text: r.error });
    });
  }

  if (readOnly) {
    return missing ? null : (
      <p className="text-sm text-muted-foreground">Size (L × W × H): {current}</p>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        missing ? "border-attention bg-attention-soft" : "border-border bg-surface",
      )}
    >
      {open ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="room-size" className="text-sm font-medium">
            {missing ? "Size not recorded. Measure it: " : "Size "}length × width × height
          </label>
          <div className="flex gap-2">
            <Input
              id="room-size"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 3.36 x 6.4 x 2.4 m"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={busy || !text.trim()}>
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            In m, cm or mm. Length runs along the front. It is saved on the equipment for next time.
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Ruler className="size-4 text-muted-foreground" aria-hidden="true" />
            Size (L × W × H): {current}
          </span>
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              setOpen(true);
              setMessage(null);
            }}
          >
            Wrong size?
          </button>
        </div>
      )}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn("text-sm", message.ok ? "text-pass" : "text-fail")}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
