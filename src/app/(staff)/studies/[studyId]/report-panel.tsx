"use client";

import { Download, FileCheck2, FilePlus2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StudyReport } from "@/domain/reports/queries";
import { REPORT_STATUS_LABELS } from "@/domain/reports/types";
import { cn } from "@/lib/utils";

import {
  createReportAction,
  editReportTextAction,
  freezeReportAction,
  newRevisionAction,
} from "../report-actions";

const when = (d: Date | string | null) =>
  d === null
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(d));

type Feedback = { ok: boolean; text: string } | null;
type Result = { ok: true; data?: unknown } | { ok: false; error: string };

function Section({
  title,
  saved,
  template,
  disabled,
  onSave,
}: {
  title: string;
  saved: string | null;
  template: string;
  disabled: boolean;
  onSave: (text: string | null) => void;
}) {
  const current = saved ?? template;
  const [text, setText] = useState(current);
  const changed = text.trim() !== current.trim();
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {saved === null ? "from the template" : "edited"}
        </span>
      </div>
      <Textarea
        aria-label={title}
        value={text}
        rows={7}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!changed} onClick={() => onSave(text)}>
            Save {title.toLowerCase()}
          </Button>
          {saved !== null ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(template);
                onSave(null);
              }}
            >
              Reset to template
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The report of one study: draft it, preview it, edit the wording, freeze, revise. */
export function ReportPanel({ r }: { r: StudyReport }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [revising, setRevising] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const s = r.study;
  const canWork = r.can.prepare && r.open;
  const latest = r.revisions[0] ?? null;
  const shown = r.draft ? r.revisions.find((x) => x.id === r.draft!.id)! : latest;

  const go = (fn: () => Promise<Result>, done: (d: unknown) => string, after?: () => void) =>
    start(async () => {
      setFeedback(null);
      const res = await fn();
      if (res.ok) {
        setFeedback({ ok: true, text: done(res.data) });
        after?.();
        setPreviewKey((k) => k + 1);
        router.refresh();
      } else setFeedback({ ok: false, text: res.error });
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {shown ? (
          <StatusBadge
            tone={
              shown.status === "frozen" ? "pass" : shown.status === "draft" ? "info" : "neutral"
            }
          >
            {shown.label} · {REPORT_STATUS_LABELS[shown.status]}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">No report yet</StatusBadge>
        )}
      </div>
      {r.blocked && shown?.status !== "frozen" ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">{r.blocked}</p>
      ) : null}
      {!r.open && !latest ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          Job {s.jobNumber} isn&apos;t at the report step.
        </p>
      ) : null}

      {!latest && canWork && !r.blocked ? (
        <Button
          size="lg"
          className="w-full sm:w-fit"
          disabled={busy}
          onClick={() =>
            go(
              () => createReportAction(s.id),
              () => "Rev 00 drafted.",
            )
          }
        >
          <FilePlus2 aria-hidden="true" />
          Draft the report
        </Button>
      ) : null}
      <Message f={feedback} />

      {shown ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a
                className="inline-flex items-center gap-1 text-primary underline"
                href={`/studies/${s.id}/report/${shown.id}?download=1`}
              >
                <Download className="size-4" aria-hidden="true" />
                Download {shown.label}
                {shown.status === "draft" ? " (draft)" : ""}
              </a>
              {shown.status === "draft" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
                  onClick={() => setPreviewKey((k) => k + 1)}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Regenerate preview
                </button>
              ) : null}
            </div>
            {/* Phones don't show a PDF inside a page: open it in their viewer instead. */}
            <a
              href={`/studies/${s.id}/report/${shown.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium md:hidden"
            >
              Open {shown.label} to read it
            </a>
            <iframe
              key={`${shown.id}-${previewKey}`}
              title={`Report ${shown.label}`}
              src={`/studies/${s.id}/report/${shown.id}`}
              className="hidden h-[75vh] w-full rounded-lg border border-border bg-surface-muted md:block"
            />
          </div>

          <div className="flex flex-col gap-4">
            {r.draft && r.template ? (
              <>
                <Section
                  key={`o-${r.draft.observation ?? ""}`}
                  title="Observation"
                  saved={r.draft.observation}
                  template={r.template.observation}
                  disabled={!canWork || busy}
                  onSave={(text) =>
                    go(
                      () => editReportTextAction(s.id, r.draft!.id, "observation", text),
                      () =>
                        text === null ? "Observation back to the template." : "Observation saved.",
                    )
                  }
                />
                <Section
                  key={`c-${r.draft.conclusion ?? ""}`}
                  title="Conclusion"
                  saved={r.draft.conclusion}
                  template={r.template.conclusion}
                  disabled={!canWork || busy}
                  onSave={(text) =>
                    go(
                      () => editReportTextAction(s.id, r.draft!.id, "conclusion", text),
                      () =>
                        text === null ? "Conclusion back to the template." : "Conclusion saved.",
                    )
                  }
                />
                {canWork ? (
                  <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
                    <p className="text-sm">
                      Freezing keeps this PDF as {shown.label}: it can&apos;t be changed after, only
                      revised.
                    </p>
                    <Button
                      className="w-full sm:w-fit"
                      disabled={busy}
                      onClick={() =>
                        go(
                          () => freezeReportAction(s.id, r.draft!.id),
                          (d) => {
                            const x = d as { rev: number; pages: number; sha256: string };
                            return `Rev ${String(x.rev).padStart(2, "0")} frozen: ${x.pages} pages, SHA-256 ${x.sha256.slice(0, 12)}…`;
                          },
                        )
                      }
                    >
                      <FileCheck2 aria-hidden="true" />
                      {busy ? "Working…" : `Freeze ${shown.label}`}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {!r.draft && latest && canWork ? (
              revising !== null ? (
                <form
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    go(
                      () => newRevisionAction(s.id, revising),
                      (d) => `Rev ${String((d as { rev: number }).rev).padStart(2, "0")} drafted.`,
                      () => setRevising(null),
                    );
                  }}
                >
                  <Input
                    aria-label="Why is it revised?"
                    placeholder="Why is it revised? e.g. client asked to correct the department"
                    value={revising}
                    onChange={(e) => setRevising(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy}>
                      Start revision
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setRevising(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button variant="secondary" className="w-fit" onClick={() => setRevising("")}>
                  Start a new revision
                </Button>
              )
            ) : null}

            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Revisions</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {r.revisions.map((x) => (
                  <li
                    key={x.id}
                    className={cn(x.status === "superseded" && "text-muted-foreground")}
                  >
                    <a
                      className="text-primary underline"
                      href={`/studies/${s.id}/report/${x.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {x.label}
                    </a>{" "}
                    {REPORT_STATUS_LABELS[x.status]}
                    {x.frozenAt
                      ? ` · ${x.frozenBy}, ${when(x.frozenAt)} · ${x.pages} pages`
                      : ` · ${x.by}, ${when(x.createdAt)}`}
                    {x.reason ? <span className="block text-xs">Why: {x.reason}</span> : null}
                    {x.sha256 ? (
                      <span className="block font-mono text-[10px] break-all text-muted-foreground">
                        SHA-256 {x.sha256}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
