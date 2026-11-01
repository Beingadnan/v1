/**
 * Observation and conclusion text, worded like QA Tech's issued reports
 * (BE-WF-02, page 6). People may edit it; these are the starting points.
 * Pure: everything comes in as arguments.
 */
import type { CycleResult, Excursion } from "@/domain/analysis/engine";

export type TemplateInput = {
  /** "Walk In Freezer". */
  equipmentName: string;
  /** "BE-WF-02". */
  equipmentCode: string;
  /** "Temperature Mapping Study". */
  studyName: string;
  limits: { tempMin: number | null; tempMax: number | null };
  cycles: CycleResult[];
  /** Serial printed beside each position (the logger used there). */
  serialOf: (positionId: string) => string;
  /** Reviews of excursions in the run, by excursion. */
  reviewOf: (
    e: Excursion,
    cycle: string,
  ) => { decision: string; reason: string; deviation: string | null } | null;
  /** Closed deviations' outcomes, for the conclusion ("QT/DEV/2026/0001: No impact"). */
  deviations: { number: string; outcome: string }[];
};

/** One decimal with an ASCII minus, as typed in QA Tech's reports (−21.9 → -21.9). */
export const t1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const plain = (v: number) => String(Math.round(v * 10) / 10);

/** "-15°C To -30°C": the upper limit first, as QA Tech writes it. */
export function criteriaText(l: TemplateInput["limits"]): string {
  if (l.tempMax !== null && l.tempMin !== null)
    return `${plain(l.tempMax)}°C To ${plain(l.tempMin)}°C`;
  if (l.tempMax !== null) return `not above ${plain(l.tempMax)}°C`;
  if (l.tempMin !== null) return `not below ${plain(l.tempMin)}°C`;
  return "no acceptance criteria set";
}

const prefix = (cycles: CycleResult[], c: CycleResult) => (cycles.length > 1 ? `${c.label}: ` : "");

export function observationText(i: TemplateInput): string {
  const lines: string[] = [];
  for (const c of i.cycles) {
    const p = prefix(i.cycles, c);
    if (c.cold) {
      lines.push(
        `${p}The Datalogger location No ${c.cold.label} (${i.serialOf(c.cold.positionId)}) shown in yellow colour in the sensor location diagram recorded the average minimum temperature (${t1(c.cold.avg)}°C); this location is the cold point of the equipment.`,
      );
    }
    if (c.hot) {
      lines.push(
        `${p}The Datalogger location No ${c.hot.label} (${i.serialOf(c.hot.positionId)}) shown in red colour in the sensor location diagram recorded the average maximum temperature (${t1(c.hot.avg)}°C); this location is the hot point of the equipment.`,
      );
    }
    for (const d of c.door) {
      lines.push(
        `${p}Door opening: ${d.recoveryMinutes === null ? "the temperature did not come back within the acceptance criteria before the end of the study" : `the temperature came back within the acceptance criteria ${d.recoveryMinutes} min after the door was closed`}.`,
      );
    }
    for (const pw of c.power) {
      lines.push(
        `${p}Power failure: ${pw.heldThroughout ? "the temperature stayed within the acceptance criteria throughout" : `the temperature stayed within the acceptance criteria for ${pw.holdoverMinutes} min`}${pw.recoveryMinutes !== null ? `, and came back within them ${pw.recoveryMinutes} min after power was restored` : ""}.`,
      );
    }
    if (c.hold?.minF0) {
      lines.push(
        `${p}The lowest F0 during the hold was ${t1(c.hold.minF0.value)} min at ${c.hold.minF0.label}.`,
      );
    }
  }
  return lines.join("\n");
}

export function conclusionText(i: TemplateInput): string {
  const criteria = criteriaText(i.limits);
  const subject = `The above mentioned equipment ${i.equipmentName} (${i.equipmentCode}) is monitored for ${i.studyName}`;
  const excursions = i.cycles.flatMap((c) => c.excursions.map((e) => ({ e, c })));
  if (i.cycles.every((c) => c.pass !== false)) {
    return `${subject} & result found as per the acceptance criteria, so this equipment is in compliance with the defined criteria (${criteria}) & qualified for its further use.`;
  }
  const described = excursions.map(({ e, c }) => {
    const r = i.reviewOf(e, c.cycle);
    const what = `${prefix(i.cycles, c)}${e.label} went ${e.side === "high" ? "above" : "below"} ${plain(e.limit)}°C for ${e.minutes} min (peak ${t1(e.peak)}°C)`;
    if (!r) return `${what}`;
    return r.decision === "accepted"
      ? `${what}, accepted: ${r.reason.replace(/\.$/, "")}`
      : `${what}, raised as deviation ${r.deviation}`;
  });
  const allReviewed = excursions.every(({ e, c }) => i.reviewOf(e, c.cycle) !== null);
  const devs = i.deviations.map((d) => `${d.number}: ${d.outcome}`).join("; ");
  const head = `${subject}. ${described.join("; ")}.`;
  if (allReviewed) {
    return `${head}${devs ? ` Deviations: ${devs}.` : ""} With the above assessed, this equipment is in compliance with the defined criteria (${criteria}) & qualified for its further use.`;
  }
  return `${head} This equipment is not in compliance with the defined criteria (${criteria}).`;
}
