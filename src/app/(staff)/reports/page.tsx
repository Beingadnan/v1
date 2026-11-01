import { FileText } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { listReports } from "@/domain/reports/queries";
import { REPORT_STATUS_LABELS } from "@/domain/reports/types";
import { requirePermission } from "@/lib/auth/dal";

export const metadata = { title: "Reports" };

const when = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(d)
    : "";

/** Reports to start (analysis approved) and reports drafted or frozen. */
export default async function ReportsPage() {
  const actor = await requirePermission("jobs.view");
  const { toStart, reports } = await listReports(db, actor);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Mapping reports (FT-09) built from approved analyses. Open one to edit its wording, preview it and freeze a revision."
      />
      {toStart.length === 0 && reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          description="A report can be drafted once a study's analysis is approved."
        />
      ) : null}
      {toStart.length > 0 ? (
        <section aria-labelledby="to-start" className="flex flex-col gap-2">
          <h2 id="to-start" className="text-sm font-semibold text-muted-foreground">
            Analysis approved, report not started ({toStart.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {toStart.map((r) => (
              <li key={r.studyId}>
                <Link
                  href={`/studies/${r.studyId}?tab=report`}
                  className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-3 hover:border-primary"
                >
                  <strong>{r.code}</strong>
                  <span className="text-sm">
                    {r.name} · {r.company} · {r.jobNumber}
                  </span>
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {r.reportNumber}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {reports.length > 0 ? (
        <section aria-labelledby="reports" className="flex flex-col gap-2">
          <h2 id="reports" className="text-sm font-semibold text-muted-foreground">
            Drafted and frozen ({reports.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/studies/${r.studyId}?tab=report`}
                  className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-3 hover:border-primary"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{r.code}</strong>
                    <StatusBadge tone={r.status === "frozen" ? "pass" : "info"}>
                      {r.label} · {REPORT_STATUS_LABELS[r.status]}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">{when(r.at)}</span>
                  </span>
                  <span className="text-sm">
                    {r.name} · {r.company} · {r.jobNumber}
                  </span>
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {r.reportNumber}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
