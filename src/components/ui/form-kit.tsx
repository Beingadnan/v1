"use client";

import { startTransition, useActionState, type ComponentProps, type FormEvent } from "react";

import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

import { Field, Input, Textarea } from "./form-controls";

type FormAction<T> = (prev: unknown, formData: FormData) => Promise<ActionResult<T>>;

/**
 * Runs a server action from a form without React's automatic form reset, so
 * when the server rejects a value the person keeps everything they typed and
 * only fixes the field that is marked.
 */
export function useFormAction<T>(action: FormAction<T>) {
  const [result, dispatch, pending] = useActionState<ActionResult<T> | undefined, FormData>(
    action,
    undefined,
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { result, pending, onSubmit };
}

export function fieldError(
  result: ActionResult<unknown> | undefined,
  name: string,
): string | undefined {
  return result && !result.ok ? result.fieldErrors?.[name] : undefined;
}

/** The form-level message: what went wrong, or that it saved. */
export function FormMessage({ result }: { result: ActionResult<unknown> | undefined }) {
  if (!result) return null;
  return result.ok ? (
    <p role="status" className="rounded-md bg-pass-soft px-3 py-2 text-sm text-pass">
      {result.message ?? "Saved."}
    </p>
  ) : (
    <p role="alert" className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
      {result.error}
    </p>
  );
}

type TextFieldProps = {
  name: string;
  label: string;
  result?: ActionResult<unknown>;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
  /** Unit shown inside the box, e.g. "°C". */
  suffix?: string;
  className?: string;
} & Omit<ComponentProps<"input">, "name" | "id" | "className">;

/** Label + input + hint/error in one, wired for screen readers. */
export function TextField({
  name,
  label,
  result,
  hint,
  required,
  multiline,
  suffix,
  className,
  defaultValue,
  ...input
}: TextFieldProps) {
  const error = fieldError(result, name);
  const shared = {
    id: name,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": `${name}-desc`,
    required,
  };
  return (
    <div className={className}>
      <Field id={name} label={label} hint={hint} error={error} required={required}>
        {multiline ? (
          <Textarea
            {...shared}
            {...(input as ComponentProps<"textarea">)}
            defaultValue={defaultValue as string | undefined}
          />
        ) : suffix ? (
          <div className="relative">
            <Input {...shared} {...input} defaultValue={defaultValue} className="pr-12" />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              {suffix}
            </span>
          </div>
        ) : (
          <Input {...shared} {...input} defaultValue={defaultValue} />
        )}
      </Field>
    </div>
  );
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:bg-surface-muted aria-invalid:border-fail";

/**
 * A native select: works with plain form submission, the phone's own picker
 * and screen readers without extra code.
 */
export function SelectField({
  name,
  label,
  result,
  hint,
  required,
  className,
  children,
  ...select
}: {
  name: string;
  label: string;
  result?: ActionResult<unknown>;
  hint?: string;
  required?: boolean;
  className?: string;
} & Omit<ComponentProps<"select">, "name" | "id" | "className">) {
  const error = fieldError(result, name);
  return (
    <div className={className}>
      <Field id={name} label={label} hint={hint} error={error} required={required}>
        <select
          id={name}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${name}-desc`}
          className={cn(selectClass)}
          {...select}
        >
          {children}
        </select>
      </Field>
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
  disabled,
  value,
  id = value ? `${name}-${value}` : name,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  /** For a group of checkboxes sharing one name. */
  value?: string;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-md border border-border p-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5 size-4 accent-primary"
        aria-describedby={hint ? `${id}-desc` : undefined}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? (
          <span id={`${id}-desc`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
