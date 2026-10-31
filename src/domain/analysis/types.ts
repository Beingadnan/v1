/**
 * Analysis and deviations: the vocabulary shared by the database checks, the
 * services and the screens.
 */
import type { Constants, Limits, Window } from "./engine";

export const RUN_KINDS = ["analysis", "impact"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const EXCURSION_DECISIONS = ["accepted", "deviation"] as const;
export type ExcursionDecision = (typeof EXCURSION_DECISIONS)[number];

export const DEVIATION_SOURCES = ["post_cal", "excursion", "manual"] as const;
export type DeviationSource = (typeof DEVIATION_SOURCES)[number];
export const DEVIATION_SOURCE_LABELS: Record<DeviationSource, string> = {
  post_cal: "Post-calibration failure",
  excursion: "Excursion",
  manual: "Raised by hand",
};

export const DEVIATION_DECISIONS = ["no_impact", "exclude_probe", "repeat_study"] as const;
export type DeviationDecision = (typeof DEVIATION_DECISIONS)[number];
export const DEVIATION_DECISION_LABELS: Record<DeviationDecision, string> = {
  no_impact: "No impact",
  exclude_probe: "Exclude probe",
  repeat_study: "Repeat study",
};

export const DEFAULT_DEVIATION_NUMBER_FORMAT = "QT/DEV/{YYYY}/{SEQ:4}";

/** What a run was made from, kept with it so it can be reproduced and checked. */
export type RunInputs = {
  constants: Constants;
  limits: Limits;
  thermal: boolean;
  windows: Window[];
  files: { id: string; name: string; sha256: string }[];
  /** Channel → position, as matched when the run was made. */
  matches: { channelId: string; positionId: string; quantity: "temp" | "rh" }[];
  acceptedProblems: string[];
  excluded: { positionId: string; reason: string }[];
  corrections: { positionId: string; quantity: "temp" | "rh"; offset: number }[];
};

/** Excursion fingerprint: stable while the same readings are out. */
export function excursionKey(e: {
  cycle: string;
  positionId: string;
  quantity: string;
  side: string;
  start: number;
}) {
  return [e.cycle, e.positionId, e.quantity, e.side, e.start].join("|");
}
