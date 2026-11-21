"use client";

import {
  ChevronRight,
  Download,
  FileSpreadsheet,
  MessageSquareWarning,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-controls";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { StudyData } from "@/domain/data/queries";
import { cn } from "@/lib/utils";

import {
  acceptAction,
  addDataAction,
  closeRequestAction,
  matchAction,
  removeFileAction,
  requestDataAction,
  withdrawAction,
} from "../data-actions";
import { Sparkline } from "./sparkline";

const when = (d: Date | number | null) =>
  d === null
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);

const HOW: Record<string, string> = {
  serial: "by serial",
  code: "by logger ID",
  label: "by position",
  manual: "matched by hand",
};

type Feedback = { ok: boolean; text: string } | null;

function Message({ f }: { f: Feedback }) {
  if (!f) return null;
  return (
    <p
      role={f.ok ? "status" : "alert"}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        f.ok ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
      )}
    >
      {f.text}
    </p>
  );
}

function statusOf(d: StudyData): { tone: StatusTone; text: string } {
  switch (d.study.dataStatus) {
    case "none":
      return { tone: "neutral", text: "No data yet" };
    case "issues":
      return { tone: "fail", text: `${d.open} problem${d.open === 1 ? "" : "s"} to resolve` };
    case "checked":
      return { tone: "info", text: "Checked: waiting to be confirmed" };
    case "received":
      return { tone: "pass", text: "Received" };
  }
}

/** Upload, read and check the logger data of one study; confirm it when it's right. */
export function DataPanel({ data: d }: { data: StudyData }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [replacing, setReplacing] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [accepting, setAccepting] = useState<{ fingerprint: string; reason: string } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; note: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const status = statusOf(d);
  // A Ready job takes its first upload too: the data comes before the period (Nov 2026).
  const open = ["created", "on_hold"].includes(d.study.jobStatus)
    ? `Job ${d.study.jobNumber} isn't ready for field work yet: data can be uploaded once it is.`
    : !["ready", "field_work", "data_issue", "data_received"].includes(d.study.jobStatus)
      ? `Job ${d.study.jobNumber} has moved on; the data can't be changed here.`
      : null;
  const canImport = d.can.import && !open;
  const canAccept = d.can.accept && !open;
  const current = d.files.filter((f) => !f.replaced);
  const history = d.files.filter((f) => f.replaced);

  const run = <T,>(
    fn: () => Promise<{ ok: true; data?: T; message?: string } | { ok: false; error: string }>,
    done: (r: T | undefined) => string,
    after?: () => void,
  ) =>
    start(async () => {
      setFeedback(null);
      const r = await fn();
      if (r.ok) {
        setFeedback({ ok: true, text: done(r.data) });
        after?.();
        router.refresh();
      } else setFeedback({ ok: false, text: r.error });
    });

  async function upload(file: File) {
    setFeedback(null);
    const body = new FormData();
    body.append("file", file, file.name);
    let res: Response;
    try {
      res = await fetch("/api/files", { method: "POST", body });
    } catch {
      setFeedback({ ok: false, text: "No connection. Try again when you're online." });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (res.status === 401) {
      setFeedback({
        ok: false,
        text: `You were signed out, so ${file.name} wasn't uploaded. Sign in again (in a new tab), then choose the file again.`,
      });
      return;
    }
    if (!res.ok || !json.id) {
      setFeedback({ ok: false, text: json.error ?? "The file couldn't be uploaded." });
      return;
    }
    const replaces = replacing?.id;
    run(
      () =>
        addDataAction(d.study.id, {
          fileId: json.id!,
          fileName: file.name,
          replaces,
          reason: replaces ? reason : undefined,
        }),
      (r) =>
        r
          ? `${file.name}: ${r.readings} readings of ${r.channels} column${r.channels === 1 ? "" : "s"} read from “${r.sheet}”; ${r.matched} matched to positions.${
              r.blockers
                ? ` ${r.blockers} problem${r.blockers === 1 ? "" : "s"} to resolve below.`
                : " Nothing wrong found."
            }`
          : "Uploaded.",
      () => {
        setReplacing(null);
        setReason("");
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Where things stand */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Logger data</h2>
          <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
        </div>
        {d.study.dataStatus === "received" ? (
          <p className="text-sm text-muted-foreground">
            Confirmed by {d.study.receivedBy} on {when(d.study.receivedAt)}. Uploading again reopens
            it.
          </p>
        ) : null}
        {open ? <p className="text-sm text-muted-foreground">{open}</p> : null}
        {d.study.dataStatus === "checked" ? (
          <Link
            href={`/studies/${d.study.id}?tab=times`}
            className="inline-flex min-h-10 w-fit items-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Next: choose the report&apos;s start and end
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </section>

      {/* Requests to the site */}
      {d.requests.some((r) => !r.closedAt) || canAccept ? (
        <section aria-labelledby="requests" className="flex flex-col gap-2">
          <h3 id="requests" className="text-sm font-semibold">
            Requests to the site
          </h3>
          {d.requests
            .filter((r) => !r.closedAt)
            .map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-md bg-attention-soft p-3 text-sm"
              >
                <p className="flex items-start gap-2 text-attention">
                  <MessageSquareWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {r.note}
                    <span className="block text-xs opacity-80">
                      {r.by}, {when(r.at)}. Closes by itself when new data is uploaded.
                    </span>
                  </span>
                </p>
                {canAccept ? (
                  closing?.id === r.id ? (
                    <div className="flex gap-2">
                      <Input
                        aria-label="How was it sorted out?"
                        placeholder="How was it sorted out?"
                        value={closing.note}
                        onChange={(e) => setClosing({ id: r.id, note: e.target.value })}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || closing.note.trim().length < 3}
                        onClick={() =>
                          run(
                            () => closeRequestAction(d.study.id, r.id, closing.note),
                            () => "Request closed.",
                            () => setClosing(null),
                          )
                        }
                      >
                        Close
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-fit text-xs text-primary underline"
                      onClick={() => setClosing({ id: r.id, note: "" })}
                    >
                      Sorted out another way?
                    </button>
                  )
                ) : null}
              </div>
            ))}
          {canAccept ? (
            asking === null ? (
              <button
                type="button"
                className="w-fit text-sm text-primary underline"
                onClick={() => setAsking("")}
              >
                Ask the site for data
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <Textarea
                  aria-label="What is needed?"
                  placeholder="e.g. L-03's file is missing; please send the export from the logger software."
                  value={asking}
                  onChange={(e) => setAsking(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || asking.trim().length < 3}
                    onClick={() =>
                      run(
                        () => requestDataAction(d.study.id, asking),
                        () =>
                          "Request sent: it shows on the team's Studies list, and the job is in Data issue until it's answered.",
                        () => setAsking(null),
                      )
                    }
                  >
                    Send request
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )
          ) : null}
        </section>
      ) : null}

      {/* Upload */}
      {canImport ? (
        <section aria-labelledby="upload" className="flex flex-col gap-2">
          <h3 id="upload" className="text-sm font-semibold">
            {replacing ? `Replace ${replacing.name}` : "Upload the logger export"}
          </h3>
          {replacing ? (
            <Input
              aria-label="Why is it being replaced?"
              placeholder="Why? e.g. site resent with L-03's readings"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Excel (.xlsx) or CSV as it came from the site: one workbook for all loggers, or one
              file per logger. Columns are matched to positions by the logger serial.
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            aria-label="Logger export file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || (replacing !== null && reason.trim().length < 5)}
              onClick={() => fileInput.current?.click()}
            >
              <Upload aria-hidden="true" />
              {replacing ? "Choose the new file" : "Choose a file"}
            </Button>
            {replacing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReplacing(null);
                  setReason("");
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {busy ? <p className="text-sm text-muted-foreground">Reading the file…</p> : null}
        </section>
      ) : null}

      <Message f={feedback} />

      {/* Problems */}
      {d.issues.length > 0 ? (
        <section aria-labelledby="problems" className="flex flex-col gap-2">
          <h3 id="problems" className="text-sm font-semibold">
            What the check found
          </h3>
          <ul className="flex flex-col gap-2">
            {d.issues.map((i) => (
              <li
                key={i.fingerprint}
                className={cn(
                  "flex flex-col gap-2 rounded-md border p-3 text-sm",
                  i.accepted
                    ? "border-border bg-surface-muted"
                    : i.severity === "blocker"
                      ? "border-fail/40 bg-fail-soft"
                      : i.severity === "warning"
                        ? "border-attention/40 bg-attention-soft"
                        : "border-border bg-surface",
                )}
              >
                <div className="flex items-start gap-2">
                  <StatusBadge
                    tone={
                      i.accepted
                        ? "neutral"
                        : i.severity === "blocker"
                          ? "fail"
                          : i.severity === "warning"
                            ? "attention"
                            : "info"
                    }
                  >
                    {i.accepted
                      ? "Accepted"
                      : i.severity === "blocker"
                        ? "Must fix"
                        : i.severity === "warning"
                          ? "Check"
                          : "Note"}
                  </StatusBadge>
                  <span className="min-w-0 flex-1">{i.message}</span>
                </div>
                {i.accepted ? (
                  <p className="text-xs text-muted-foreground">
                    {i.accepted.by}, {when(i.accepted.at)}: “{i.accepted.reason}”{" "}
                    {canAccept ? (
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() =>
                          run(
                            () => withdrawAction(d.study.id, i.accepted!.id),
                            () => "Acceptance withdrawn.",
                          )
                        }
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </p>
                ) : i.severity !== "info" && canAccept ? (
                  accepting?.fingerprint === i.fingerprint ? (
                    <div className="flex flex-col gap-2">
                      <Input
                        aria-label="Why can the study go on?"
                        placeholder="Why can the study go on? e.g. logger battery swap, 30 min excluded, see DEV-…"
                        value={accepting.reason}
                        onChange={(e) =>
                          setAccepting({ fingerprint: i.fingerprint, reason: e.target.value })
                        }
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || accepting.reason.trim().length < 5}
                          onClick={() =>
                            run(
                              () => acceptAction(d.study.id, i.fingerprint, accepting.reason),
                              () => "Accepted, with the reason recorded.",
                              () => setAccepting(null),
                            )
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAccepting(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : i.severity === "blocker" ? (
                    <button
                      type="button"
                      className="w-fit text-xs text-primary underline"
                      onClick={() => setAccepting({ fingerprint: i.fingerprint, reason: "" })}
                    >
                      Accept with a reason
                    </button>
                  ) : null
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Positions */}
      {current.length > 0 ? (
        <section aria-labelledby="positions" className="flex flex-col gap-2">
          <h3 id="positions" className="text-sm font-semibold">
            Positions
          </h3>
          <p className="text-xs text-muted-foreground">
            Shaded: the times recorded on site. Point at a line for a reading.
          </p>
          <ul className="flex flex-col gap-2">
            {d.positions.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    {p.label}
                    {p.ambient ? (
                      <span className="font-normal text-muted-foreground"> (ambient)</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.logger ? `${p.logger.code} · ${p.logger.serialNo}` : "no logger"}
                  </span>
                </div>
                {(["temp", "rh"] as const).map((q) => {
                  const c = p[q];
                  const unit = q === "temp" ? "°C" : "%RH";
                  if (!c) {
                    return q === "temp" || d.study.needsRh ? (
                      <p key={q} className="text-sm text-fail">
                        No {unit} readings.
                      </p>
                    ) : null;
                  }
                  return (
                    <div key={q} className="grid gap-2 sm:grid-cols-[1fr_15rem] sm:items-center">
                      <div className="text-xs">
                        <p>
                          {unit}: “{c.header}” in {c.file}{" "}
                          <span className="text-muted-foreground">({HOW[c.how] ?? c.how})</span>
                        </p>
                        {c.stats ? (
                          <p className="text-muted-foreground tabular-nums">
                            min {c.stats.min} · max {c.stats.max} · avg {c.stats.avg} ·{" "}
                            {c.stats.count} readings
                          </p>
                        ) : null}
                        {c.how === "manual" && canImport ? (
                          <button
                            type="button"
                            className="text-primary underline"
                            onClick={() =>
                              run(
                                () =>
                                  matchAction(d.study.id, c.id, {
                                    positionId: null,
                                    ignored: false,
                                  }),
                                () => "Match removed.",
                              )
                            }
                          >
                            Undo match
                          </button>
                        ) : null}
                      </div>
                      <Sparkline
                        points={c.series}
                        windows={d.windows}
                        unit={unit}
                        label={`${p.label} ${unit}`}
                      />
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Columns not matched */}
      {d.others.length > 0 ? (
        <section aria-labelledby="others" className="flex flex-col gap-2">
          <h3 id="others" className="text-sm font-semibold">
            Columns not matched to a position
          </h3>
          <ul className="flex flex-col gap-2">
            {d.others.map((o) => (
              <li
                key={o.id}
                className={cn(
                  "flex flex-col gap-2 rounded-md border border-border p-3 text-sm",
                  o.ignored ? "bg-surface-muted opacity-70" : "bg-surface",
                )}
              >
                <p>
                  “{o.header}” in {o.file} ({o.quantity === "rh" ? "%RH" : "°C"})
                  {o.stats ? (
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      min {o.stats.min} · max {o.stats.max} · avg {o.stats.avg}
                    </span>
                  ) : null}
                </p>
                {canImport ? (
                  o.ignored ? (
                    <button
                      type="button"
                      className="w-fit text-xs text-primary underline"
                      onClick={() =>
                        run(
                          () => matchAction(d.study.id, o.id, { positionId: null, ignored: false }),
                          () => "Column back in the list.",
                        )
                      }
                    >
                      Ignored. Undo
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground" htmlFor={`m-${o.id}`}>
                        Belongs to
                      </label>
                      <select
                        id={`m-${o.id}`}
                        className="h-9 rounded-md border border-input bg-surface px-2 text-sm"
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => {
                          const positionId = e.target.value;
                          if (!positionId) return;
                          const label = d.positions.find((p) => p.id === positionId)?.label;
                          run(
                            () => matchAction(d.study.id, o.id, { positionId, ignored: false }),
                            () => `“${o.header}” matched to ${label}.`,
                          );
                        }}
                      >
                        <option value="">Pick a position…</option>
                        {d.positions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                            {p.logger ? ` (${p.logger.code})` : ""}
                            {p[o.quantity] ? " · has data" : ""}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              matchAction(d.study.id, o.id, { positionId: null, ignored: true }),
                            () => `“${o.header}” ignored.`,
                          )
                        }
                      >
                        Ignore
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Files */}
      {d.files.length > 0 ? (
        <section aria-labelledby="files" className="flex flex-col gap-2">
          <h3 id="files" className="text-sm font-semibold">
            Files
          </h3>
          <ul className="flex flex-col gap-2">
            {[...current, ...history].map((f) => (
              <li
                key={f.id}
                className={cn(
                  "flex flex-col gap-1 rounded-md border border-border p-3 text-sm",
                  f.replaced ? "bg-surface-muted" : "bg-surface",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      "flex items-center gap-2 font-medium",
                      f.replaced && "line-through opacity-70",
                    )}
                  >
                    <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden="true" />
                    {f.name}
                  </span>
                  <span className="flex gap-3 text-xs">
                    <a
                      href={`/studies/${d.study.id}/data/${f.id}`}
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      Original
                    </a>
                    {!f.replaced && canImport ? (
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => {
                          setReplacing({ id: f.id, name: f.name });
                          setReason("");
                          fileInput.current?.focus();
                        }}
                      >
                        Replace
                      </button>
                    ) : null}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sheet “{f.sheet}” · {f.readings} readings · every {f.interval ?? "?"} min ·{" "}
                  {when(f.first)} to {when(f.last)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.by}, {when(f.at)} · SHA-256 {f.sha256.slice(0, 12)}…
                </p>
                {!f.replaced && canImport ? (
                  removing?.id === f.id ? (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label="Why remove it?"
                        placeholder="Why? e.g. wrong study's file"
                        value={removing.reason}
                        onChange={(e) => setRemoving({ id: f.id, reason: e.target.value })}
                        className="min-w-48 flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={busy || removing.reason.trim().length < 5}
                        onClick={() =>
                          run(
                            () => removeFileAction(d.study.id, f.id, removing.reason),
                            () => `${f.name} removed. It stays in the history below.`,
                            () => setRemoving(null),
                          )
                        }
                      >
                        Remove
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemoving(null)}
                      >
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-fit text-xs text-fail underline"
                      onClick={() => setRemoving({ id: f.id, reason: "" })}
                    >
                      Wrong file? Remove it
                    </button>
                  )
                ) : null}
                {f.replaced ? (
                  <p className="text-xs text-muted-foreground">
                    {f.replaced.reason.startsWith("Removed: ") ? "" : "Replaced "}
                    {when(f.replaced.at)}: {f.replaced.reason}
                  </p>
                ) : (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">How it was read</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {f.notes.map((n, k) => (
                        <li key={k}>{n}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* First rows as read */}
      {d.preview ? (
        <section aria-labelledby="preview" className="flex flex-col gap-2">
          <h3 id="preview" className="text-sm font-semibold">
            First readings of {d.preview.file}, as read
          </h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-surface-muted">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Time
                  </th>
                  {d.preview.columns.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className="px-2 py-1 text-right font-medium whitespace-nowrap"
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.preview.rows.map((r) => (
                  <tr key={r.i} className="border-t border-border">
                    <td className="px-2 py-1 whitespace-nowrap">{when(r.t)}</td>
                    {d.preview!.columns.map((c) => (
                      <td key={c.id} className="px-2 py-1 text-right">
                        {c.values[r.i] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
