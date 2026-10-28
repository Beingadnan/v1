"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";

import { changePasswordAction, type ChangePasswordState } from "./actions";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    undefined,
  );

  if (state?.done) {
    return (
      <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
        Password changed. You stay signed in here; other devices were signed out.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Field id="current" label="Current password">
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field id="password" label="New password" hint="At least 12 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="password-desc"
          required
        />
      </Field>
      <Field id="confirm" label="Type the new password again">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {state?.error ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
