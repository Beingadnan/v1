"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";

import { setPasswordAction, type FormState } from "../actions";

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    setPasswordAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the password against the right account. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Field
        id="password"
        label="New password"
        hint="At least 12 characters. A short sentence is easy to remember and hard to guess."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="password-desc"
          required
          autoFocus
        />
      </Field>
      <Field id="confirm" label="Type it again">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {state?.error ? (
        <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
