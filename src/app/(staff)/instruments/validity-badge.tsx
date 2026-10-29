import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { VALIDITY_LABELS, type ValidityState } from "@/domain/instruments/validity";

const TONES: Record<ValidityState, StatusTone> = {
  never: "neutral",
  expired: "fail",
  due_7: "fail",
  due_15: "attention",
  due_30: "attention",
  valid: "pass",
};

/** Calibration status with the due date: red when expired or within 7 days, amber within 30. */
export function ValidityBadge({
  state,
  validUntil,
}: {
  state: ValidityState;
  validUntil?: string | null;
}) {
  if (state === "valid") {
    return (
      <span className="tabular text-sm">{validUntil ? formatDate(validUntil) : "No due date"}</span>
    );
  }
  return (
    <StatusBadge tone={TONES[state]}>
      {VALIDITY_LABELS[state]}
      {validUntil && state !== "never" ? ` · ${formatDate(validUntil)}` : ""}
    </StatusBadge>
  );
}
