/**
 * Prices from QA Tech's rate card. A line names a work type, optionally an
 * equipment type and a study duration, and a basis (per study, per cycle, per
 * logger, per m³). The most specific matching line wins.
 */
import type { RateBasis, WorkType } from "./types";
import { RATE_BASIS_LABELS } from "./types";

export type RateLine = {
  id: string;
  workType: string;
  equipmentType: string;
  durationHours: number | null;
  basis: string;
  price: string | number;
  active: boolean;
};

export type PricedStudy = {
  workType: WorkType;
  equipmentType: string;
  durationHours: number | null;
  cycles: string[];
  loggerCount: number;
  /** Length × width × height in metres, when known. */
  volumeM3: number | null;
};

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const formatInr = (n: number) => `₹${inr.format(n)}`;

export function matchRate(lines: RateLine[], study: PricedStudy): RateLine | null {
  let best: { line: RateLine; score: number } | null = null;
  for (const line of lines) {
    if (!line.active || line.workType !== study.workType) continue;
    if (line.equipmentType && line.equipmentType !== study.equipmentType) continue;
    if (line.durationHours !== null && line.durationHours !== study.durationHours) continue;
    const score = (line.equipmentType ? 2 : 0) + (line.durationHours !== null ? 1 : 0);
    if (!best || score > best.score) best = { line, score };
  }
  return best?.line ?? null;
}

export function priceStudy(
  lines: RateLine[],
  study: PricedStudy,
): { price: number | null; note: string } {
  const line = matchRate(lines, study);
  if (!line) return { price: null, note: "No rate-card line for this work." };
  const unit = Number(line.price);
  const basis = line.basis as RateBasis;
  let qty: number;
  let what: string;
  switch (basis) {
    case "per_study":
      qty = 1;
      what = "";
      break;
    case "per_cycle":
      qty = Math.max(1, study.cycles.length);
      what = ` × ${qty} cycle${qty === 1 ? "" : "s"}`;
      break;
    case "per_logger":
      qty = study.loggerCount;
      what = ` × ${qty} logger${qty === 1 ? "" : "s"}`;
      break;
    case "per_m3":
      if (study.volumeM3 === null) {
        return {
          price: null,
          note: `Priced per m³ (${formatInr(unit)}): add the equipment's dimensions.`,
        };
      }
      qty = Math.round(study.volumeM3 * 100) / 100;
      what = ` × ${qty} m³`;
      break;
    default:
      return { price: null, note: "Unknown rate basis." };
  }
  const price = Math.round(unit * qty * 100) / 100;
  return {
    price,
    note: `${formatInr(unit)} ${RATE_BASIS_LABELS[basis]}${what}`,
  };
}

/**
 * What the job should be worth, and how the PO compares. A custom quote
 * replaces the rate card. Differences under ₹1 are rounding.
 */
export function jobValue(input: {
  studyPrices: (number | null)[];
  quotedValue: number | null;
  poValue: number | null;
}): {
  expected: number | null;
  source: "quote" | "rate_card" | "none";
  unpriced: number;
  poDifference: number | null;
} {
  const unpriced = input.studyPrices.filter((p) => p === null).length;
  const sum = input.studyPrices.reduce<number>((s, p) => s + (p ?? 0), 0);
  const expected =
    input.quotedValue !== null
      ? input.quotedValue
      : input.studyPrices.length > 0 && unpriced < input.studyPrices.length
        ? Math.round(sum * 100) / 100
        : null;
  const source = input.quotedValue !== null ? "quote" : expected !== null ? "rate_card" : "none";
  const diff =
    expected !== null && input.poValue !== null
      ? Math.round((input.poValue - expected) * 100) / 100
      : null;
  return {
    expected,
    source,
    unpriced,
    poDifference: diff !== null && Math.abs(diff) < 1 ? 0 : diff,
  };
}

export function volumeOf(l: string | null, w: string | null, h: string | null): number | null {
  if (l === null || w === null || h === null) return null;
  const v = Number(l) * Number(w) * Number(h);
  return Number.isFinite(v) && v > 0 ? v : null;
}
