import { AlertTriangle, Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "attention" | "upcoming" | "locked";

export type Step = {
  id: string;
  label: string;
  state: StepState;
  /** Why a step needs attention or is locked, in plain words. */
  note?: string;
};

/**
 * Numbered progress for long work (a study: Details → Sensors → Data → Review → Report → Sign).
 * Numbers are used because the steps really are a sequence.
 */
export function Stepper({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-1 md:flex-row md:gap-0", className)}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex min-w-0 flex-1 items-start gap-2 md:flex-col md:items-stretch"
        >
          <div className="flex items-center md:w-full">
            <StepMarker number={index + 1} state={step.state} />
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "mx-2 hidden h-px flex-1 md:block",
                  step.state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
          </div>
          <div className="min-w-0 md:mt-2 md:pr-3">
            <p
              className={cn(
                "text-sm font-medium",
                step.state === "upcoming" || step.state === "locked"
                  ? "text-muted-foreground"
                  : "text-foreground",
              )}
            >
              {step.label}
            </p>
            {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMarker({ number, state }: { number: number; state: StepState }) {
  const base =
    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-primary text-primary-foreground")}>
          <Check className="size-4" aria-hidden="true" />
          <span className="sr-only">Step {number} done</span>
        </span>
      );
    case "current":
      return (
        <span className={cn(base, "border-2 border-primary bg-surface text-primary")}>
          {number}
        </span>
      );
    case "attention":
      return (
        <span className={cn(base, "bg-attention-soft text-attention")}>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span className="sr-only">Step {number} needs attention</span>
        </span>
      );
    case "locked":
      return (
        <span className={cn(base, "bg-surface-muted text-muted-foreground")}>
          <Lock className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Step {number} locked</span>
        </span>
      );
    case "upcoming":
      return (
        <span className={cn(base, "border border-input bg-surface text-muted-foreground")}>
          {number}
        </span>
      );
  }
}
