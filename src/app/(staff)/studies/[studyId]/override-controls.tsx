"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input, Textarea } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";

import { decideOverrideAction, requestOverrideAction } from "../actions";

export type OverrideView = {
  id: string;
  precalId: string;
  fromResult: string;
  toResult: string;
  reason: string;
  status: "requested" | "approved" | "rejected";
  requestedByUserId: string;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string;
};

const LABEL: Record<string, string> = { pass: "Pass", fail: "Fail" };

/**
 * The result cell of a pre/post-calibration reading, with its override
 * (QA Tech, Nov 2026): ask for one with a reason; a second person approves
 * with their password or rejects with a note. The readings' own result
 * always stays visible.
 */
export function ResultWithOverride({
  studyId,
  precalId,
  result,
  computed,
  overrides,
  me,
  canAsk,
  canDecide,
}: {
  studyId: string;
  precalId: string;
  /** The result in force. */
  result: string;
  /** The readings' own result. */
  computed: string;
  overrides: OverrideView[];
  me: string;
  canAsk: boolean;
  canDecide: boolean;
}) {
  const mine = overrides.filter((o) => o.precalId === precalId);
  const live = mine.find((o) => o.status !== "rejected");
  const rejected = mine.filter((o) => o.status === "rejected").at(-1);
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("font-medium", result === "pass" ? "text-pass" : "text-fail")}>
        {LABEL[result]}
        {live?.status === "approved" ? " *" : ""}
      </span>
      {live?.status === "approved" ? (
        <span className="text-xs text-muted-foreground">
          {LABEL[computed]} by the readings; approved by {live.decidedBy}: {live.reason}
        </span>
      ) : null}
      {live?.status === "requested" ? (
        <span className="text-xs text-attention">
          {live.requestedBy} asks for {LABEL[live.toResult]}: {live.reason}
        </span>
      ) : null}
      {!live && rejected ? (
        <span className="text-xs text-muted-foreground">
          Override rejected by {rejected.decidedBy}: {rejected.decisionNote}
        </span>
      ) : null}
      {live?.status === "requested" && canDecide && live.requestedByUserId !== me ? (
        <DecideButton studyId={studyId} override={live} />
      ) : null}
      {!live && canAsk ? (
        <AskButton studyId={studyId} precalId={precalId} computed={computed} />
      ) : null}
    </div>
  );
}

function AskButton({
  studyId,
  precalId,
  computed,
}: {
  studyId: string;
  precalId: string;
  computed: string;
}) {
  const to = computed === "pass" ? "fail" : "pass";
  return (
    <FormDialog
      trigger={(open) => (
        <button type="button" onClick={open} className="w-fit text-xs text-primary underline">
          Override
        </button>
      )}
    >
      {(close) => <AskForm studyId={studyId} precalId={precalId} to={to} close={close} />}
    </FormDialog>
  );
}

function AskForm({
  studyId,
  precalId,
  to,
  close,
}: {
  studyId: string;
  precalId: string;
  to: string;
  close: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <DialogTitle>Take this reading as {LABEL[to]}</DialogTitle>
      <DialogDescription>
        The reading and its result stay on record. A team leader or manager other than you approves
        the override with their password, and the report shows both.
      </DialogDescription>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Why
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. master re-checked against TL-65: the logger reads within ±0.5 °C"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-fail">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        disabled={busy}
        className="w-fit"
        onClick={() =>
          start(async () => {
            const r = await requestOverrideAction(studyId, { precalId, toResult: to, reason });
            if (r.ok) {
              close();
              router.refresh();
            } else setError(r.error);
          })
        }
      >
        {busy ? "Sending…" : "Ask for approval"}
      </Button>
    </div>
  );
}

function DecideButton({ studyId, override }: { studyId: string; override: OverrideView }) {
  return (
    <FormDialog
      trigger={(open) => (
        <Button type="button" size="sm" variant="secondary" onClick={open} className="w-fit">
          Approve or reject
        </Button>
      )}
    >
      {(close) => <DecideForm studyId={studyId} override={override} close={close} />}
    </FormDialog>
  );
}

function DecideForm({
  studyId,
  override,
  close,
}: {
  studyId: string;
  override: OverrideView;
  close: () => void;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideOverrideAction(studyId, {
        overrideId: override.id,
        approve,
        password,
        note,
      });
      if (r.ok) {
        close();
        router.refresh();
      } else setError(r.error);
    });
  return (
    <div className="flex flex-col gap-3">
      <DialogTitle>
        {LABEL[override.fromResult]} by the readings → {LABEL[override.toResult]}?
      </DialogTitle>
      <DialogDescription>
        {override.requestedBy}: “{override.reason}”. Approving signs it with your password.
      </DialogDescription>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Your password (to approve)
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Note (needed to reject)
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-fail">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" disabled={busy || !password} onClick={() => decide(true)}>
          Approve and sign
        </Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => decide(false)}>
          Reject
        </Button>
      </div>
    </div>
  );
}
