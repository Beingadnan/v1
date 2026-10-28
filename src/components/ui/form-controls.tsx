import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const controlBase =
  "w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:bg-surface-muted aria-invalid:border-fail";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn(controlBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlBase, "min-h-20 py-2", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

type FieldProps = {
  id: string;
  label: string;
  /** Short help shown under the control. */
  hint?: string;
  /** Validation message. Says what to fix, not just what is wrong. */
  error?: string;
  required?: boolean;
  children: ReactNode;
};

/**
 * Label + control + hint/error, wired for screen readers.
 * The child control must use the same `id` and should set
 * aria-describedby={`${id}-desc`} and aria-invalid when `error` is set.
 */
export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-0.5 text-fail" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {message ? (
        <p
          id={`${id}-desc`}
          className={cn("text-xs", error ? "text-fail" : "text-muted-foreground")}
          role={error ? "alert" : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
