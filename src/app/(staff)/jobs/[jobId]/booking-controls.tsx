"use client";

import { Plus, ScanLine, Search, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";
import { Input } from "@/components/ui/form-controls";
import { UploadFile } from "@/components/ui/upload-file";
import type { BookingChoices, BookingLogger, LoggerState } from "@/domain/jobs/job-service";
import { cn } from "@/lib/utils";

import { bookByCodesAction, recordGatePassAction } from "../actions";

const dmy = (iso: string) => iso.split("-").reverse().join(".");

/**
 * The client's gate pass, asked for before the booking (QA Tech, Nov 2026):
 * its number and an optional scan, or "not needed at this site".
 */
export function GatePassForm({
  jobId,
  number,
  hasScan,
}: {
  jobId: string;
  number: string;
  hasScan: boolean;
}) {
  const { result, pending, onSubmit } = useFormAction(recordGatePassAction);
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div>
        <h3 className="font-semibold">1. Client&apos;s gate pass</h3>
        <p className="text-sm text-muted-foreground">
          The number on the client&apos;s gate pass for QA Tech&apos;s instruments. The booking
          opens once it is in.
        </p>
      </div>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="number"
          label="Gate pass number"
          defaultValue={number}
          result={result}
          autoComplete="off"
        />
        <div className="flex flex-col justify-end">
          <UploadFile
            name="fileId"
            label="Upload the scan (optional)"
            current={
              hasScan ? { name: "Current scan", href: `/jobs/${jobId}/gate-pass/scan` } : null
            }
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notNeeded" className="size-4 accent-primary" />
        No gate pass needed at this site
      </label>
      <FormMessage result={result} />
      <Button type="submit" size="sm" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save gate pass"}
      </Button>
    </form>
  );
}

const STATES: { key: LoggerState | "all"; label: string; dot: string }[] = [
  { key: "free", label: "Free", dot: "bg-pass" },
  { key: "booked", label: "On this job", dot: "bg-primary" },
  { key: "busy", label: "On other jobs", dot: "bg-attention" },
  { key: "out_of_date", label: "Calibration due", dot: "bg-fail" },
  { key: "not_in_use", label: "Not in use", dot: "bg-muted-foreground" },
  { key: "all", label: "All", dot: "" },
];
const STATE_TEXT: Record<LoggerState, string> = {
  free: "text-pass",
  booked: "text-primary",
  busy: "text-attention",
  out_of_date: "text-fail",
  not_in_use: "text-muted-foreground",
};
const PAGE = 60;

/**
 * Booking by hand (QA Tech, Nov 2026): pick the model, then tick free
 * loggers or type or scan an ID or serial. Every logger of the model is
 * listed with where it stands: free (and where it is kept), on this job, on
 * another job (which, whose and when), calibration due, or not in use. A list
 * or range can be pasted too.
 */
export function BookingPicker({ jobId, choices }: { jobId: string; choices: BookingChoices }) {
  const [modelIndex, setModelIndex] = useState(0);
  const model = choices.models[modelIndex];
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [show, setShow] = useState<LoggerState | "all">("free");
  const [limit, setLimit] = useState(PAGE);
  const { result, pending, onSubmit } = useFormAction(bookByCodesAction);

  // Every logger of every model, by ID and serial, to say exactly why a typed one can't go.
  const everywhere = useMemo(() => {
    const map = new Map<string, { l: BookingLogger; model: string }>();
    for (const m of choices.models) {
      for (const l of m.loggers) {
        map.set(l.code.toLowerCase(), { l, model: m.label });
        if (l.serialNo) map.set(l.serialNo.toLowerCase(), { l, model: m.label });
      }
    }
    return map;
  }, [choices]);

  if (choices.models.length === 0 || !model) {
    return (
      <p className="text-sm text-muted-foreground">
        No loggers of the kind these studies need are in the register.
      </p>
    );
  }

  // What this model's kind of logger is needed for: 16 needed means 16 at most.
  const needOf = choices.needs.find((n) => n.type === model.type);
  const need = needOf?.needed ?? choices.needs.reduce((n, x) => n + x.needed, 0);
  const have = needOf?.booked ?? choices.needs.reduce((n, x) => n + x.booked, 0);
  const full = need > 0 && have + picked.length >= need;
  const fullNote = `The studies need ${need} and ${need} are ${have >= need ? "booked" : "booked or ticked"}. Untick one first, or raise the number of loggers on the study.`;
  const counts: Record<LoggerState | "all", number> = {
    free: model.free.length,
    booked: model.booked,
    busy: model.busy,
    out_of_date: model.outOfDate,
    not_in_use: model.notInUse,
    all: model.total,
  };
  const query = typed.trim().toLowerCase();
  const list = model.loggers.filter(
    (l) =>
      (show === "all" || l.state === show) &&
      (!query || l.code.toLowerCase().includes(query) || l.serialNo.toLowerCase().includes(query)),
  );
  const stillNeeded = Math.max(0, need - have - picked.length);
  const freeLeft = model.free.filter((f) => !picked.includes(f.code));

  const toggle = (code: string) => {
    if (picked.includes(code)) {
      setPicked(picked.filter((c) => c !== code));
      setNote(null);
    } else if (full) {
      setNote(fullNote);
    } else {
      setPicked([...picked, code]);
      setNote(null);
    }
  };

  const add = () => {
    const text = typed.trim();
    if (!text) return;
    const hit = everywhere.get(text.toLowerCase());
    if (!hit) {
      setNote(`${text} is not in the register as a logger of the kind these studies need.`);
    } else if (hit.model !== model.label) {
      setNote(
        `${hit.l.code} (serial ${hit.l.serialNo || "-"}) is a ${hit.model}, not a ${model.label}. Pick ${hit.model} above to book it.`,
      );
    } else if (hit.l.state !== "free") {
      setNote(`${hit.l.code} (serial ${hit.l.serialNo || "-"}) can't be booked: ${hit.l.where}.`);
    } else if (picked.includes(hit.l.code)) {
      setNote(`${hit.l.code} is already in the list.`);
    } else if (full) {
      setNote(fullNote);
    } else {
      setPicked([...picked, hit.l.code]);
      setNote(null);
      setTyped("");
      return;
    }
  };

  return (
    <form
      onSubmit={(e) => {
        onSubmit(e);
        setPicked([]);
      }}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="model" value={model.label === "No model" ? "" : model.label} />
      <input type="hidden" name="codes" value={picked.join("\n")} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">2. Book the loggers</h3>
          <p className="text-sm text-muted-foreground">
            Pick the model, then tick free loggers or type or scan them.
          </p>
        </div>
        <div className="w-full sm:w-auto sm:min-w-44 sm:text-right">
          <p className="text-sm font-medium">
            {have + picked.length} of {need} {picked.length ? "picked" : "booked"}
          </p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full bg-pass"
              style={{
                width: `${need ? Math.min(100, ((have + picked.length) / need) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Model
        <select
          value={modelIndex}
          onChange={(e) => {
            setModelIndex(Number(e.target.value));
            setPicked([]);
            setNote(null);
            setLimit(PAGE);
          }}
          className="h-10 rounded-md border border-input bg-surface px-3 text-sm font-normal"
        >
          {choices.models.map((m, i) => (
            <option key={`${m.type}-${m.label}`} value={i}>
              {m.label}: {m.free.length} free of {m.total}
            </option>
          ))}
        </select>
      </label>

      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
        {STATES.map((st) => (
          <button
            key={st.key}
            type="button"
            role="tab"
            aria-selected={show === st.key}
            onClick={() => {
              setShow(st.key);
              setLimit(PAGE);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
              show === st.key
                ? "border-primary bg-brand-soft font-medium text-primary"
                : "border-border bg-surface text-foreground hover:bg-surface-muted",
            )}
          >
            {st.dot ? (
              <span className={cn("size-2 rounded-full", st.dot)} aria-hidden="true" />
            ) : null}
            {st.label}
            <span className="text-xs text-muted-foreground">{counts[st.key]}</span>
          </button>
        ))}
      </div>

      {paste ? (
        <TextField
          name="pasted"
          label="IDs or serials, or a range like T-TRH001 – T-TRH024"
          multiline
          onChange={(e) => {
            const all = e.currentTarget.value
              .split(/[\n,;]+/)
              .map((x) => x.trim())
              .filter(Boolean);
            setPicked(all);
            setNote(
              need > 0 && have + all.length > need
                ? `${have + all.length - need} more than the ${need} needed: only the first ${Math.max(0, need - have)} will be booked.`
                : null,
            );
          }}
        />
      ) : null}
      {paste && note ? (
        <p role="alert" className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          {note}
        </p>
      ) : null}
      {paste ? null : (
        <div className="flex flex-col gap-1">
          <label htmlFor="logger-typed" className="sr-only">
            Type or scan an ID or serial
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="logger-typed"
                value={typed}
                autoComplete="off"
                placeholder="Type or scan an ID or serial, e.g. 84095204"
                className="pl-8"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setTyped(e.target.value);
                  setNote(null);
                  setLimit(PAGE);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  // A barcode scanner types the code and presses Enter.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </div>
            <Button type="button" variant="secondary" onClick={add}>
              <Plus aria-hidden="true" />
              Add
            </Button>
          </div>
          {note ? (
            <p
              role="alert"
              className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention"
            >
              {note}
            </p>
          ) : null}
        </div>
      )}

      {!paste ? (
        <div className="overflow-hidden rounded-md border border-border">
          {full && show === "free" ? (
            <p className="border-b border-border bg-pass-soft px-3 py-2 text-sm text-pass">
              All {need} needed are {have >= need ? "booked" : "booked or ticked"}. Untick one to
              swap it.
            </p>
          ) : null}
          {stillNeeded > 0 && freeLeft.length > 0 && show === "free" && !query ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-2 text-sm">
              <span>{stillNeeded} more needed.</span>
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() =>
                  setPicked([...picked, ...freeLeft.slice(0, stillNeeded).map((f) => f.code)])
                }
              >
                Tick the next {Math.min(stillNeeded, freeLeft.length)} free in order
              </button>
            </div>
          ) : null}
          {list.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query ? `Nothing matches “${typed.trim()}” here.` : "None."}
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {list.slice(0, limit).map((l) => {
                const free = l.state === "free";
                const on = picked.includes(l.code);
                return (
                  <li key={l.code}>
                    <label
                      className={cn(
                        "grid grid-cols-[1.25rem_minmax(6rem,auto)_1fr] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[1.25rem_8rem_7rem_1fr_6rem]",
                        free && (on || !full)
                          ? "cursor-pointer hover:bg-surface-muted"
                          : "opacity-90",
                        on && "bg-pass-soft",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={on || l.state === "booked"}
                        disabled={!free || (full && !on)}
                        onChange={() => toggle(l.code)}
                        aria-label={`Book ${l.code}`}
                      />
                      <span className="font-mono font-medium">{l.code}</span>
                      <span className="text-muted-foreground sm:order-none">
                        <span className="sm:hidden">S/N </span>
                        {l.serialNo || "-"}
                      </span>
                      <span
                        className={cn("col-start-2 col-end-4 sm:col-auto", STATE_TEXT[l.state])}
                      >
                        {l.where}
                      </span>
                      <span className="hidden text-right text-xs text-muted-foreground sm:block">
                        {l.validUntil ? `due ${dmy(l.validUntil)}` : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit(limit + PAGE * 4)}
              className="w-full border-t border-border py-2 text-sm text-primary hover:bg-surface-muted"
            >
              Show more ({list.length - limit} left)
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="w-fit text-sm text-primary underline"
        onClick={() => {
          setPaste(!paste);
          setPicked([]);
        }}
      >
        <ScanLine className="mr-1 inline size-4" aria-hidden="true" />
        {paste ? "Pick from the list instead" : "Paste a list or a range instead"}
      </button>

      {!paste && picked.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="To book">
          {picked.map((c) => (
            <li
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-pass-soft px-2 py-0.5 text-sm text-pass"
            >
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => toggle(c)}>
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {result?.ok ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md bg-surface-muted px-3 py-2 text-sm"
        >
          {result.data.booked.length > 0 ? (
            <p className="text-pass">
              Booked {result.data.booked.length}: {result.data.booked.join(", ")}
            </p>
          ) : null}
          {result.data.refused.map((r) => (
            <p key={r.code} className="text-fail">
              {r.code}: {r.reason}
            </p>
          ))}
          {result.data.notFound.length > 0 ? (
            <p className="text-attention">Not in the register: {result.data.notFound.join(", ")}</p>
          ) : null}
        </div>
      ) : (
        <FormMessage result={result} />
      )}
      <Button type="submit" disabled={pending || picked.length === 0} className="w-fit">
        {pending
          ? "Booking…"
          : picked.length === 0
            ? "Tick loggers to book"
            : `Book ${picked.length} ${picked.length === 1 ? "logger" : "loggers"}`}
      </Button>
    </form>
  );
}
