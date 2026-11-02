import { ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { listReports } from "@/domain/reports/queries";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/domain/reports/types";
import { requirePermission } from "@/lib/auth/dal";

export const metadata = { title: "Reviews" };

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

/** The checker's queue: reports to sign Checked By, to release, and what came back from clients. */
export default async function ReviewsPage() {
  const actor = await requirePermission("reports.check");
  const { reports } = await listReports(db, actor);
  const groups: { key: string; title: string; hint: string; statuses: ReportStatus[] }[] = [
    {
      key: "check",
      title: "To check",
      hint: "Sign Checked By, or return it with comments.",
      statuses: ["checking"],
    },
    {
      key: "release",
      title: "To release",
      hint: "Checked. Release it to the client, or record their paper sign-off.",
      statuses: ["checked"],
    },
    {
      key: "returned",
      title: "Returned by the client",
      hint: "The preparer starts a new revision that answers the comments.",
      statuses: ["returned"],
    },
  ];
  const any = reports.some((r) => groups.some((g) => g.statuses.includes(r.status)));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="QA Tech's check before a report goes to the client: no one checks a report they prepared."
      />
      {!any ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing to review"
          description="Reports appear here when a preparer signs Done By."
        />
      ) : null}
      {groups.map((g) => {
        const list = reports.filter((r) => g.statuses.includes(r.status));
        if (list.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={g.key} className="flex flex-col gap-2">
            <div>
              <h2 id={g.key} className="text-sm font-semibold">
                {g.title} ({list.length})
              </h2>
              <p className="text-xs text-muted-foreground">{g.hint}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {list.map((r) => {
                const mine = r.status === "checking" && r.frozenBy === actor.id;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/studies/${r.studyId}?tab=report`}
                      className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-3 hover:border-primary"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <strong>{r.code}</strong>
                        <StatusBadge tone={mine ? "neutral" : "attention"}>
                          {r.label} · {REPORT_STATUS_LABELS[r.status]}
                        </StatusBadge>
                        <span className="text-xs text-muted-foreground">{when(r.at)}</span>
                        {mine ? (
                          <span className="text-xs text-muted-foreground">
                            you prepared it: another checker signs
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm">
                        {r.name} · {r.company} · {r.jobNumber}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
