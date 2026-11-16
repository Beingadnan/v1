"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { parseTypedDate, parseTypedTime, toTypedParts } from "@/lib/typed-datetime";
import { cn } from "@/lib/utils";

import { studyPeriodAction } from "../data-actions";

type Period = { cycle: string; label: string; start: Date | null; end: Date | null };

const show = (at: Date | number) => toTypedParts(at).join(", ");

function hours(from: number, to: number) {
  const min = Math.round((to - from) / 60_000);
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/**
 * The period a cycle is read for, typed once the data is in (QA Tech, Nov
 * 2026): "from 01-08-2026 11:30 AM to 02-08-2026 11:30 AM". Dates as
 * dd-mm-yyyy, times as 11:30 AM or 23:30, India time. The readings in it are
 * what the checks and the analysis use.
 */
export function StudyPeriod({
  studyId,
  periods,
  dataFrom,
  dataTo,
  canSet,
}: {
  studyId: string;
  periods: Period[];
  /** The uploaded data's first and last reading (ms), to see what can be chosen. */
  dataFrom: number | null;
  dataTo: number | null;
  canSet: boolean;
}) {
  return (
    <section
      aria-labelledby="study-period"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="study-period" className="flex items-center gap-2 font-semibold">
          <CalendarClock className="size-4" aria-hidden="true" />
          Study period
        </h3>
        {dataFrom !== null && dataTo !== null ? (
          <span className="text-xs text-muted-foreground">
            Data uploaded covers {show(dataFrom)} to {show(dataTo)}
          </span>
        ) : null}
      </div>
      {periods.map((p) => (
        <PeriodRow
          key={p.cycle}
          studyId={studyId}
          period={p}
          many={periods.length > 1}
          dataFrom={dataFrom}
          dataTo={dataTo}
          canSet={canSet}
        />
      ))}
    </section>
  );
}

function PeriodRow({
  studyId,
  period: p,
  many,
  dataFrom,
  dataTo,
  canSet,
}: {
  studyId: string;
  period: Period;
  many: boolean;
  dataFrom: number | null;
  dataTo: number | null;
  canSet: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const begin = p.start ?? (dataFrom !== null ? new Date(dataFrom) : null);
  const finish = p.end ?? (dataTo !== null ? new Date(dataTo) : null);
  const [form, setForm] = useState(() => {
    const [sd, st] = begin ? toTypedParts(begin) : ["", ""];
    const [ed, et] = finish ? toTypedParts(finish) : ["", ""];
    return { sd, st, ed, et, reason: "" };
  });

  const sd = parseTypedDate(form.sd);
  const st = parseTypedTime(form.st);
  const ed = parseTypedDate(form.ed);
  const et = parseTypedTime(form.et);
  const from = sd && st ? Date.parse(`${sd}T${st}:00+05:30`) : null;
  const to = ed && et ? Date.parse(`${ed}T${et}:00+05:30`) : null;
  const problem =
    from === null || to === null
      ? null
      : to <= from
        ? "The end must be after the start."
        : dataFrom !== null && dataTo !== null && (from < dataFrom || to > dataTo)
          ? "Part of this period is outside the uploaded data: those hours will show as missing readings."
          : null;
  const needsReason = p.start !== null;

  function save() {
    if (!sd || !st || !ed || !et) {
      setMessage({
        ok: false,
        text: "Type the dates as dd-mm-yyyy (01-08-2026) and the times as 11:30 AM or 23:30.",
      });
      return;
    }
    start(async () => {
      const r = await studyPeriodAction(studyId, {
        cycle: p.cycle,
        start: `${sd}T${st}`,
        end: `${ed}T${et}`,
        reason: form.reason,
      });
      if (r.ok) {
        setMessage({ ok: true, text: "Study period saved; the data is checked again." });
        setEditing(false);
        router.refresh();
      } else setMessage({ ok: false, text: r.error });
    });
  }

  const field = (
    key: "sd" | "st" | "ed" | "et",
    label: string,
    placeholder: string,
    ok: boolean,
  ) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Input
        value={form[key]}
        placeholder={placeholder}
        inputMode={key === "sd" || key === "ed" ? "numeric" : "text"}
        autoComplete="off"
        aria-invalid={form[key] !== "" && !ok}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setMessage(null);
        }}
        className={cn(form[key] !== "" && !ok && "border-fail")}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          {many ? <span className="font-medium">{p.label}: </span> : null}
          {p.start && p.end ? (
            <>
              {show(p.start)} to {show(p.end)}{" "}
              <span className="text-muted-foreground">
                ({hours(p.start.getTime(), p.end.getTime())})
              </span>
            </>
          ) : (
            <span className="text-attention">
              Not set: the whole uploaded data is read. Set the period the study ran.
            </span>
          )}
        </p>
        {canSet && !editing ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {p.start ? "Change" : "Set the period"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3 rounded-md bg-surface-muted p-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {field("sd", "Start date", "01-08-2026", !!sd)}
            {field("st", "Start time", "11:30 AM", !!st)}
            {field("ed", "End date", "02-08-2026", !!ed)}
            {field("et", "End time", "11:30 AM", !!et)}
          </div>
          {from !== null && to !== null && to > from ? (
            <p className="text-sm text-muted-foreground">
              {show(from)} to {show(to)}: {hours(from, to)}.
            </p>
          ) : null}
          {problem ? <p className="text-sm text-attention">{problem}</p> : null}
          {needsReason ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Why does it change?
              <Input
                value={form.reason}
                placeholder="e.g. loggers started at 11:30; the site tapped Start late"
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || (needsReason && form.reason.trim().length < 3)}
              onClick={save}
            >
              {busy ? "Saving…" : "Save the period"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            message.ok ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
