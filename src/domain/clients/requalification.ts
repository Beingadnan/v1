/**
 * When equipment is next due for a study.
 *
 * QA Tech's reports put the next due date one day before the anniversary:
 * BE-WF-02 mapped until 23.05.2026 → next due 22.05.2027 (12 months).
 * Dates are calendar dates ("YYYY-MM-DD"), with no time zone.
 */
export function nextDueDate(lastStudyOn: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastStudyOn);
  if (!match) throw new Error(`Not a date: ${lastStudyOn}`);
  const [, y, m, d] = match;
  const monthIndex = Number(m) - 1 + months;
  const year = Number(y) + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  // Same day in the target month, clamped to its last day (31 Jan + 1 month → 28/29 Feb).
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(year, month, Math.min(Number(d), lastDay)));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

export type DueStatus = "none" | "ok" | "due_soon" | "overdue";

/** "due_soon" is within 30 days; dates compare as calendar days. */
export function dueStatus(nextDue: string | null, today: string, soonDays = 30): DueStatus {
  if (!nextDue) return "none";
  if (nextDue < today) return "overdue";
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + soonDays);
  return nextDue <= soon.toISOString().slice(0, 10) ? "due_soon" : "ok";
}

/** Today's date in India, as "YYYY-MM-DD". */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
