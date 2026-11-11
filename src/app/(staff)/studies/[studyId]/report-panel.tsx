"use client";

import { Download, FilePlus2, MessageSquare, RefreshCw, Send, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-controls";
import { CommentComposer } from "@/components/reports/comment-composer";
import { SignDialog } from "@/components/reports/sign-dialog";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { StudyReport } from "@/domain/reports/queries";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/domain/reports/types";
import { cn } from "@/lib/utils";

import {
  answerCommentAction,
  createReportAction,
  editReportTextAction,
  newRevisionAction,
  returnForReworkAction,
  freezeReportAction,
  signReportAction,
} from "../report-actions";
import { MailBox, PaperSignoffForm, ReleaseForm, type Mail } from "./release-panel";

const TONES: Record<ReportStatus, StatusTone> = {
  draft: "info",
  checking: "attention",
  checked: "attention",
  released: "info",
  reviewed: "info",
  signed: "pass",
  returned: "fail",
  superseded: "neutral",
};

const MEANINGS: Record<string, string> = {
  done_by: "Done By",
  checked_by: "For QA Tech",
  reviewed_by: "Reviewed By",
  approved_by: "For the client",
};

/** Revisions a new one can follow. */
const REVISABLE: ReportStatus[] = ["checked", "released", "reviewed", "returned", "signed"];

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

const dmy = (iso: string) => iso.split("-").reverse().join(".");

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

/** One review comment, with the preparer's answer (or the box to write it). */
function CommentItem({
  c,
  canAnswer,
  busy,
  onAnswer,
}: {
  c: StudyReport["comments"][number];
  canAnswer: boolean;
  busy: boolean;
  onAnswer: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-md border p-2 text-sm",
        c.answer ? "border-border" : "border-attention bg-attention-soft/40",
      )}
    >
      <span className="text-xs text-muted-foreground">
        {c.rev} · {c.sectionLabel}
        {c.page ? `, page ${c.page}` : ""} · {c.side === "client" ? "client" : "checker"} {c.by},{" "}
        {when(c.at)}
      </span>
      <span>{c.body}</span>
      {c.answer ? (
        <span className="text-xs text-pass">
          {c.answeredBy}: {c.answer}
        </span>
      ) : canAnswer ? (
        <form
          className="flex flex-col gap-1.5 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            onAnswer(text);
          }}
        >
          <Input
            aria-label={`What was done about: ${c.body}`}
            placeholder="Fixed: what you changed"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>
            Answer
          </Button>
        </form>
      ) : (
        <span className="text-xs text-attention">Not answered yet</span>
      )}
    </li>
  );
}

/**
 * The report of one study, from draft to the client's signature: wording,
 * preview, Done By, the checker's Checked By or return, release, the paper
 * route, and new revisions.
 */
export function ReportPanel({ r }: { r: StudyReport }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [revising, setRevising] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [mail, setMail] = useState<Mail | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const s = r.study;
  const canWork = r.can.prepare && r.open;
  const latest = r.revisions[0] ?? null;
  const shown = r.draft ? r.revisions.find((x) => x.id === r.draft!.id)! : latest;
  const open = r.comments.filter((c) => !c.answer);
  // Who froze a revision can't sign it for QA Tech (older revisions: who signed Done By).
  const preparedByMe =
    shown?.frozenByUserId === r.me ||
    shown?.signatures.some((g) => g.meaning === "done_by" && g.userId === r.me);

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
  const signed = (text: string) => {
    setFeedback({ ok: true, text });
    setPreviewKey((k) => k + 1);
  };
  const fields: Record<string, string> = shown ? { studyId: s.id, reportId: shown.id } : {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {shown ? (
          <StatusBadge tone={TONES[shown.status]}>
            {shown.label} · {REPORT_STATUS_LABELS[shown.status]}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">No report yet</StatusBadge>
        )}
        {shown?.signedVia === "paper" ? (
          <span className="text-xs text-muted-foreground">signed on paper</span>
        ) : null}
      </div>
      {r.blocked && shown?.status === "draft" ? (
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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <a
                className="inline-flex items-center gap-1 text-primary underline"
                href={`/studies/${s.id}/report/${shown.id}?download=1`}
              >
                <Download className="size-4" aria-hidden="true" />
                Download {shown.label}
                {shown.status === "draft"
                  ? " (draft)"
                  : shown.status === "signed" && shown.signedVia === "app"
                    ? " (issued, signed)"
                    : ""}
              </a>
              {shown.sha256 ? (
                <a
                  className="text-muted-foreground underline"
                  href={`/studies/${s.id}/report/${shown.id}?copy=frozen&download=1`}
                >
                  Frozen PDF
                </a>
              ) : null}
              {shown.paper ? (
                <a
                  className="text-primary underline"
                  href={`/studies/${s.id}/report/${shown.id}?copy=scan`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Signed scan
                </a>
              ) : null}
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
            {r.comments.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <MessageSquare className="size-4" aria-hidden="true" />
                  Review comments
                  {open.length ? (
                    <span className="text-attention">({open.length} to answer)</span>
                  ) : null}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {r.comments.map((c) => (
                    <CommentItem
                      key={c.id}
                      c={c}
                      busy={busy}
                      canAnswer={r.can.prepare && shown.status === "draft"}
                      onAnswer={(text) =>
                        go(
                          () => answerCommentAction(s.id, c.id, text),
                          () => "Answer saved.",
                        )
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null}

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
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                    <p className="text-sm">
                      This freezes the PDF as {shown.label} and sends it to a team leader or
                      manager, who signs it for QA Tech. It can&apos;t be changed after, only
                      returned or revised.
                    </p>
                    {open.length ? (
                      <p className="text-sm text-attention">
                        Answer the review comments first: say what was fixed.
                      </p>
                    ) : null}
                    <Button
                      className="w-full sm:w-fit"
                      disabled={busy || open.length > 0 || Boolean(r.blocked)}
                      onClick={() =>
                        go(
                          () => freezeReportAction(s.id, r.draft!.id),
                          (d) => {
                            const f = d as { rev: number; pages: number; sha256: string };
                            return `Rev ${String(f.rev).padStart(2, "0")} frozen: ${f.pages} pages, SHA-256 ${f.sha256.slice(0, 12)}…. It's with the checker now.`;
                          },
                        )
                      }
                    >
                      <Send aria-hidden="true" />
                      Send {shown.label} for checking
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {shown.status === "checking" ? (
              r.can.check ? (
                preparedByMe ? (
                  <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
                    You prepared {shown.label}. Another team leader or manager signs it for QA Tech
                    or returns it.
                  </p>
                ) : returning ? (
                  <CommentComposer
                    sections={shown.sections}
                    submitLabel="Return to the preparer"
                    busy={busy}
                    onCancel={() => setReturning(false)}
                    onSubmit={(comments) =>
                      go(
                        () => returnForReworkAction(s.id, shown.id, comments),
                        () => `${shown.label} returned to the preparer.`,
                        () => setReturning(false),
                      )
                    }
                  />
                ) : (
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                    <p className="text-sm">
                      Check the PDF against the data. Sign it for QA Tech, or send it back with
                      comments pinned to the sections that need changing.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <SignDialog
                        label="Sign for QA Tech"
                        title="Sign for QA Tech"
                        body={`You checked ${s.reportNumber} ${shown.label} (the numbers, the wording and the annexures) and sign it for QA Tech. Your name goes in the QA Tech column of the signature block.`}
                        action={signReportAction}
                        fields={{ ...fields, step: "checked_by" }}
                        disabled={busy}
                        onSigned={signed}
                      />
                      <Button
                        variant="secondary"
                        className="w-full sm:w-fit"
                        onClick={() => setReturning(true)}
                      >
                        <Undo2 aria-hidden="true" />
                        Return with comments
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
                  With the checker: a team leader or manager signs it for QA Tech.
                </p>
              )
            ) : null}

            {mail ? <MailBox mail={mail} /> : null}
            {shown.status === "checked" && r.can.release && !mail ? (
              <ReleaseForm
                studyId={s.id}
                reportId={shown.id}
                label={shown.label}
                people={r.recipients}
                onReleased={(m) => {
                  setMail(m);
                  setFeedback({ ok: true, text: `${shown.label} released to the client.` });
                }}
              />
            ) : null}
            {(shown.status === "released" || shown.status === "reviewed") && !mail ? (
              <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
                With the client since {when(shown.releasedAt)} ({shown.releasedTo.join(", ")}).{" "}
                Their authorised signatory signs it, or they send it back.
              </p>
            ) : null}
            {["checked", "released", "reviewed"].includes(shown.status) && r.can.release ? (
              <details className="rounded-lg border border-border bg-surface p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Signed on paper instead?
                </summary>
                <div className="mt-3">
                  <PaperSignoffForm studyId={s.id} reportId={shown.id} label={shown.label} />
                </div>
              </details>
            ) : null}
            {shown.status === "returned" ? (
              <p className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
                The client returned {shown.label} on {when(shown.returnedAt)}. Start a new revision
                that answers their comments.
              </p>
            ) : null}
            {shown.status === "signed" && shown.paper ? (
              <p className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
                Signed on paper by {shown.paper.approvedBy}
                {shown.paper.approvedByTitle ? `, ${shown.paper.approvedByTitle}` : ""} (
                {dmy(shown.paper.approvedOn)}).
              </p>
            ) : null}

            {!r.draft && latest && r.can.prepare && REVISABLE.includes(latest.status) ? (
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

            {shown.signatures.length ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Signatures on {shown.label}</h3>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {shown.signatures.map((g) => (
                    <li key={g.id}>
                      <strong>{MEANINGS[g.meaning] ?? g.meaning}</strong>: {g.name} ({g.role}),{" "}
                      {when(g.at)}
                    </li>
                  ))}
                </ul>
              </section>
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
