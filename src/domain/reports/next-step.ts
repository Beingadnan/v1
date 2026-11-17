import type { ReportStatus } from "./types";

/** Who a report waits on, as the reports list groups them. */
export type ReportStage = "todo" | "client" | "signed";

export type ReportStep = {
  stage: ReportStage;
  /** What to do now, as the button says it. */
  label: string;
  tone: "attention" | "fail" | "info" | "neutral" | "pass";
};

/**
 * The one thing to do next on a report (null: analysis approved, no report
 * yet), so the list says it in a button. QA Tech's work first, then the
 * client's.
 */
export function reportStep(status: ReportStatus | null): ReportStep {
  switch (status) {
    case null:
      return { stage: "todo", label: "Start the report", tone: "attention" };
    case "draft":
      return { stage: "todo", label: "Finish the draft", tone: "neutral" };
    case "checking":
      return { stage: "todo", label: "Check it", tone: "attention" };
    case "checked":
      return { stage: "todo", label: "Release to the client", tone: "attention" };
    case "returned":
      return { stage: "todo", label: "Fix and re-release", tone: "fail" };
    case "released":
    case "reviewed":
      return { stage: "client", label: "Record sign-off", tone: "info" };
    case "signed":
      return { stage: "signed", label: "Open", tone: "pass" };
    default:
      return { stage: "signed", label: "Open", tone: "neutral" };
  }
}
