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

const short = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return { y, m, d };
};

/** "02–05.11.2026", "28.11–02.12.2026" or one day "02.11.2026". */
export function dateRange(start: string, end: string): string {
  const a = short(start);
  const b = short(end);
  if (start === end) return `${b.d}.${b.m}.${b.y}`;
  if (a.y !== b.y) return `${a.d}.${a.m}.${a.y}–${b.d}.${b.m}.${b.y}`;
  if (a.m !== b.m) return `${a.d}.${a.m}–${b.d}.${b.m}.${b.y}`;
  return `${a.d}–${b.d}.${b.m}.${b.y}`;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const rupees = (value: string | number | null) =>
  value === null || value === "" ? "" : `₹${inr.format(Number(value))}`;
