/**
 * Picking loggers for a job in one click. Pure: the service loads the
 * candidates (with their certificates and other bookings) and saves the pick.
 *
 * Rules, from how QA Tech packs a kit:
 * - only loggers in use, valid from the first day of the study to the last,
 *   and not booked on another job with overlapping dates;
 * - loggers kept at the job's QA Tech site first;
 * - one model where possible, so one software reads the whole set;
 * - consecutive IDs (T-TRH0101, 0102…), which are easier to pack and place.
 */
import type { CertificateDates } from "@/domain/instruments/validity";

import { validThrough } from "./readiness";
import type { WorkType } from "./types";

export type Candidate = {
  id: string;
  code: string;
  type: string;
  tier: string;
  status: string;
  modelId: string | null;
  modelLabel: string;
  homeSiteId: string | null;
  certificates: CertificateDates[];
  /** Job numbers of other jobs holding it on overlapping dates. */
  busyOn: string[];
};

/** What each kind of study is measured with. */
export const INSTRUMENT_FOR: Record<WorkType, string | null> = {
  temperature_mapping: "portable_logger",
  temperature_rh_mapping: "portable_logger",
  thermal_validation: "thermocouple",
  onsite_calibration: null,
};

/** One spare per ten, at least one, as QA Tech carries for a failed or dropped logger. */
export function sparesFor(needed: number): number {
  return needed <= 0 ? 0 : Math.max(1, Math.ceil(needed / 10));
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export type Pick = {
  picked: Candidate[];
  /** How many could not be found. */
  short: number;
  /** Why loggers of the right type were passed over, counted. */
  skipped: { reason: string; count: number }[];
};

export function pickInstruments(input: {
  candidates: Candidate[];
  count: number;
  type: string;
  siteId: string | null;
  start: string;
  end: string;
  /** Already on this job: never picked twice. */
  exclude?: ReadonlySet<string>;
}): Pick {
  const reasons = new Map<string, number>();
  const skip = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  const usable: Candidate[] = [];
  for (const c of input.candidates) {
    if (c.type !== input.type || c.tier === "master" || input.exclude?.has(c.id)) continue;
    if (c.status !== "active") {
      skip("not in use");
      continue;
    }
    if (c.busyOn.length > 0) {
      skip("on another job on these dates");
      continue;
    }
    if (!validThrough(c, input.start, input.end).ok) {
      skip("not calibrated through these dates");
      continue;
    }
    usable.push(c);
  }

  // Groups by (same site, model). The best group covers the whole need on its own.
  const groups = new Map<string, Candidate[]>();
  for (const c of usable) {
    const key = `${c.homeSiteId === input.siteId ? 0 : 1}|${c.modelId ?? c.modelLabel}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const ordered = [...groups.entries()]
    .map(([key, list]) => ({
      local: key.startsWith("0|"),
      list: list.sort((a, b) => natural.compare(a.code, b.code)),
    }))
    .sort((a, b) => {
      const aCovers = a.list.length >= input.count;
      const bCovers = b.list.length >= input.count;
      if (aCovers !== bCovers) return aCovers ? -1 : 1;
      if (a.local !== b.local) return a.local ? -1 : 1;
      // Covering: the smallest group that fits keeps big sets free; otherwise the biggest.
      return aCovers ? a.list.length - b.list.length : b.list.length - a.list.length;
    });

  const picked: Candidate[] = [];
  for (const group of ordered) {
    for (const c of group.list) {
      if (picked.length >= input.count) break;
      picked.push(c);
    }
  }
  return {
    picked,
    short: Math.max(0, input.count - picked.length),
    skipped: [...reasons.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

/** Pasted IDs or serials, one per line or separated by commas, tabs or spaces. */
export function parseCodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
