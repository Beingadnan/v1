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

/** "2026-11-12" + "00:00" in India time → ms, or null. */
const istMs = (date: string | null, time: string | null) =>
  date && time ? Date.parse(`${date}T${time}:00+05:30`) : null;

/**
 * The period the report covers, chosen from the uploaded data (QA Tech, Nov
 * 2026): the data comes first, then "from 12-11-2026 12:00 AM for 24 h".
 * Dates as dd-mm-yyyy (or 12-11-26), times as 12 AM, 11:30 AM or 23:30, India
 * time. The readings in it are what the checks, the analysis and the report use.
 */
export function StudyPeriod({
  studyId,
  periods,
  dataFrom,
  dataTo,
  durationHours,
  canSet,
}: {
  studyId: string;
  periods: Period[];
  /** The uploaded data's first and last reading (ms). */
  dataFrom: number;
  dataTo: number;
  /** The study's planned length, offered as the default length. */
  durationHours: number | null;
  canSet: boolean;
}) {
  return (
    <section
      aria-labelledby="study-period"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="study-period" className="flex items-center gap-2 font-semibold">
          <CalendarClock className="size-4" aria-hidden="true" />
          Report period
        </h2>
        <span className="text-xs text-muted-foreground">
          Uploaded data: {show(dataFrom)} to {show(dataTo)} ({hours(dataFrom, dataTo)})
        </span>
      </div>
      {periods.map((p) => (
        <PeriodRow
          key={p.cycle}
          studyId={studyId}
          period={p}
          many={periods.length > 1}
          dataFrom={dataFrom}
          dataTo={dataTo}
          durationHours={durationHours}
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
  durationHours,
  canSet,
}: {
  studyId: string;
  period: Period;
  many: boolean;
  dataFrom: number;
  dataTo: number;
  durationHours: number | null;
  canSet: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // Not set yet: the form is open straight away, filled from the data.
  const [editing, setEditing] = useState(canSet && !(p.start && p.end));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState(() => {
    const begin = p.start?.getTime() ?? dataFrom;
    const planned = durationHours ? begin + durationHours * 3600_000 : null;
    const finish = p.end?.getTime() ?? (planned && planned <= dataTo ? planned : dataTo);
    const [sd, st] = toTypedParts(begin);
    const [ed, et] = toTypedParts(finish);
    return { sd, st, ed, et, reason: "" };
  });

  const sd = parseTypedDate(form.sd);
  const st = parseTypedTime(form.st);
  const ed = parseTypedDate(form.ed);
  const et = parseTypedTime(form.et);
  const from = istMs(sd, st);
  const to = istMs(ed, et);
  const problem =
    from === null || to === null
      ? null
      : to <= from
        ? "The end must be after the start."
        : from < dataFrom || to > dataTo
          ? "Part of this period is outside the uploaded data: those hours will show as missing readings."
          : null;
  const needsReason = p.start !== null;

  /** Sets the end to the start plus a number of hours. */
  function lengthOf(h: number) {
    if (from === null) {
      setMessage({ ok: false, text: "Type the start date and time first." });
      return;
    }
    const [ed2, et2] = toTypedParts(from + h * 3600_000);
    setForm({ ...form, ed: ed2, et: et2 });
    setMessage(null);
  }

  function wholeData() {
    const [sd2, st2] = toTypedParts(dataFrom);
    const [ed2, et2] = toTypedParts(dataTo);
    setForm({ ...form, sd: sd2, st: st2, ed: ed2, et: et2 });
    setMessage(null);
  }

  function save() {
    if (!sd || !st || !ed || !et) {
      setMessage({
        ok: false,
        text: "Type the dates as dd-mm-yyyy (12-11-2026) and the times as 12 AM, 11:30 AM or 23:30.",
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
        setMessage({ ok: true, text: "Report period saved; the data is checked again for it." });
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

  const lengths = [...new Set([durationHours ?? 24, 24, 48, 72])].filter((h) => h > 0);

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
          ) : p.start ? (
            <span className="text-attention">
              Started {show(p.start)} on site, not ended. Choose the end from the data.
            </span>
          ) : (
            <span className="text-attention">
              Not chosen yet: choose the start and end the report covers.
            </span>
          )}
        </p>
        {canSet && !editing ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {!canSet && !(p.start && p.end) ? (
        <p className="text-xs text-muted-foreground">
          A team leader or manager chooses the period.
        </p>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-3 rounded-md bg-surface-muted p-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {field("sd", "Start date", "12-11-2026", !!sd)}
            {field("st", "Start time", "12:00 AM", !!st)}
            {field("ed", "End date", "13-11-2026", !!ed)}
            {field("et", "End time", "12:00 AM", !!et)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">End after:</span>
            {lengths.map((h) => (
              <Button
                key={h}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => lengthOf(h)}
              >
                {h} h
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" onClick={wholeData}>
              Whole data
            </Button>
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
                placeholder="e.g. report from midnight; the loggers ran longer"
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
            {p.start && p.end ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
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
