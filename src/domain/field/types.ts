/**
 * Field work: the vocabulary shared by the database checks, the services and
 * the phone screens.
 */
import type { StudyCycle } from "@/domain/clients/study-defaults";

export const STUDY_STATUSES = ["planned", "in_progress", "completed"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];
export const STUDY_STATUS_LABELS: Record<StudyStatus, string> = {
  planned: "Not started",
  in_progress: "Running",
  completed: "Done",
};

/** Time markers recorded on site. Door and power markers belong to their own cycles. */
export const EVENT_KINDS = [
  "start",
  "end",
  "door_opened",
  "door_closed",
  "power_off",
  "power_on",
  "hold_start",
  "hold_end",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_LABELS: Record<EventKind, string> = {
  start: "Started",
  end: "Ended",
  door_opened: "Door opened",
  door_closed: "Door closed",
  power_off: "Power off",
  power_on: "Power restored",
  hold_start: "Hold started",
  hold_end: "Hold ended",
};

/** Which markers each cycle offers, in the order they happen. */
export const CYCLE_MARKERS: Record<StudyCycle, readonly EventKind[]> = {
  empty: ["start", "end"],
  loaded: ["start", "end"],
  door_open: ["start", "door_opened", "door_closed", "end"],
  power_failure: ["start", "power_off", "power_on", "end"],
  // Autoclave / SIP load patterns: the sterilisation hold is the F0 window.
  min_load: ["start", "hold_start", "hold_end", "end"],
  max_load: ["start", "hold_start", "hold_end", "end"],
};

/** A study with no cycles chosen still has one routine run. */
export const ROUTINE = "routine" as const;
export type CycleKey = StudyCycle | typeof ROUTINE;
export const ROUTINE_MARKERS: readonly EventKind[] = ["start", "end"];

/**
 * The markers a cycle offers. On thermal validation (autoclave, oven, SIP)
 * every cycle also has its hold start and end, for F0 in phase 7.
 */
export function markersFor(cycle: CycleKey, thermal = false): readonly EventKind[] {
  const base = cycle === ROUTINE ? ROUTINE_MARKERS : CYCLE_MARKERS[cycle];
  if (!thermal || base.includes("hold_start")) return base;
  return ["start", "hold_start", "hold_end", ...base.slice(1)];
}

export const PRECAL_RESULTS = ["pass", "fail"] as const;
export type PrecalResult = (typeof PRECAL_RESULTS)[number];

/**
 * What is marked on a room's floor plan beside the loggers (QA Tech's WH013
 * diagram shows the RLAF, the supply duct and the pass box near the door).
 * Positions are fractions of the plan, as for loggers.
 */
export const PLAN_FEATURE_KINDS = [
  "door",
  "pass_box",
  "laf",
  "supply",
  "return",
  "cooling",
  "window",
  "heat",
  "other",
] as const;
export type PlanFeatureKind = (typeof PLAN_FEATURE_KINDS)[number];
export const PLAN_FEATURE_LABELS: Record<PlanFeatureKind, string> = {
  door: "Door",
  pass_box: "Pass box",
  laf: "LAF / RLAF",
  supply: "Supply duct",
  return: "Return air",
  cooling: "AC / cooling unit",
  window: "Window",
  heat: "Heat source",
  other: "Other",
};
/** Short marks drawn on the plan. */
export const PLAN_FEATURE_MARKS: Record<PlanFeatureKind, string> = {
  door: "D",
  pass_box: "PB",
  laf: "LAF",
  supply: "SD",
  return: "RA",
  cooling: "AC",
  window: "W",
  heat: "H",
  other: "*",
};
export type PlanFeature = { kind: PlanFeatureKind; label: string; x: number; y: number };
