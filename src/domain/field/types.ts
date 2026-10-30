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
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_LABELS: Record<EventKind, string> = {
  start: "Started",
  end: "Ended",
  door_opened: "Door opened",
  door_closed: "Door closed",
  power_off: "Power off",
  power_on: "Power restored",
};

/** Which markers each cycle offers, in the order they happen. */
export const CYCLE_MARKERS: Record<StudyCycle, readonly EventKind[]> = {
  empty: ["start", "end"],
  loaded: ["start", "end"],
  door_open: ["start", "door_opened", "door_closed", "end"],
  power_failure: ["start", "power_off", "power_on", "end"],
};

/** A study with no cycles chosen still has one routine run. */
export const ROUTINE = "routine" as const;
export type CycleKey = StudyCycle | typeof ROUTINE;
export const ROUTINE_MARKERS: readonly EventKind[] = ["start", "end"];

export function markersFor(cycle: CycleKey): readonly EventKind[] {
  return cycle === ROUTINE ? ROUTINE_MARKERS : CYCLE_MARKERS[cycle];
}

export const PRECAL_RESULTS = ["pass", "fail"] as const;
export type PrecalResult = (typeof PRECAL_RESULTS)[number];
