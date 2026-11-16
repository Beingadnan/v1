/**
 * Is a job ready for field work? Most items are worked out from the job
 * itself; site access is ticked by people, and the previous report only when
 * it was made before QTech. Pure, so the job page, the board and the "start
 * field work" check all agree.
 */
import {
  certificateCovering,
  latestCertificate,
  type CertificateDates,
} from "@/domain/instruments/validity";

import {
  ORDER_TYPE_SHORT,
  isContractType,
  READINESS_INFO,
  READINESS_ITEMS,
  type ReadinessKey,
  type OrderType,
  type ReadinessState,
  type WorkType,
} from "./types";

export type BookedInstrument = {
  code: string;
  type: string;
  tier: string;
  status: string;
  certificates: CertificateDates[];
};

export type ReadinessInput = {
  /** po, srf, arc or amc (older callers: a PO). */
  orderType?: OrderType;
  poNumber: string;
  /** The client's entry gate pass (older callers: none). */
  gatePass?: { number: string; notNeeded: boolean };
  /** The ARC or AMC the job is done under, if any. */
  contract?: { kind: string; number: string; validFrom: string; validTo: string } | null;
  plannedStart: string;
  plannedEnd: string;
  studies: {
    workType: WorkType;
    loggerCount: number;
    /** Positions laid out (an ambient one can be over the logger count); read for booking. */
    positions?: number;
    /** Optional in older callers; pre-calibration needs a master like post-calibration. */
    preCalRequired?: boolean;
    postCalRequired: boolean;
    /** Hours the loggers record for; null when not set. */
    durationHours?: number | null;
    /** Equipment ID, to name the study. */
    label?: string;
    /** Cycles run one after another (empty, loaded…); each runs for durationHours. */
    cycleCount?: number;
  }[];
  booked: BookedInstrument[];
  /**
   * Equipment on the job that was studied before (a requalification), with the
   * last report signed in QTech when there is one.
   */
  previousReports: { label: string; lastStudyOn: string | null; report: string | null }[];
  manual: Partial<Record<ReadinessKey, { state: ReadinessState; note: string }>>;
};

export type ReadinessItem = {
  key: ReadinessKey;
  label: string;
  state: ReadinessState;
  calculated: boolean;
  /** What is missing, or what was checked, in plain words. */
  detail: string;
  /** What a person wrote when ticking it (never the help text). */
  note: string;
  /** Pending holds back field work. The client's order doesn't: it can come later. */
  blocking: boolean;
};

const dmy = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Valid for the whole study: a certificate in force on the first day that is
 * still in force on the last. Says why not, naming the date.
 */
export function validThrough(
  instrument: BookedInstrument,
  start: string,
  end: string,
): { ok: true } | { ok: false; reason: string } {
  if (instrument.status !== "active") {
    return { ok: false, reason: `${instrument.code} is not in use` };
  }
  const cover = certificateCovering(instrument.certificates, start);
  if (!cover) {
    // Say when it ran out, which is what the lab needs to know.
    const latest = latestCertificate(instrument.certificates);
    if (latest?.validUntil && latest.validUntil < start) {
      return {
        ok: false,
        reason: `${instrument.code} is valid only until ${dmy(latest.validUntil)}`,
      };
    }
    if (latest && latest.calibratedOn > start) {
      return {
        ok: false,
        reason: `${instrument.code} is calibrated only from ${dmy(latest.calibratedOn)}`,
      };
    }
    return { ok: false, reason: `${instrument.code} has no valid certificate` };
  }
  if (cover.validUntil !== null && cover.validUntil < end) {
    return { ok: false, reason: `${instrument.code} is valid only until ${dmy(cover.validUntil)}` };
  }
  return { ok: true };
}

/** Loggers or probes the studies need (masters are counted separately). */
export function loggersNeeded(studies: ReadinessInput["studies"]): number {
  return studies.reduce(
    (sum, s) => sum + (s.workType === "onsite_calibration" ? 0 : s.loggerCount),
    0,
  );
}

/** Masters are needed for thermal validation, on-site calibration, or a study with pre- or post-calibration. */
export function needsMasters(studies: ReadinessInput["studies"]): boolean {
  return studies.some(
    (s) =>
      s.workType === "thermal_validation" ||
      s.workType === "onsite_calibration" ||
      s.preCalRequired === true ||
      s.postCalRequired,
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function listFew(reasons: string[]): string {
  return reasons.length <= 3
    ? reasons.join("; ")
    : `${reasons.slice(0, 3).join("; ")} and ${reasons.length - 3} more`;
}

/**
 * How many loggers a study takes: its logger count, or its laid-out positions when an
 * ambient position adds one (QA Tech, Nov 2026: 16 needed means 16 booked at most).
 */
export const loggersFor = (s: { loggerCount: number; positions?: number }) =>
  Math.max(s.loggerCount, s.positions ?? 0);

export function computeReadiness(input: ReadinessInput): {
  items: ReadinessItem[];
  ready: boolean;
  /** Items holding up field work. */
  pending: number;
  /** Items still open that don't hold it up (the client's order). */
  waiting: number;
} {
  const working = input.booked.filter((b) => b.tier !== "master");
  const masters = input.booked.filter((b) => b.tier === "master");
  const needed = loggersNeeded(input.studies);
  const mastersNeeded = needsMasters(input.studies);

  const calc: Record<ReadinessKey, { state: ReadinessState; detail: string } | null> = {
    purchase_order: orderReadiness(input),
    loggers_booked:
      needed === 0
        ? { state: "na", detail: "No loggers needed." }
        : working.length >= needed
          ? {
              state: "ready",
              detail: `${working.length} booked for ${needed} needed${working.length > needed ? ` (${working.length - needed} spare)` : ""}.`,
            }
          : {
              state: "pending",
              detail: `${working.length} of ${needed} booked: ${needed - working.length} more needed.`,
            },
    loggers_valid: (() => {
      if (working.length === 0) {
        return needed === 0
          ? { state: "na" as const, detail: "No loggers needed." }
          : { state: "pending" as const, detail: "Book loggers first." };
      }
      const bad = working
        .map((w) => validThrough(w, input.plannedStart, input.plannedEnd))
        .flatMap((r) => (r.ok ? [] : [r.reason]));
      return bad.length === 0
        ? {
            state: "ready" as const,
            detail: `All ${plural(working.length, "logger")} valid ${dmy(input.plannedStart)}–${dmy(input.plannedEnd)}.`,
          }
        : { state: "pending" as const, detail: `Not valid through the study: ${listFew(bad)}.` };
    })(),
    masters_valid: (() => {
      if (!mastersNeeded)
        return { state: "na" as const, detail: "No pre/post-calibration on this job." };
      if (masters.length === 0)
        return { state: "pending" as const, detail: "Book a master for pre/post-calibration." };
      const bad = masters
        .map((m) => validThrough(m, input.plannedStart, input.plannedEnd))
        .flatMap((r) => (r.ok ? [] : [r.reason]));
      return bad.length === 0
        ? {
            state: "ready" as const,
            detail: `${plural(masters.length, "master")} valid through the study.`,
          }
        : { state: "pending" as const, detail: `Not valid through the study: ${listFew(bad)}.` };
    })(),
    site_access: (() => {
      const g = input.gatePass;
      if (g?.number.trim())
        return { state: "ready" as const, detail: `Gate pass ${g.number.trim()}` };
      if (g?.notNeeded) return { state: "na" as const, detail: "No gate pass at this site." };
      // Jobs ticked by hand before the gate pass step keep their tick.
      const m = input.manual.site_access;
      if (m) return { state: m.state, detail: m.note || "Ticked before the gate pass step." };
      return {
        state: "pending" as const,
        detail: "Enter the client's gate pass number, or mark it not needed. Booking follows it.",
      };
    })(),
    previous_report: (() => {
      if (input.previousReports.length === 0) {
        return { state: "na" as const, detail: "First study of this equipment." };
      }
      const outside = input.previousReports.filter((p) => p.report === null);
      if (outside.length === 0) {
        return {
          state: "ready" as const,
          detail: `In QTech: ${listFew(input.previousReports.map((p) => `${p.label} ${p.report}`))}.`,
        };
      }
      // Mapped before QTech: someone has to find the old report and tick it.
      return {
        state: "pending" as const,
        detail: `Mapped before QTech, keep the last report to hand: ${listFew(
          outside.map((p) => (p.lastStudyOn ? `${p.label} (${dmy(p.lastStudyOn)})` : p.label)),
        )}.`,
      };
    })(),
  };

  const items = READINESS_ITEMS.map((key): ReadinessItem => {
    const info = READINESS_INFO[key];
    const worked = calc[key];
    const manual = input.manual[key];
    const base = {
      key,
      label: info.label,
      note: manual?.note ?? "",
      blocking: key !== "purchase_order",
    };
    if (worked && info.calculated) return { ...base, calculated: true, ...worked };
    // Worked out for certain (the previous report found in QTech, or no previous study).
    if (worked && worked.state !== "pending") return { ...base, calculated: true, ...worked };
    if (manual) {
      return { ...base, calculated: false, state: manual.state, detail: manual.note || info.hint };
    }
    if (worked) return { ...base, calculated: false, ...worked };
    return { ...base, calculated: false, state: "pending", detail: info.hint };
  });
  const pending = items.filter((i) => i.state === "pending" && i.blocking).length;
  /** Pending but not holding up field work: the client's order. */
  const waiting = items.filter((i) => i.state === "pending" && !i.blocking).length;
  return { items, ready: pending === 0, pending, waiting };
}

/** The client's order: its number, or the ARC/AMC covering the job's dates. */
function orderReadiness(input: ReadinessInput): { state: ReadinessState; detail: string } {
  const type = input.orderType ?? "po";
  const short = ORDER_TYPE_SHORT[type];
  if (isContractType(type)) {
    const c = input.contract;
    if (!c) return { state: "pending", detail: `${short} pending: pick the client's ${short}.` };
    if (c.validFrom > input.plannedStart || c.validTo < input.plannedStart) {
      return {
        state: "pending",
        detail: `${short} ${c.number} runs ${dmy(c.validFrom)}–${dmy(c.validTo)}, not on ${dmy(input.plannedStart)}: pick the current one.`,
      };
    }
    return { state: "ready", detail: `${short} ${c.number}, valid until ${dmy(c.validTo)}` };
  }
  const number = input.poNumber.trim();
  return number
    ? { state: "ready", detail: `${short} ${number}` }
    : {
        state: "pending",
        detail: `${short} pending: field work can go ahead; enter it when it comes.`,
      };
}

/**
 * When the days on site are too short for the longest study (every cycle
 * counted), says so and gives the last day that fits; otherwise null. Shown
 * under the job's dates: QA Tech didn't want it as a readiness item.
 */
export function datesShortfall(
  input: Pick<ReadinessInput, "plannedStart" | "plannedEnd" | "studies">,
): string | null {
  const hours =
    ((Date.parse(`${input.plannedEnd}T00:00:00Z`) - Date.parse(`${input.plannedStart}T00:00:00Z`)) /
      86_400_000) *
    24;
  // Cycles run one after another, each for the study's duration.
  const total = (s: ReadinessInput["studies"][number]) =>
    (s.durationHours ?? 0) * Math.max(1, s.cycleCount ?? 1);
  const long = input.studies
    .filter((s) => s.workType !== "onsite_calibration" && total(s) > hours)
    .sort((a, b) => total(b) - total(a));
  if (long.length === 0) return null;
  const lastDay = new Date(
    Date.parse(`${input.plannedStart}T00:00:00Z`) + Math.ceil(total(long[0]!) / 24) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  return `${dmy(input.plannedStart)}–${dmy(input.plannedEnd)} gives ${hours} h, but ${listFew(
    long.map((s) =>
      (s.cycleCount ?? 1) > 1
        ? `${s.label ?? "a study"} needs ${total(s)} h (${s.cycleCount} cycles of ${s.durationHours} h)`
        : `${s.label ?? "a study"} needs ${total(s)} h`,
    ),
  )}. Move the last day to ${dmy(lastDay)} or shorten the study.`;
}
