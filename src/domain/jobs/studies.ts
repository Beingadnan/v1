/**
 * Turning an equipment record into a study on a job: the defaults, the
 * suggested season and the reserved report number. Pure.
 */
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { suggestLoggerCount } from "@/domain/clients/study-defaults";

import type { Season, WorkType } from "./types";

export type EquipmentForStudy = {
  type: string;
  lengthM: string | null;
  widthM: string | null;
  heightM: string | null;
  rhMinPct: string | null;
  rhMaxPct: string | null;
  defaultChannels: number | null;
  seasonalMapping: boolean;
};

/** Autoclaves and ovens are validated; rooms with RH limits are mapped for RH too. */
export function defaultWorkType(e: EquipmentForStudy): WorkType {
  const info = isEquipmentType(e.type) ? EQUIPMENT_TYPE_INFO[e.type] : null;
  if (info?.study === "thermal_validation") return "thermal_validation";
  if (e.rhMinPct !== null || e.rhMaxPct !== null) return "temperature_rh_mapping";
  return "temperature_mapping";
}

/** The equipment's own channel count, else a count from its size, else 0 for the team to fill. */
export function defaultLoggerCount(e: EquipmentForStudy): number {
  if (e.defaultChannels !== null && e.defaultChannels > 0) return e.defaultChannels;
  const n = (v: string | null) => (v === null ? null : Number(v));
  return (
    suggestLoggerCount(
      { lengthM: n(e.lengthM), widthM: n(e.widthM), heightM: n(e.heightM) },
      e.type === "room" ? "room" : "box",
    )?.count ?? 0
  );
}

/**
 * Indian seasons for spaces mapped per season (WHO Suppl. 8 §2.2.4):
 * summer March–May, monsoon June–September, winter October–February.
 */
export function seasonFor(seasonal: boolean, isoDate: string): Season {
  if (!seasonal) return "";
  const month = Number(isoDate.slice(5, 7));
  if (month >= 3 && month <= 5) return "summer";
  if (month >= 6 && month <= 9) return "monsoon";
  return "winter";
}

/**
 * The report number, made unique. The same equipment twice in one month (a
 * repeat after a failure, or summer and monsoon back to back) gets -2, -3…
 * rather than two reports with one number.
 */
export function uniqueReportNumber(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error(`No free report number for ${base}`);
}

/**
 * Whether a study has pre- and post-calibration. QA Tech chooses per study
 * (yes/no); thermal validation (autoclaves, ovens) always has both, as the
 * sensors are calibrated before the runs and checked after them.
 */
export function calibrationOf(study: {
  workType: string;
  preCalRequired: boolean;
  postCalRequired: boolean;
}): { pre: boolean; post: boolean; locked: boolean } {
  const locked = study.workType === "thermal_validation";
  return {
    pre: locked || study.preCalRequired,
    post: locked || study.postCalRequired,
    locked,
  };
}
