import { FileSignature } from "lucide-react";
import { eq } from "drizzle-orm";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { clientCompanies } from "@/db/schema";
import { can } from "@/domain/auth/permissions";
import { clientDeviations } from "@/domain/analysis/client-deviations";
import { clientWcrs } from "@/domain/billing/queries";
import { listClientReports, type ClientReportRow } from "@/domain/reports/client-queries";
import type { ReportStatus } from "@/domain/reports/types";
import { requireUser } from "@/lib/auth/dal";

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

const CLIENT_LABELS: Record<ReportStatus, [string, StatusTone]> = {
  draft: ["Draft", "neutral"],
  checking: ["With QA Tech", "neutral"],
  checked: ["With QA Tech", "neutral"],
  released: ["To review", "attention"],
  reviewed: ["Reviewed, to approve", "attention"],
  signed: ["Signed", "pass"],
  returned: ["Returned to QA Tech", "info"],
  superseded: ["Superseded", "neutral"],
};

function List({ rows }: { rows: ClientReportRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const [label, tone] = CLIENT_LABELS[r.status];
        return (
          <li key={r.id}>
            <Link
              href={`/client/reports/${r.id}`}
              className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-3 hover:border-primary"
            >
              <span className="flex flex-wrap items-center gap-2">
                <strong>{r.code}</strong>
                <StatusBadge tone={tone}>
                  {r.label} · {label}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {r.signedAt ? `signed ${when(r.signedAt)}` : `released ${when(r.releasedAt)}`}
                </span>
              </span>
              <span className="text-sm">
                {r.name}
                {r.site ? ` · ${r.site}` : ""}
              </span>
              <span className="font-mono text-xs break-all text-muted-foreground">
                {r.reportNumber}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The client's home: reports to review or approve, deviations to decide, and the signed archive. */
export default async function ClientHomePage() {
  const user = await requireUser();
  // Everything on the page goes out together: each read is limited to the person's company.
  const [[company], rows, deviations, wcrs] = await Promise.all([
    user.clientCompanyId
      ? db
          .select({ name: clientCompanies.name })
          .from(clientCompanies)
          .where(eq(clientCompanies.id, user.clientCompanyId))
      : Promise.resolve([]),
    listClientReports(db, user),
    can(user, "deviation.client_decide") ? clientDeviations(db, user) : Promise.resolve([]),
    clientWcrs(db, user),
  ]);
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const head = can(user, "reports.client_approve");
  const wcrTodo = wcrs.filter((w) => w.canAccept);
  const todo = rows.filter(
    (r) => r.status === "released" || (r.status === "reviewed" && head && !r.reviewedByMe),
  );
  const waiting = rows.filter(
    (r) => (r.status === "reviewed" && !todo.includes(r)) || r.status === "returned",
  );
  const signed = rows.filter((r) => r.status === "signed");
  const older = rows.filter((r) => r.status === "superseded");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`Hello, ${firstName}`}
        description={company ? `Reports from QA Tech for ${company.name}.` : undefined}
      />
      {deviations.length > 0 ? (
        <section aria-labelledby="deviations" className="flex flex-col gap-2">
          <h2 id="deviations" className="text-sm font-semibold text-muted-foreground">
            Deviations for your decision ({deviations.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {deviations.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/client/deviations/${d.id}`}
                  className="flex flex-col gap-0.5 rounded-lg border border-attention bg-surface p-3 hover:border-primary"
                >
                  <strong>
                    {d.number} · {d.code}
                  </strong>
                  <span className="text-sm">{d.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {wcrTodo.length > 0 ? (
        <section aria-labelledby="wcr" className="flex flex-col gap-2">
          <h2 id="wcr" className="text-sm font-semibold text-muted-foreground">
            Work completion reports to accept ({wcrTodo.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {wcrTodo.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/client/wcr/${w.id}`}
                  className="flex flex-col gap-0.5 rounded-lg border border-attention bg-surface p-3 hover:border-primary"
                >
                  <strong>{w.number}</strong>
                  <span className="text-sm">Issued {when(w.issuedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No reports to review yet"
          description="When QA Tech releases a report to you, it appears here for review and signature."
        />
      ) : null}
      {todo.length > 0 ? (
        <section aria-labelledby="todo" className="flex flex-col gap-2">
          <h2 id="todo" className="text-sm font-semibold text-muted-foreground">
            For your signature ({todo.length})
          </h2>
          <List rows={todo} />
        </section>
      ) : null}
      {waiting.length > 0 ? (
        <section aria-labelledby="waiting" className="flex flex-col gap-2">
          <h2 id="waiting" className="text-sm font-semibold text-muted-foreground">
            Waiting on others ({waiting.length})
          </h2>
          <List rows={waiting} />
        </section>
      ) : null}
      {signed.length > 0 ? (
        <section aria-labelledby="signed" className="flex flex-col gap-2">
          <h2 id="signed" className="text-sm font-semibold text-muted-foreground">
            Signed reports ({signed.length})
          </h2>
          <List rows={signed} />
        </section>
      ) : null}
      {older.length > 0 ? (
        <section aria-labelledby="older" className="flex flex-col gap-2">
          <h2 id="older" className="text-sm font-semibold text-muted-foreground">
            Earlier revisions ({older.length})
          </h2>
          <List rows={older} />
        </section>
      ) : null}
    </div>
  );
}
