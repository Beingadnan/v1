import type { MyStudy } from "./queries";

/** Where a study is, as the studies list groups it. */
export type StudyStage = "site" | "data" | "postcal" | "analysis" | "done";

export const STAGE_LABELS: Record<StudyStage, string> = {
  site: "On site",
  data: "Data",
  postcal: "Post-cal",
  analysis: "Analysis",
  done: "Done",
};

export type NextStep = {
  stage: StudyStage;
  /** What to do now, as the button says it. */
  label: string;
  /** The study page tab that does it. */
  tab: string;
  tone: "attention" | "fail" | "info" | "neutral" | "pass";
  /** A line more, when the label isn't enough (what the office asked for). */
  detail?: string;
};

/**
 * The one thing to do next on a study, so the list can say it in a button
 * instead of a paragraph. Same order as the study page's steps.
 */
export function nextStep(r: MyStudy): NextStep {
  if (r.request) {
    return {
      stage: "data",
      label: "Send the data asked for",
      tab: "data",
      tone: "attention",
      detail: r.request,
    };
  }
  if (r.status === "completed" && r.dataStatus !== "received") {
    if (r.dataStatus === "issues")
      return { stage: "data", label: "Fix the data", tab: "data", tone: "fail" };
    if (r.dataStatus === "checked")
      return { stage: "data", label: "Confirm the data", tab: "data", tone: "info" };
    return { stage: "data", label: "Upload logger data", tab: "data", tone: "attention" };
  }
  if (r.status === "completed" && r.postCalLeft > 0) {
    return {
      stage: "postcal",
      label: `Post-calibrate ${r.postCalLeft} logger${r.postCalLeft === 1 ? "" : "s"}`,
      tab: "postcal",
      tone: "attention",
    };
  }
  if (r.status === "completed") {
    return r.toAnalyse
      ? r.jobStatus === "analysis"
        ? { stage: "analysis", label: "Analysis under way", tab: "analysis", tone: "info" }
        : { stage: "analysis", label: "Analyse", tab: "analysis", tone: "info" }
      : { stage: "done", label: "Done", tab: "report", tone: "pass" };
  }
  if (r.positions === 0)
    return { stage: "site", label: "Lay out positions", tab: "layout", tone: "neutral" };
  if (r.placed < r.positions)
    return { stage: "site", label: "Place loggers", tab: "loggers", tone: "neutral" };
  return r.status === "in_progress"
    ? { stage: "site", label: "Record the end", tab: "times", tone: "info" }
    : { stage: "site", label: "Record the start", tab: "times", tone: "neutral" };
}
