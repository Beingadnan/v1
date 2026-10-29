import { StatusBadge } from "@/components/ui/status-badge";
import { dueStatus, todayInIndia } from "@/domain/clients/requalification";
import { formatDate } from "@/lib/format";

/** Next study date with a status colour: overdue (red), within 30 days (amber). */
export function DueBadge({ nextDue }: { nextDue: string | null }) {
  const status = dueStatus(nextDue, todayInIndia());
  if (status === "none") return <span className="text-muted-foreground">Not recorded</span>;
  if (status === "overdue") {
    return <StatusBadge tone="fail">Overdue · {formatDate(nextDue)}</StatusBadge>;
  }
  if (status === "due_soon") {
    return <StatusBadge tone="attention">Due {formatDate(nextDue)}</StatusBadge>;
  }
  return <span className="tabular">{formatDate(nextDue)}</span>;
}
