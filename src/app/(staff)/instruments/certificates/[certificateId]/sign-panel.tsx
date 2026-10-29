"use client";

import { Ban, PenLine, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";

import { cancelCertificateAction, returnCalibrationAction, signStepAction } from "../../actions";

const STEP_TEXT = {
  submit: {
    button: "Sign: calibration done by",
    title: "Sign as “Calibration done by”",
    body: "You confirm the readings are what you measured. The certificate then goes to a checker; it can't be changed unless it is returned.",
  },
  check: {
    button: "Sign: certificate checked by",
    title: "Sign as “Certificate checked by”",
    body: "You confirm you checked the readings, masters and details. It then goes for approval.",
  },
  approve: {
    button: "Approve and issue",
    title: "Approve and issue",
    body: "The certificate is issued with today's date and its PDF is fixed. It can only be cancelled afterwards, never edited.",
  },
} as const;

function SignForm({
  certificateId,
  number,
  step,
  close,
}: {
  certificateId: string;
  number: string;
  step: keyof typeof STEP_TEXT;
  close: () => void;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(signStepAction);
  useCloseOnSuccess(result?.ok, close);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  const text = STEP_TEXT[step];
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>
          {number}. {text.body}
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="certificateId" value={certificateId} />
      <input type="hidden" name="step" value={step} />
      <TextField
        name="password"
        label="Your password"
        type="password"
        autoComplete="current-password"
        required
        result={result}
        hint="Re-entering it is your electronic signature."
      />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Signing…" : "Sign"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReasonForm({
  certificateId,
  kind,
  close,
}: {
  certificateId: string;
  kind: "return" | "cancel";
  close: () => void;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(
    kind === "return" ? returnCalibrationAction : cancelCertificateAction,
  );
  useCloseOnSuccess(result?.ok, close);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {kind === "return" ? "Return for correction" : "Cancel this certificate"}
        </DialogTitle>
        <DialogDescription>
          {kind === "return"
            ? "It goes back to draft. Whoever calibrated corrects it and signs again."
            : "The certificate stays on record, marked cancelled. Its number is not reused."}
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="certificateId" value={certificateId} />
      <TextField
        name="reason"
        label={kind === "return" ? "What needs fixing" : "Reason"}
        multiline
        required
        result={result}
      />
      <FormMessage result={result} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={close}>
          Back
        </Button>
        <Button type="submit" variant={kind === "cancel" ? "danger" : "primary"} disabled={pending}>
          {pending ? "Saving…" : kind === "return" ? "Return" : "Cancel certificate"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SignPanel({
  certificateId,
  number,
  step,
  canReturn,
  canCancel,
  blockedReason,
}: {
  certificateId: string;
  number: string;
  step: keyof typeof STEP_TEXT | null;
  canReturn: boolean;
  canCancel: boolean;
  /** Why the person can't sign this step (e.g. they did the calibration). */
  blockedReason?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step ? (
        blockedReason ? (
          <p className="text-sm text-muted-foreground">{blockedReason}</p>
        ) : (
          <FormDialog
            trigger={(open) => (
              <Button onClick={open}>
                <PenLine aria-hidden="true" />
                {STEP_TEXT[step].button}
              </Button>
            )}
          >
            {(close) => (
              <SignForm certificateId={certificateId} number={number} step={step} close={close} />
            )}
          </FormDialog>
        )
      ) : null}
      {canReturn ? (
        <FormDialog
          trigger={(open) => (
            <Button variant="secondary" onClick={open}>
              <Undo2 aria-hidden="true" />
              Return for correction
            </Button>
          )}
        >
          {(close) => <ReasonForm certificateId={certificateId} kind="return" close={close} />}
        </FormDialog>
      ) : null}
      {canCancel ? (
        <FormDialog
          trigger={(open) => (
            <Button variant="ghost" onClick={open}>
              <Ban aria-hidden="true" />
              Cancel certificate
            </Button>
          )}
        >
          {(close) => <ReasonForm certificateId={certificateId} kind="cancel" close={close} />}
        </FormDialog>
      ) : null}
    </div>
  );
}
