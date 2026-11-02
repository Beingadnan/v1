"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";

import {
  completeCapaAction,
  createCapaAction,
  moveCapaDueAction,
  verifyCapaAction,
} from "./actions";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground";

/** Raise a corrective or preventive action on a deviation. */
export function RaiseCapa({
  deviationId,
  staff,
  today,
}: {
  deviationId: string;
  staff: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(createCapaAction);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-primary">Raise a CAPA</summary>
      <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2" noValidate>
        <input type="hidden" name="deviationId" value={deviationId} />
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`kind-${deviationId}`}>Kind</Label>
            <select
              id={`kind-${deviationId}`}
              name="kind"
              defaultValue="corrective"
              className={selectClass}
            >
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`owner-${deviationId}`}>Owner</Label>
            <select
              id={`owner-${deviationId}`}
              name="ownerUserId"
              defaultValue=""
              className={selectClass}
            >
              <option value="" disabled>
                Pick…
              </option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <TextField name="dueOn" label="Due on" type="date" min={today} required result={result} />
        </div>
        <TextField name="rootCause" label="Root cause" multiline required result={result} />
        <TextField name="action" label="Action" multiline required result={result} />
        <FormMessage result={result} />
        <Button type="submit" size="sm" className="w-fit" disabled={pending}>
          {pending ? "Saving…" : "Raise CAPA"}
        </Button>
      </form>
    </details>
  );
}

/** Done (the owner), verified (someone else), or a new due date with a reason. */
export function CapaControls({
  capa,
  me,
  canManage,
}: {
  capa: { id: string; status: string; ownerUserId: string };
  me: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [mode, setMode] = useState<"done" | "verify" | "move" | null>(null);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: ok });
        setMode(null);
        setText("");
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  const canDone = capa.status === "open" && (capa.ownerUserId === me || canManage);
  const canVerify = capa.status === "done" && canManage && capa.ownerUserId !== me;
  const canMove = capa.status === "open" && canManage;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {canDone ? (
          <Button size="sm" variant="secondary" onClick={() => setMode("done")}>
            Mark done
          </Button>
        ) : null}
        {canVerify ? (
          <Button size="sm" variant="secondary" onClick={() => setMode("verify")}>
            Verify it worked
          </Button>
        ) : null}
        {canMove ? (
          <Button size="sm" variant="ghost" onClick={() => setMode("move")}>
            Move due date
          </Button>
        ) : null}
      </div>
      {mode ? (
        <form
          className="flex flex-col gap-1.5 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "done")
              run(
                () => completeCapaAction(capa.id, text),
                "Marked done. Someone else verifies it.",
              );
            else if (mode === "verify")
              run(() => verifyCapaAction(capa.id, text), "Verified and closed.");
            else run(() => moveCapaDueAction(capa.id, date, text), "Due date moved.");
          }}
        >
          {mode === "move" ? (
            <Input
              type="date"
              aria-label="New due date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          ) : null}
          <Input
            aria-label={
              mode === "done"
                ? "What was done"
                : mode === "verify"
                  ? "Effectiveness check"
                  : "Why the date moves"
            }
            placeholder={
              mode === "done"
                ? "What was done"
                : mode === "verify"
                  ? "How you know it worked"
                  : "Why the date moves"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy || text.trim().length < 5}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
            Back
          </Button>
        </form>
      ) : null}
      {msg ? (
        <p
          role={msg.ok ? "status" : "alert"}
          className={msg.ok ? "text-xs text-pass" : "text-xs text-fail"}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
