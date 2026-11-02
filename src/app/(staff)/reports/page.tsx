import { FileText } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { listReports } from "@/domain/reports/queries";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/domain/reports/types";
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

/** In the order the work flows: what waits on QA Tech first, then what waits on the client. */
const GROUPS: { key: string; title: string; statuses: ReportStatus[] }[] = [
  { key: "to-check", title: "Waiting for a check (Checked By)", statuses: ["checking"] },
  { key: "to-release", title: "Checked, to release to the client", statuses: ["checked"] },
  { key: "returned", title: "Returned by the client", statuses: ["returned"] },
  { key: "drafts", title: "Being drafted", statuses: ["draft"] },
  { key: "with-client", title: "With the client", statuses: ["released", "reviewed"] },
  { key: "signed", title: "Signed", statuses: ["signed"] },
];

const TONES: Record<ReportStatus, "pass" | "info" | "neutral" | "attention" | "fail"> = {
  draft: "info",
  checking: "attention",
  checked: "attention",
  released: "info",
  reviewed: "info",
  signed: "pass",
  returned: "fail",
  superseded: "neutral",
};

/** Reports to start (analysis approved), then every revision in work, grouped by who it waits on. */
export default async function ReportsPage() {
  const actor = await requirePermission("jobs.view");
  const { toStart, reports } = await listReports(db, actor);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Mapping reports (FT-09) from draft to the client's signature. Open one to edit, check, release or record its sign-off."
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
      {GROUPS.map((g) => {
        const list = reports.filter((r) => g.statuses.includes(r.status));
        if (list.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={g.key} className="flex flex-col gap-2">
            <h2 id={g.key} className="text-sm font-semibold text-muted-foreground">
              {g.title} ({list.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/studies/${r.studyId}?tab=report`}
                    className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-3 hover:border-primary"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <strong>{r.code}</strong>
                      <StatusBadge tone={TONES[r.status]}>
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
        );
      })}
    </div>
  );
}
