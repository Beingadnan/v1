"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { receivedAction } from "../data-actions";

/**
 * The last step of Start & end: once the period is chosen and the data has
 * nothing wrong in it, a team leader or manager confirms it (ADR 0022).
 */
export function ConfirmData({
  studyId,
  jobNumber,
  periodSet,
}: {
  studyId: string;
  jobNumber: string;
  /** Every cycle has a start and an end. */
  periodSet: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  function confirm() {
    start(async () => {
      setFeedback(null);
      const r = await receivedAction(studyId);
      if (!r.ok) {
        setFeedback({ ok: false, text: r.error });
        return;
      }
      const job = (r as { data?: { jobStatus?: string } }).data?.jobStatus;
      setFeedback({
        ok: true,
        text:
          job === "data_received"
            ? `Data confirmed. Every study on job ${jobNumber} is in: the job is now Data received.`
            : "Data confirmed.",
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" className="w-fit" disabled={busy || !periodSet} onClick={confirm}>
        Confirm the data is complete
      </Button>
      {!periodSet ? (
        <p className="text-xs text-muted-foreground">Save the report period first.</p>
      ) : null}
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
    </div>
  );
}
