import type { StatusTone } from "@/components/ui/status-badge";
import type { JobStatus } from "@/domain/jobs/types";

export function statusTone(status: JobStatus): StatusTone {
  switch (status) {
    case "ready":
    case "data_received":
    case "checked":
    case "client_signed":
    case "wcr_signed":
    case "paid":
    case "closed":
      return "pass";
    case "data_issue":
    case "rework":
    case "on_hold":
      return "attention";
    case "cancelled":
      return "fail";
    case "created":
      return "neutral";
    default:
      return "info";
  }
}

/** "12-10-2026": a job's start or end date as QA Tech reads it on the board (Nov 2026). */
export function dashDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/** "12-10-2026 to 19-10-2026", or one day "12-10-2026". */
export function dateRange(start: string, end: string): string {
  return start === end ? dashDate(start) : `${dashDate(start)} to ${dashDate(end)}`;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const rupees = (value: string | number | null) =>
  value === null || value === "" ? "" : `₹${inr.format(Number(value))}`;
