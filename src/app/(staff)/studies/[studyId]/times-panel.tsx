"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { EVENT_LABELS, markersFor, type CycleKey, type EventKind } from "@/domain/field/types";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";

import { voidEventAction } from "../actions";
import { useOutbox, type Outcome } from "../outbox";

type Cycle = {
  cycle: CycleKey;
  label: string;
  startedAt: Date | null;
  endedAt: Date | null;
  done: boolean;
  next: EventKind | null;
  events: {
    id: string;
    kind: string;
    at: Date;
    note: string;
    voided: boolean;
    by?: string | null;
  }[];
};

const time = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

/** "2026-10-30T14:05" in the phone's own time, for a datetime-local box. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function duration(from: Date, to: Date): string {
  const min = Math.round((to.getTime() - from.getTime()) / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/**
 * Start and end of each cycle, and door / power markers, recorded at the
 * moment they are tapped (or at a time typed in, when recorded afterwards).
 * Works without signal: taps wait on the phone and are sent later.
 */
export function TimesPanel({
  studyId,
  cycles,
  canStart,
  readOnly,
  durationHours,
  plannedStart,
  plannedEnd,
  thermal = false,
}: {
  studyId: string;
  cycles: Cycle[];
  canStart: boolean;
  readOnly: boolean;
  durationHours: number | null;
  /** The job's planned days, "YYYY-MM-DD"; loggers were checked for these. */
  plannedStart: string;
  plannedEnd: string;
  /** Autoclave / oven / SIP: every cycle has a hold start and end. */
  thermal?: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [custom, setCustom] = useState<Record<string, string>>({});
  // The typed time is read from the field itself when the button is pressed: a
  // time typed while the page is still loading (slow mobile data) shows in the
  // field but never reached the state, and must not turn into "now".
  const typedInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  // Ending well before the planned duration asks once more: the End button is big.
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const onDone = useCallback(
    ({ entry, result }: Outcome) => {
      if (entry.kind !== "event") return;
      setFeedback(
        result.ok
          ? { ok: true, text: `Sent: ${entry.label}.` }
          : { ok: false, text: `${entry.label} was not recorded: ${result.error}` },
      );
      router.refresh();
    },
    [router],
  );
  const { pending, signedOut, run } = useOutbox(studyId, onDone);
  const queued = pending.filter((p) => p.kind === "event");

  function record(c: Cycle, kind: EventKind) {
    const typed = typedInputs.current[c.cycle]?.value || custom[c.cycle];
    const at = typed ? new Date(typed) : new Date();
    if (Number.isNaN(at.getTime())) {
      setFeedback({ ok: false, text: "That time is not valid." });
      return;
    }
    if (kind !== "start" && c.startedAt && at.getTime() < c.startedAt.getTime()) {
      setFeedback({
        ok: false,
        text: `${time(at)} is before ${c.label.toLowerCase()} started (${time(c.startedAt)}). Check the time.`,
      });
      return;
    }
    if (kind === "end" && c.startedAt && durationHours && confirmEnd !== c.cycle) {
      const planned = durationHours * 3600_000;
      if (at.getTime() - c.startedAt.getTime() < planned * 0.9) {
        setConfirmEnd(c.cycle);
        setFeedback({
          ok: false,
          text: `${c.label} has run ${duration(c.startedAt, at)} of the planned ${durationHours} h. Tap “End anyway” only if it really ends now.`,
        });
        return;
      }
    }
    setConfirmEnd(null);
    const label = `${c.label}: ${EVENT_LABELS[kind]} at ${time(at)}`;
    setFeedback(null);
    start(async () => {
      const r = await run({
        studyId,
        kind: "event",
        label,
        payload: { id: newId(), cycle: c.cycle, kind, at: at.toISOString() },
      });
      if (r === "signed_out")
        setFeedback({
          ok: false,
          text: `You were signed out. ${label} is kept on this phone: sign in again (in a new tab) and it will be sent.`,
        });
      else if (r === "queued")
        setFeedback({
          ok: true,
          text: `No connection: ${label} is kept on this phone and will be sent.`,
        });
      else if (r.ok) {
        setFeedback({ ok: true, text: `${label} recorded.` });
        setCustom((m) => ({ ...m, [c.cycle]: "" }));
        router.refresh();
      } else setFeedback({ ok: false, text: r.error });
    });
  }

  function strike(id: string, reason: string) {
    start(async () => {
      const r = await voidEventAction(studyId, id, reason);
      setFeedback(r.ok ? { ok: true, text: "Time struck out." } : { ok: false, text: r.error });
      if (r.ok) {
        setVoiding(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!canStart && !readOnly ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          Place a logger at every position before starting (or remove the empty positions in
          Layout).
        </p>
      ) : null}
      {!readOnly && cycles.some((c) => !c.startedAt) ? (
        <OutsideDates plannedStart={plannedStart} plannedEnd={plannedEnd} />
      ) : null}
      {cycles.map((c) => {
        const waiting = queued.filter((q) => q.kind === "event" && q.payload.cycle === c.cycle);
        const expectedEnd =
          c.startedAt && durationHours
            ? new Date(c.startedAt.getTime() + durationHours * 3600_000)
            : null;
        return (
          <section
            key={c.cycle}
            aria-labelledby={`cycle-${c.cycle}`}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`cycle-${c.cycle}`} className="font-semibold">
                {c.label}
              </h3>
              <span
                className={cn(
                  "text-sm",
                  c.done ? "text-pass" : c.startedAt ? "text-info" : "text-muted-foreground",
                )}
              >
                {c.done && c.startedAt && c.endedAt
                  ? `Done · ${duration(c.startedAt, c.endedAt)}`
                  : c.startedAt
                    ? `Running since ${time(c.startedAt)}`
                    : "Not started"}
              </span>
            </div>
            {expectedEnd && !c.done ? (
              <p className="text-xs text-muted-foreground">
                {durationHours} h study: ends about {time(expectedEnd)}.
              </p>
            ) : null}

            {c.events.length > 0 ? (
              <ol className="flex flex-col gap-1 text-sm">
                {c.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className={cn(e.voided && "line-through opacity-60")}>
                      {EVENT_LABELS[e.kind as EventKind]} · {time(e.at)}
                    </span>
                    {e.by ? <span className="text-xs text-muted-foreground">{e.by}</span> : null}
                    {!readOnly && !e.voided ? (
                      voiding?.id === e.id ? (
                        <span className="flex w-full gap-2">
                          <Input
                            aria-label="Why is this time wrong?"
                            placeholder="Why is it wrong?"
                            value={voiding.reason}
                            onChange={(ev) => setVoiding({ id: e.id, reason: ev.target.value })}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={busy || !voiding.reason.trim()}
                            onClick={() => strike(e.id, voiding.reason)}
                          >
                            Strike out
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setVoiding(null)}
                          >
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-primary underline"
                          onClick={() => setVoiding({ id: e.id, reason: "" })}
                        >
                          Wrong time?
                        </button>
                      )
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}

            {waiting.length > 0 ? (
              <p className="text-xs text-attention">
                {waiting.length} waiting to send{signedOut ? " (sign in again)" : ""}:{" "}
                {waiting.map((w) => w.label.split(": ")[1]).join(", ")}
              </p>
            ) : null}

            {!readOnly && !c.done ? (
              <div className="flex flex-col gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  {markersFor(c.cycle, thermal)
                    .filter((k) => {
                      if (!c.startedAt) return k === "start";
                      if (k === "start") return false;
                      const live = c.events.filter((e) => !e.voided);
                      const holdOn = live.some((e) => e.kind === "hold_start");
                      const holdOff = live.some((e) => e.kind === "hold_end");
                      if (k === "hold_start") return !holdOn;
                      if (k === "hold_end") return holdOn && !holdOff;
                      if (k === "end" && holdOn && !holdOff) return false;
                      const opened =
                        live.filter((e) => e.kind === "door_opened").length -
                        live.filter((e) => e.kind === "door_closed").length;
                      const off =
                        live.filter((e) => e.kind === "power_off").length -
                        live.filter((e) => e.kind === "power_on").length;
                      if (k === "door_opened") return opened <= 0;
                      if (k === "door_closed") return opened > 0;
                      if (k === "power_off") return off <= 0;
                      if (k === "power_on") return off > 0;
                      return opened <= 0 && off <= 0; // end
                    })
                    .map((k) => (
                      <Button
                        key={k}
                        type="button"
                        size="lg"
                        variant={k === "start" || k === "end" ? "primary" : "secondary"}
                        disabled={busy || (k === "start" && !canStart)}
                        onClick={() => record(c, k)}
                      >
                        {k === "start"
                          ? `Start ${c.label.toLowerCase()}`
                          : k === "end"
                            ? confirmEnd === c.cycle
                              ? "End anyway"
                              : `End ${c.label.toLowerCase()}`
                            : EVENT_LABELS[k]}
                      </Button>
                    ))}
                </div>
                <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Happened earlier? Time:
                  <Input
                    ref={(el) => {
                      typedInputs.current[c.cycle] = el;
                    }}
                    type="datetime-local"
                    value={custom[c.cycle] ?? ""}
                    max={localInput(new Date())}
                    onChange={(e) => setCustom((m) => ({ ...m, [c.cycle]: e.target.value }))}
                    className="h-8 w-auto"
                  />
                  {custom[c.cycle] ? (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => setCustom((m) => ({ ...m, [c.cycle]: "" }))}
                    >
                      use now
                    </button>
                  ) : null}
                </label>
              </div>
            ) : null}
          </section>
        );
      })}
      {feedback ? (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            feedback.ok ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
          )}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}

const dmy = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Warns when the work is happening on a day outside the job's planned dates:
 * loggers were checked against those dates, and the report will show them.
 */
function OutsideDates({ plannedStart, plannedEnd }: { plannedStart: string; plannedEnd: string }) {
  const today = useSyncExternalStore(
    () => () => {},
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
    () => null,
  );
  if (!today || (today >= plannedStart && today <= plannedEnd)) return null;
  return (
    <p role="note" className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
      This job is planned for {dmy(plannedStart)} to {dmy(plannedEnd)}, and today is {dmy(today)}.
      If the work really is today, ask the team leader to move the job&apos;s dates first: that
      rechecks every logger&apos;s calibration for the new days.
    </p>
  );
}
