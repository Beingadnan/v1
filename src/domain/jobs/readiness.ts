/**
 * Is a job ready for field work? Most items are worked out from the job
 * itself; only the protocol, site access and previous report are ticked by
 * people. Pure, so the job page, the board and the "start field work" check
 * all agree.
 */
import {
  certificateCovering,
  latestCertificate,
  type CertificateDates,
} from "@/domain/instruments/validity";

import {
  READINESS_INFO,
  READINESS_ITEMS,
  type ReadinessKey,
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
  poNumber: string;
  plannedStart: string;
  plannedEnd: string;
  studies: {
    workType: WorkType;
    loggerCount: number;
    postCalRequired: boolean;
    /** Hours the loggers record for; null when not set. */
    durationHours?: number | null;
    /** Equipment ID, to name the study. */
    label?: string;
    /** Cycles run one after another (empty, loaded…); each runs for durationHours. */
    cycleCount?: number;
  }[];
  booked: BookedInstrument[];
  /** Any equipment on the job studied before: a requalification. */
  isRequalification: boolean;
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

/** Masters are needed for thermal validation, on-site calibration, or a client SOP asking for post-cal. */
export function needsMasters(studies: ReadinessInput["studies"]): boolean {
  return studies.some(
    (s) =>
      s.workType === "thermal_validation" ||
      s.workType === "onsite_calibration" ||
      s.postCalRequired,
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function listFew(reasons: string[]): string {
  return reasons.length <= 3
    ? reasons.join("; ")
    : `${reasons.slice(0, 3).join("; ")} and ${reasons.length - 3} more`;
}

export function computeReadiness(input: ReadinessInput): {
  items: ReadinessItem[];
  ready: boolean;
  pending: number;
} {
  const working = input.booked.filter((b) => b.tier !== "master");
  const masters = input.booked.filter((b) => b.tier === "master");
  const needed = loggersNeeded(input.studies);
  const mastersNeeded = needsMasters(input.studies);

  const calc: Record<ReadinessKey, { state: ReadinessState; detail: string } | null> = {
    purchase_order: input.poNumber.trim()
      ? { state: "ready", detail: `PO ${input.poNumber.trim()}` }
      : { state: "pending", detail: "Enter the client's PO number." },
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
    dates_fit: (() => {
      const days =
        (Date.parse(`${input.plannedEnd}T00:00:00Z`) -
          Date.parse(`${input.plannedStart}T00:00:00Z`)) /
        86_400_000;
      const hours = days * 24;
      // Cycles run one after another, each for the study's duration.
      const total = (s: ReadinessInput["studies"][number]) =>
        (s.durationHours ?? 0) * Math.max(1, s.cycleCount ?? 1);
      const long = input.studies
        .filter((s) => s.workType !== "onsite_calibration" && total(s) > hours)
        .sort((a, b) => total(b) - total(a));
      if (long.length === 0) {
        const max = Math.max(0, ...input.studies.map(total));
        return max
          ? {
              state: "ready" as const,
              detail: `${hours} h on site; the longest study needs ${max} h.`,
            }
          : { state: "na" as const, detail: "No study duration set." };
      }
      const need = total(long[0]!);
      const lastDay = new Date(
        Date.parse(`${input.plannedStart}T00:00:00Z`) + Math.ceil(need / 24) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      return {
        state: "pending" as const,
        detail: `${dmy(input.plannedStart)}–${dmy(input.plannedEnd)} gives ${hours} h, but ${listFew(
          long.map((s) =>
            (s.cycleCount ?? 1) > 1
              ? `${s.label ?? "a study"} needs ${total(s)} h (${s.cycleCount} cycles of ${s.durationHours} h)`
              : `${s.label ?? "a study"} needs ${total(s)} h`,
          ),
        )}. Move the last day to ${dmy(lastDay)} or shorten the study.`,
      };
    })(),
    protocol: null,
    site_access: null,
    previous_report: input.isRequalification
      ? null
      : { state: "na", detail: "First study of this equipment." },
  };

  const items = READINESS_ITEMS.map((key): ReadinessItem => {
    const info = READINESS_INFO[key];
    const worked = calc[key];
    const manual = input.manual[key];
    const base = { key, label: info.label, note: manual?.note ?? "" };
    if (worked && info.calculated) return { ...base, calculated: true, ...worked };
    // Manual items, and previous report when it doesn't apply unless someone ticked it.
    if (manual) {
      return { ...base, calculated: false, state: manual.state, detail: manual.note || info.hint };
    }
    if (worked) return { ...base, calculated: false, ...worked };
    return { ...base, calculated: false, state: "pending", detail: info.hint };
  });
  const pending = items.filter((i) => i.state === "pending").length;
  return { items, ready: pending === 0, pending };
}
