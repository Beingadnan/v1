/**
 * Dates and times as QA Tech types them: "01-08-26", "01.08.2026", "1/8/2026";
 * "11:30 AM", "11.30am", "1130", "23:30". Read as India time.
 */

/** "01-08-2026" (and the variants above) → "2026-08-01", or null. */
export function parseTypedDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\s*[-./ ]\s*(\d{1,2})\s*[-./ ]\s*(\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "11:30 AM", "11.30pm", "1130", "23:30" → "11:30" / "23:30" (24-hour), or null. */
export function parseTypedTime(text: string): string | null {
  const m = /^\s*(\d{1,2})(?:\s*[:.]?\s*(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const half = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59) return null;
  if (half) {
    if (h < 1 || h > 12) return null;
    if (half === "am" && h === 12) h = 0;
    if (half === "pm" && h !== 12) h += 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** An instant as the typed form shows it in India time: ["01-08-2026", "11:30 AM"]. */
export function toTypedParts(at: Date | string | number): [string, string] {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return [
    `${parts.day}-${parts.month}-${parts.year}`,
    `${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`,
  ];
}
