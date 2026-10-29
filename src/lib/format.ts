/** Dates and times are shown in Indian time, matching QA Tech's reports. */
const IST = "Asia/Kolkata";

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

/** A calendar date stored as "YYYY-MM-DD" → "22 May 2027". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** A numeric column value ("-30.00") → "−30"; trailing zeros dropped, real minus sign. */
export function formatDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n).replace("-", "−");
}

/** Acceptance limits for display: "−30 to −15 °C", "≤ 25 °C", "≥ 2 °C" or "—". */
export function formatLimits(
  min: string | number | null | undefined,
  max: string | number | null | undefined,
  unit: string,
): string {
  const lo = formatDecimal(min);
  const hi = formatDecimal(max);
  if (lo && hi) return `${lo} to ${hi} ${unit}`;
  if (hi) return `≤ ${hi} ${unit}`;
  if (lo) return `≥ ${lo} ${unit}`;
  return "—";
}
