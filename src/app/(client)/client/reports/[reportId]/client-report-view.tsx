"use client";

import { Download, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CommentComposer } from "@/components/reports/comment-composer";
import { SignDialog } from "@/components/reports/sign-dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ClientReport } from "@/domain/reports/client-queries";
import { cn } from "@/lib/utils";

import { clientReturnAction, clientSignAction } from "../../actions";

const when = (d: Date | string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(d));
const dmy = (iso: string) => iso.split("-").reverse().join(".");

const MEANINGS: Record<string, string> = {
  done_by: "Done By",
  checked_by: "Checked By",
  reviewed_by: "Reviewed By",
  approved_by: "Approved By",
};

const STATUS: Record<string, [string, "pass" | "attention" | "info" | "neutral"]> = {
  released: ["To review", "attention"],
  reviewed: ["Reviewed, to approve", "attention"],
  signed: ["Signed", "pass"],
  returned: ["Returned to QA Tech", "info"],
  superseded: ["Superseded by a later revision", "neutral"],
};

export function ClientReportView({ r }: { r: ClientReport }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [returning, setReturning] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [frame, setFrame] = useState(0);
  const [label, tone] = STATUS[r.status] ?? [r.status, "neutral"];
  const pdf = `/client/reports/${r.id}/pdf`;
  const fields = { reportId: r.id };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{label}</StatusBadge>
        {r.reason ? <span className="text-sm">Why revised: {r.reason}</span> : null}
      </div>
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <a
              className="inline-flex items-center gap-1 text-primary underline"
              href={`${pdf}?download=1`}
            >
              <Download className="size-4" aria-hidden="true" />
              Download {r.label}
              {r.status === "signed" ? " (signed)" : ""}
            </a>
            <a className="text-muted-foreground underline" href={`${pdf}?copy=frozen&download=1`}>
              Frozen PDF
            </a>
          </div>
          <a
            href={pdf}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium md:hidden"
          >
            Open {r.label} to read it
          </a>
          <iframe
            key={frame}
            title={`Report ${r.label}`}
            src={pdf}
            className="hidden h-[75vh] w-full rounded-lg border border-border bg-surface-muted md:block"
          />
          <p className="font-mono text-[10px] break-all text-muted-foreground">
            Frozen PDF SHA-256 {r.sha256}
            {r.issuedSha256 ? ` · issued copy SHA-256 ${r.issuedSha256}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {r.can.review || r.can.approve ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-sm">
                {r.can.approve
                  ? "Reviewed by your QA. Approve it to issue the report, or send it back."
                  : "Read the report. Sign Reviewed By when it is right, or send it back with comments."}
              </p>
              <SignDialog
                label={r.can.approve ? "Sign Approved By" : "Sign Reviewed By"}
                title={r.can.approve ? "Sign as Approved By" : "Sign as Reviewed By"}
                body={
                  r.can.approve
                    ? `You approve ${r.reportNumber} ${r.label}. The signed report is issued and can't be changed.`
                    : `You reviewed ${r.reportNumber} ${r.label}. It then goes to your QA head for approval.`
                }
                action={clientSignAction}
                fields={{ ...fields, step: r.can.approve ? "approved_by" : "reviewed_by" }}
                disabled={busy}
                onSigned={(text) => {
                  setFeedback({ ok: true, text });
                  setFrame((f) => f + 1);
                }}
              />
            </div>
          ) : r.status === "reviewed" && r.reviewedByMe ? (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
              You signed Reviewed By. Your QA head signs Approved By.
            </p>
          ) : null}

          {r.can.return ? (
            returning ? (
              <CommentComposer
                sections={r.sections}
                submitLabel="Send back to QA Tech"
                busy={busy}
                onCancel={() => setReturning(false)}
                onSubmit={(comments) =>
                  start(async () => {
                    const res = await clientReturnAction(r.id, comments);
                    if (res.ok) {
                      setReturning(false);
                      setFeedback({
                        ok: true,
                        text: "Sent back. QA Tech will answer your comments in a new revision.",
                      });
                      router.refresh();
                    } else setFeedback({ ok: false, text: res.error });
                  })
                }
              />
            ) : (
              <Button
                variant="secondary"
                className="w-full sm:w-fit"
                onClick={() => setReturning(true)}
              >
                <Undo2 aria-hidden="true" />
                Send back with comments
              </Button>
            )
          ) : null}

          {r.paper ? (
            <p className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
              Signed on paper: reviewed by {r.paper.reviewedBy} ({dmy(r.paper.reviewedOn)}),
              approved by {r.paper.approvedBy} ({dmy(r.paper.approvedOn)}).
            </p>
          ) : null}

          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Signatures</h2>
            <ul className="flex flex-col gap-0.5 text-sm">
              {r.signatures.map((g) => (
                <li key={g.id}>
                  <strong>{MEANINGS[g.meaning] ?? g.meaning}</strong>: {g.name} ({g.role}),{" "}
                  {when(g.at)}
                </li>
              ))}
            </ul>
          </section>

          {r.comments.length ? (
            <section className="flex flex-col gap-1.5">
              <h2 className="text-sm font-semibold">Your comments</h2>
              <ul className="flex flex-col gap-1.5">
                {r.comments.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-sm"
                  >
                    <span className="text-xs text-muted-foreground">
                      {c.rev} · {c.sectionLabel}
                      {c.page ? `, page ${c.page}` : ""} · {c.by}, {when(c.at)}
                    </span>
                    <span>{c.body}</span>
                    {c.answer ? (
                      <span className="text-xs text-pass">QA Tech: {c.answer}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
