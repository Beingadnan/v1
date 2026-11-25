"use client";

import { Calculator, FileWarning, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CycleResult, Stats } from "@/domain/analysis/engine";
import type { StudyAnalysis } from "@/domain/analysis/queries";
import {
  DEVIATION_DECISION_LABELS,
  DEVIATION_DECISIONS,
  DEVIATION_SOURCE_LABELS,
} from "@/domain/analysis/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  approveAnalysisAction,
  assessDeviationAction,
  decideDeviationAction,
  openDeviationAction,
  recalculateImpactAction,
  reviewExcursionAction,
  runAnalysisAction,
  withdrawApprovalAction,
  withdrawExcursionAction,
} from "../analysis-actions";
import { postFile } from "@/lib/upload-client";

const when = (d: Date | number | string | null) =>
  d === null
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(d));
/** One decimal, with a real minus sign, as on QA Tech's reports. */
const f1 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace("-", "−");
const f2 = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v.toFixed(2).replace("-", "−");

type Feedback = { ok: boolean; text: string } | null;
type Result = { ok: true; data?: unknown } | { ok: false; error: string };

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

function Verdict({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="text-muted-foreground">—</span>;
  return pass ? (
    <span className="font-medium text-pass">Pass</span>
  ) : (
    <span className="font-medium text-fail">Fail</span>
  );
}

function StatCells({ s }: { s: Stats | null }) {
  return (
    <>
      <td className="text-right tabular-nums">{f1(s?.min)}</td>
      <td className="text-right tabular-nums">{f1(s?.max)}</td>
      <td className="text-right tabular-nums">{f1(s?.avg)}</td>
    </>
  );
}

/** One cycle's summary, laid out like page 5 of QA Tech's report. */
function CycleSummary({ c, limits }: { c: CycleResult; limits: StudyAnalysis["study"]["limits"] }) {
  const hasRh = c.positions.some((p) => p.rh);
  const limitText =
    limits.tempMin || limits.tempMax
      ? `${limits.tempMin ? f1(Number(limits.tempMin)) : "…"} to ${limits.tempMax ? f1(Number(limits.tempMax)) : "…"} °C`
      : "no limits set";
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{c.label}</h3>
        <span className="text-xs text-muted-foreground">
          {when(c.start)} – {when(c.end)} · limits {limitText}
        </span>
        <StatusBadge tone={c.pass === null ? "neutral" : c.pass ? "pass" : "fail"}>
          {c.pass === null ? "Not judged" : c.pass ? "Within limits" : "Outside limits"}
        </StatusBadge>
      </div>
      <ul className="text-sm">
        {c.hot ? (
          <li>
            Average maximum temperature at <b>{c.hot.label}</b>: {f1(c.hot.avg)} °C{" "}
            <span className="text-xs text-fail">hot spot</span>
          </li>
        ) : null}
        {c.cold ? (
          <li>
            Average minimum temperature at <b>{c.cold.label}</b>: {f1(c.cold.avg)} °C{" "}
            <span className="text-xs text-info">cold spot</span>
          </li>
        ) : null}
        {c.highest ? (
          <li className="text-muted-foreground">
            Highest reading {f1(c.highest.value)} °C at {c.highest.label}, {when(c.highest.at)}
          </li>
        ) : null}
        {c.lowest ? (
          <li className="text-muted-foreground">
            Lowest reading {f1(c.lowest.value)} °C at {c.lowest.label}, {when(c.lowest.at)}
          </li>
        ) : null}
      </ul>
      <div className="-mx-3 overflow-x-auto px-3">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 text-left">Position</th>
              <th className="text-left">Logger</th>
              <th className="text-right">Min</th>
              <th className="text-right">Max</th>
              <th className="text-right">Avg</th>
              <th className="text-right" title="Mean kinetic temperature from every reading">
                MKT
              </th>
              {hasRh ? (
                <>
                  <th className="text-right">%RH min</th>
                  <th className="text-right">max</th>
                  <th className="text-right">avg</th>
                </>
              ) : null}
              <th className="pl-2 text-left">Result</th>
            </tr>
          </thead>
          <tbody>
            {c.positions.map((p) => (
              <tr
                key={p.positionId}
                className={cn("border-t border-border", p.excluded && "text-muted-foreground")}
              >
                <td className="py-1.5">
                  <span className={cn(p.excluded && "line-through")}>{p.label}</span>
                  {c.hot?.positionId === p.positionId ? (
                    <span className="ml-1 text-xs text-fail">hot</span>
                  ) : null}
                  {c.cold?.positionId === p.positionId ? (
                    <span className="ml-1 text-xs text-info">cold</span>
                  ) : null}
                </td>
                <td className="font-mono text-xs">{p.logger?.serialNo || p.logger?.code || "—"}</td>
                <StatCells s={p.temp} />
                <td className="text-right tabular-nums">{f2(p.temp?.mkt)}</td>
                {hasRh ? <StatCells s={p.rh} /> : null}
                <td className="pl-2">
                  {p.excluded ? (
                    <span className="text-xs">Left out</span>
                  ) : p.ambient ? (
                    <span className="text-xs text-muted-foreground">Ambient</span>
                  ) : (
                    <Verdict pass={p.pass} />
                  )}
                  {p.f0 !== null ? (
                    <span className="ml-1 text-xs text-muted-foreground">F0 {f1(p.f0)}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        MKT is worked out from every reading (USP 〈1079.2〉, ΔH/R 10 000 K). QA Tech&apos;s current
        sheet works it out from the average, which always gives the average itself (Avg column).
        Ambient positions are shown but not judged.
      </p>
      {c.door.map((d) => (
        <p key={d.openedAt} className="text-sm">
          Door open {when(d.openedAt)} – {when(d.closedAt)}: peak {f1(d.peak)} °C;{" "}
          {d.recoveryMinutes === null
            ? "not back within limits before the end"
            : `back within limits ${d.recoveryMinutes} min after closing`}
          .
        </p>
      ))}
      {c.power.map((p) => (
        <p key={p.offAt} className="text-sm">
          Power off {when(p.offAt)}
          {p.onAt ? ` – restored ${when(p.onAt)}` : " (no restore recorded)"}:{" "}
          {p.heldThroughout
            ? "stayed within limits throughout"
            : `held ${p.holdoverMinutes} min before leaving the limits`}
          {p.onAt
            ? p.recoveryMinutes === null
              ? "; not back within limits before the end"
              : `; back within limits ${p.recoveryMinutes} min after power returned`
            : ""}
          .
        </p>
      ))}
      {c.hold ? (
        <p className="text-sm">
          Hold {when(c.hold.start)} – {when(c.hold.end)}: {f1(c.hold.tempRange?.min)} to{" "}
          {f1(c.hold.tempRange?.max)} °C; lowest F0 {f1(c.hold.minF0?.value)} min at{" "}
          {c.hold.minF0?.label ?? "—"} (Tref 121.1 °C, z 10 °C).
        </p>
      ) : null}
    </section>
  );
}

/** Analysis of one study: run, review excursions, work deviations, approve. */
export function AnalysisPanel({ a }: { a: StudyAnalysis }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reviewing, setReviewing] = useState<{
    fingerprint: string;
    decision: "accepted" | "deviation";
    reason: string;
  } | null>(null);
  const [assessing, setAssessing] = useState<{ id: string; text: string } | null>(null);
  const [deciding, setDeciding] = useState<{
    id: string;
    decision: string;
    decidedByName: string;
    decidedByTitle: string;
    decidedOn: string;
    note: string;
    fileId: string;
    fileName: string;
  } | null>(null);
  const [opening, setOpening] = useState<{
    title: string;
    description: string;
    positionId: string;
  } | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const s = a.study;
  const runnable = ["data_received", "analysis"].includes(s.jobStatus);
  const canRun = a.can.run && runnable && s.dataStatus === "received";
  const devOpen = [
    "field_work",
    "data_issue",
    "data_received",
    "analysis",
    "report_draft",
    "rework",
  ].includes(s.jobStatus);
  const today = new Date().toISOString().slice(0, 10);

  const go = (fn: () => Promise<Result>, done: (data: unknown) => string, after?: () => void) =>
    start(async () => {
      setFeedback(null);
      const r = await fn();
      if (r.ok) {
        setFeedback({ ok: true, text: done(r.data) });
        after?.();
        router.refresh();
      } else setFeedback({ ok: false, text: r.error });
    });

  async function uploadScan(file: File) {
    if (!deciding) return;
    const body = new FormData();
    body.append("file", file, file.name);
    let res: Response;
    try {
      res = await postFile(body);
    } catch {
      setFeedback({ ok: false, text: "No connection. Try again when you're online." });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (res.status === 401) {
      setFeedback({
        ok: false,
        text: "You were signed out, so the scan wasn't uploaded. Sign in again (in a new tab), then choose it again.",
      });
      return;
    }
    if (!res.ok || !json.id) {
      setFeedback({ ok: false, text: json.error ?? "The scan couldn't be uploaded." });
      return;
    }
    setDeciding({ ...deciding, fileId: json.id, fileName: file.name });
  }

  const status = !a.run
    ? { tone: "neutral" as const, text: "Not analysed yet" }
    : a.approval && !a.stale
      ? { tone: "pass" as const, text: `Run ${a.run.runNo} approved` }
      : a.stale
        ? { tone: "attention" as const, text: `Run ${a.run.runNo} out of date` }
        : { tone: "info" as const, text: `Run ${a.run.runNo}: waiting for approval` };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
        {a.run ? (
          <span className="text-xs text-muted-foreground">
            by {a.run.by}, {when(a.run.createdAt)} · engine {a.run.engineVersion}
          </span>
        ) : null}
      </div>
      {s.dataStatus !== "received" ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          Confirm the data on the Data tab before analysing it.
        </p>
      ) : !runnable && !a.run ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          Job {s.jobNumber} isn&apos;t at the analysis step.
        </p>
      ) : null}
      {a.stale ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          The data or a decision changed after run {a.run?.runNo}. Run the analysis again; the old
          run is kept.
        </p>
      ) : null}
      {canRun && !(a.approval && !a.stale) ? (
        <Button
          size="lg"
          className="w-full sm:w-fit"
          disabled={busy}
          onClick={() =>
            go(
              () => runAnalysisAction(s.id),
              (d) => {
                const r = d as { runNo: number; fresh: boolean };
                return r.fresh ? `Run ${r.runNo} done.` : `Nothing changed: run ${r.runNo} stands.`;
              },
            )
          }
        >
          <Calculator aria-hidden="true" />
          {a.run ? "Run the analysis again" : "Run the analysis"}
        </Button>
      ) : null}
      <Message f={feedback} />

      {a.run?.result.notes.length ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {a.run.result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {a.run?.result.cycles.map((c) => (
        <CycleSummary key={c.cycle} c={c} limits={s.limits} />
      ))}

      {a.run ? (
        <section aria-labelledby="excursions" className="flex flex-col gap-2">
          <h3 id="excursions" className="text-sm font-semibold">
            Excursions{" "}
            <span className="font-normal text-muted-foreground">({a.excursions.length})</span>
          </h3>
          {a.excursions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reading went outside the limits (ambient positions aren&apos;t judged).
            </p>
          ) : null}
          {a.excursions.map((e) => (
            <div
              key={e.fingerprint}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
            >
              <p>
                <b>{e.label}</b> {e.side === "high" ? "above" : "below"} {f1(e.limit)}{" "}
                {e.quantity === "rh" ? "%RH" : "°C"} for {e.minutes} min ({e.readings} reading
                {e.readings === 1 ? "" : "s"}) from {when(e.start)}, peak {f1(e.peak)} ·{" "}
                <span className="text-muted-foreground">{e.cycle}</span>
              </p>
              {e.review ? (
                <p className="text-muted-foreground">
                  {e.review.decision === "accepted"
                    ? `Accepted by ${e.review.by}: ${e.review.reason}`
                    : `Raised as ${e.review.deviation} by ${e.review.by}.`}{" "}
                  {e.review.decision === "accepted" && a.can.run && !a.approval ? (
                    <button
                      type="button"
                      className="text-primary underline"
                      disabled={busy}
                      onClick={() =>
                        go(
                          () => withdrawExcursionAction(s.id, e.fingerprint),
                          () => "Acceptance withdrawn.",
                        )
                      }
                    >
                      Withdraw
                    </button>
                  ) : null}
                </p>
              ) : a.can.run ? (
                reviewing?.fingerprint === e.fingerprint ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      go(
                        () => reviewExcursionAction(s.id, reviewing),
                        (d) => {
                          const n = (d as { deviationNumber: string | null }).deviationNumber;
                          return n ? `Deviation ${n} opened.` : "Excursion accepted.";
                        },
                        () => setReviewing(null),
                      );
                    }}
                  >
                    <Textarea
                      aria-label={
                        reviewing.decision === "accepted"
                          ? "Why it is acceptable"
                          : "What happened (for the deviation)"
                      }
                      placeholder={
                        reviewing.decision === "accepted"
                          ? "Why it is acceptable, e.g. loading of 40 cartons, door log 11:40"
                          : "What happened, for the deviation"
                      }
                      value={reviewing.reason}
                      onChange={(ev) => setReviewing({ ...reviewing, reason: ev.target.value })}
                      required
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={busy}>
                        {reviewing.decision === "accepted" ? "Accept" : "Open deviation"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setReviewing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setReviewing({
                          fingerprint: e.fingerprint,
                          decision: "accepted",
                          reason: "",
                        })
                      }
                    >
                      Accept with a reason
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setReviewing({
                          fingerprint: e.fingerprint,
                          decision: "deviation",
                          reason: "",
                        })
                      }
                    >
                      Raise a deviation
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-attention">Not reviewed yet.</p>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="deviations" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="deviations" className="text-sm font-semibold">
            Deviations{" "}
            <span className="font-normal text-muted-foreground">({a.deviations.length})</span>
          </h3>
          {a.can.deviations && devOpen && !opening ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpening({ title: "", description: "", positionId: "" })}
            >
              <FileWarning aria-hidden="true" />
              Open a deviation
            </Button>
          ) : null}
        </div>
        {opening ? (
          <form
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              go(
                () => openDeviationAction(s.id, opening),
                (d) => `Deviation ${(d as { number: string }).number} opened.`,
                () => setOpening(null),
              );
            }}
          >
            <Input
              aria-label="Title"
              placeholder="Title, e.g. Logger L-07 found on the floor at removal"
              value={opening.title}
              onChange={(e) => setOpening({ ...opening, title: e.target.value })}
              required
            />
            <Textarea
              aria-label="Description"
              placeholder="What happened"
              value={opening.description}
              onChange={(e) => setOpening({ ...opening, description: e.target.value })}
            />
            <select
              aria-label="Position"
              value={opening.positionId}
              onChange={(e) => setOpening({ ...opening, positionId: e.target.value })}
              className="h-11 rounded-md border border-input bg-surface px-3"
            >
              <option value="">Not about one position</option>
              {a.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Open
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpening(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        {a.deviations.length === 0 && !opening ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : null}
        {a.deviations.map((d) => (
          <article
            key={d.id}
            aria-label={d.number}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{d.number}</span>
              <StatusBadge tone={d.closedAt ? "neutral" : "fail"}>
                {d.decision ? DEVIATION_DECISION_LABELS[d.decision] : "Open"}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                {DEVIATION_SOURCE_LABELS[d.source]} · {d.openedBy ?? "—"}, {when(d.openedAt)}
              </span>
            </div>
            <p className="font-medium">{d.title}</p>
            {d.description ? <p className="text-muted-foreground">{d.description}</p> : null}
            {d.source === "post_cal" ? (
              d.impact ? (
                <div className="rounded-md bg-surface-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    Impact (run {d.impact.runNo}): {d.impact.note}
                  </p>
                  {d.impact.cycles.map((c) => {
                    const now = a.run?.result.cycles.find((x) => x.label === c.label)?.pass;
                    return (
                      <p key={c.label}>
                        {c.label}: with the error applied, {d.position} reads{" "}
                        {f1(c.position?.temp?.min)} to {f1(c.position?.temp?.max)} °C (avg{" "}
                        {f1(c.position?.temp?.avg)}) — <Verdict pass={c.position?.pass ?? null} />.
                        The study&apos;s verdict would be <Verdict pass={c.pass} />
                        {now === undefined || now === c.pass
                          ? " (the same as without the correction)."
                          : " (it changes with the correction)."}
                      </p>
                    );
                  })}
                </div>
              ) : a.can.run && s.dataStatus === "received" && !d.closedAt ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-fit"
                  disabled={busy}
                  onClick={() =>
                    go(
                      () => recalculateImpactAction(s.id, d.id),
                      () => "Impact recalculated.",
                    )
                  }
                >
                  Work out the impact
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The impact is worked out once the data is confirmed.
                </p>
              )
            ) : null}
            {d.assessment ? (
              <p>
                <span className="text-xs text-muted-foreground">
                  QA Tech assessment ({d.assessedBy}, {when(d.assessedAt)}):
                </span>{" "}
                {d.assessment}
              </p>
            ) : null}
            {d.decision ? (
              <p>
                <span className="text-xs text-muted-foreground">Client decision:</span>{" "}
                <b>{DEVIATION_DECISION_LABELS[d.decision]}</b>, {d.decidedByName}
                {d.decidedByTitle ? ` (${d.decidedByTitle})` : ""} on{" "}
                {d.decidedOn ? formatDate(d.decidedOn) : "—"}
                {d.decisionNote ? ` — ${d.decisionNote}` : ""}. Recorded by {d.recordedBy}.{" "}
                {d.decisionFile ? (
                  <a
                    className="text-primary underline"
                    href={`/studies/${s.id}/deviations/${d.id}/scan`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Signed decision
                  </a>
                ) : null}
              </p>
            ) : null}
            {!d.closedAt && a.can.deviations && devOpen ? (
              assessing?.id === d.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    go(
                      () => assessDeviationAction(s.id, d.id, assessing.text),
                      () => "Assessment saved.",
                      () => setAssessing(null),
                    );
                  }}
                >
                  <Textarea
                    aria-label="QA Tech's assessment"
                    value={assessing.text}
                    onChange={(e) => setAssessing({ ...assessing, text: e.target.value })}
                    placeholder="What happened, and whether it affects the result (see the impact above)"
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy}>
                      Save assessment
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setAssessing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : deciding?.id === d.id ? (
                <form
                  className="grid gap-2 sm:grid-cols-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const { id, fileName, ...input } = deciding;
                    void fileName;
                    go(
                      () => decideDeviationAction(s.id, id, input),
                      () => `${d.number} closed.`,
                      () => setDeciding(null),
                    );
                  }}
                >
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="font-medium">Decision of the client&apos;s QA head</span>
                    <select
                      value={deciding.decision}
                      onChange={(e) => setDeciding({ ...deciding, decision: e.target.value })}
                      className="h-11 rounded-md border border-input bg-surface px-3"
                    >
                      {DEVIATION_DECISIONS.filter((x) => x !== "exclude_probe" || d.position).map(
                        (x) => (
                          <option key={x} value={x}>
                            {DEVIATION_DECISION_LABELS[x]}
                            {x === "exclude_probe" ? ` (leave ${d.position} out)` : ""}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">Decided by</span>
                    <Input
                      value={deciding.decidedByName}
                      onChange={(e) => setDeciding({ ...deciding, decidedByName: e.target.value })}
                      placeholder="Name"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">Title</span>
                    <Input
                      value={deciding.decidedByTitle}
                      onChange={(e) => setDeciding({ ...deciding, decidedByTitle: e.target.value })}
                      placeholder="Head QA"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">On</span>
                    <Input
                      type="date"
                      max={today}
                      value={deciding.decidedOn}
                      onChange={(e) => setDeciding({ ...deciding, decidedOn: e.target.value })}
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium">Signed paper (optional)</span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadScan(f);
                      }}
                      className="text-sm"
                    />
                    {deciding.fileName ? (
                      <span className="text-xs text-pass">{deciding.fileName} attached</span>
                    ) : null}
                  </label>
                  <Textarea
                    aria-label="Note"
                    className="sm:col-span-2"
                    value={deciding.note}
                    onChange={(e) => setDeciding({ ...deciding, note: e.target.value })}
                    placeholder="Note (optional), e.g. agreed by email of 30 Oct"
                  />
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="submit" disabled={busy}>
                      Record and close
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setDeciding(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAssessing({ id: d.id, text: d.assessment })}
                  >
                    {d.assessment ? "Edit assessment" : "Write assessment"}
                  </Button>
                  {d.assessment ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setDeciding({
                          id: d.id,
                          decision: "no_impact",
                          decidedByName: "",
                          decidedByTitle: "",
                          decidedOn: today,
                          note: "",
                          fileId: "",
                          fileName: "",
                        })
                      }
                    >
                      Record client decision
                    </Button>
                  ) : null}
                </div>
              )
            ) : null}
          </article>
        ))}
      </section>

      {a.run ? (
        <section
          aria-labelledby="approval"
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
        >
          <h3 id="approval" className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Approval
          </h3>
          {a.approval ? (
            <>
              <p className="text-sm">
                Run {a.runs.find((r) => r.id === a.approval?.runId)?.runNo} approved by{" "}
                {a.approval.by}, {when(a.approval.at)}. The report will be built from it.
              </p>
              {a.can.approve && runnable ? (
                withdrawing !== null ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      go(
                        () => withdrawApprovalAction(s.id, withdrawing),
                        () => "Approval withdrawn.",
                        () => setWithdrawing(null),
                      );
                    }}
                  >
                    <Input
                      aria-label="Why"
                      placeholder="Why the approval is withdrawn"
                      value={withdrawing}
                      onChange={(e) => setWithdrawing(e.target.value)}
                      required
                    />
                    <div className="flex gap-2">
                      <Button type="submit" variant="danger" disabled={busy}>
                        Withdraw approval
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setWithdrawing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    onClick={() => setWithdrawing("")}
                  >
                    Withdraw approval
                  </Button>
                )
              ) : null}
            </>
          ) : a.blockers.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-attention">
              {a.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pass">Everything is reviewed: ready to approve.</p>
          )}
          {!a.approval && a.can.approve && a.blockers.length === 0 && s.jobStatus === "analysis" ? (
            <Button
              size="lg"
              className="w-full sm:w-fit"
              disabled={busy}
              onClick={() =>
                go(
                  () => approveAnalysisAction(s.id, a.run!.id),
                  () => `Run ${a.run!.runNo} approved.`,
                )
              }
            >
              Approve run {a.run.runNo}
            </Button>
          ) : null}
          {!a.approval && !a.can.approve && a.blockers.length === 0 ? (
            <p className="text-xs text-muted-foreground">A team leader or manager approves.</p>
          ) : null}
        </section>
      ) : null}

      {a.runs.length > 1 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Earlier runs ({a.runs.length - 1})
          </summary>
          <ul className="mt-1 pl-4 text-muted-foreground">
            {a.runs.slice(1).map((r) => (
              <li key={r.id}>
                Run {r.runNo}: {r.by}, {when(r.createdAt)} · engine {r.engineVersion}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
