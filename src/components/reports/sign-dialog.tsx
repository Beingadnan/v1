"use client";

import { PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormDialog, useCloseOnSuccess } from "@/components/ui/form-dialog";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";
import type { ActionResult } from "@/lib/action-result";

type SignAction = (prev: unknown, formData: FormData) => Promise<ActionResult<{ text: string }>>;

function SignForm({
  action,
  fields,
  title,
  body,
  close,
  onSigned,
}: {
  action: SignAction;
  fields: Record<string, string>;
  title: string;
  body: string;
  close: () => void;
  onSigned?: (text: string) => void;
}) {
  const router = useRouter();
  // The action's response also re-renders the page, which may remove this
  // dialog (the step is done), so the parent hears of success right here.
  const told = useRef(onSigned);
  useEffect(() => {
    told.current = onSigned;
  }, [onSigned]);
  const [signAndTell] = useState(() => async (prev: unknown, formData: FormData) => {
    const r = await action(prev, formData);
    if (r.ok) told.current?.(r.data.text);
    return r;
  });
  const { result, pending, onSubmit } = useFormAction(signAndTell);
  useCloseOnSuccess(result?.ok, close);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
      </DialogHeader>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <TextField
        name="password"
        label="Your password"
        type="password"
        autoComplete="current-password"
        required
        result={result}
        hint="Entering it again is your electronic signature: your name, the time and what it means are kept with the report."
      />
      {result?.ok ? (
        <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
          {result.data.text}
        </p>
      ) : (
        <FormMessage result={result} />
      )}
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

/**
 * A button that opens the password dialog for one electronic signature
 * (21 CFR 11.200: the password is asked at every signing).
 */
export function SignDialog({
  label,
  title,
  body,
  action,
  fields,
  onSigned,
  disabled,
}: {
  label: string;
  title: string;
  body: string;
  action: SignAction;
  fields: Record<string, string>;
  onSigned?: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <FormDialog
      trigger={(open) => (
        <Button className="w-full sm:w-fit" onClick={open} disabled={disabled}>
          <PenLine aria-hidden="true" />
          {label}
        </Button>
      )}
    >
      {(close) => (
        <SignForm
          action={action}
          fields={fields}
          title={title}
          body={body}
          close={close}
          onSigned={onSigned}
        />
      )}
    </FormDialog>
  );
}
