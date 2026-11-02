"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { FormMessage, TextField, useFormAction } from "@/components/ui/form-kit";
import { DEVIATION_DECISION_LABELS, DEVIATION_DECISIONS } from "@/domain/analysis/types";

import { clientDecideAction } from "../../actions";

const HELP: Record<(typeof DEVIATION_DECISIONS)[number], string> = {
  no_impact: "The result stands as reported.",
  exclude_probe: "This position is left out and the analysis is run again without it.",
  repeat_study: "The mapping study is done again.",
};

/** The QA head's decision, signed with their password. */
export function DecideForm({
  id,
  number,
  canExclude,
}: {
  id: string;
  number: string;
  canExclude: boolean;
}) {
  const router = useRouter();
  const { result, pending, onSubmit } = useFormAction(clientDecideAction);
  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);
  const choices = DEVIATION_DECISIONS.filter((d) => d !== "exclude_probe" || canExclude);
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      noValidate
    >
      <input type="hidden" name="deviationId" value={id} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Your decision on {number}</legend>
        {choices.map((d, i) => (
          <label key={d} className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="radio"
              name="decision"
              value={d}
              defaultChecked={i === 0}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              <strong>{DEVIATION_DECISION_LABELS[d]}</strong>
              <span className="block text-muted-foreground">{HELP[d]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <TextField name="note" label="Note (optional)" multiline result={result} />
      <TextField
        name="password"
        label="Your password"
        type="password"
        autoComplete="current-password"
        required
        result={result}
        hint="Entering it again is your electronic signature on this decision."
      />
      <FormMessage result={result} />
      <Button type="submit" className="w-full sm:w-fit" disabled={pending}>
        {pending ? "Signing…" : "Sign the decision"}
      </Button>
    </form>
  );
}
