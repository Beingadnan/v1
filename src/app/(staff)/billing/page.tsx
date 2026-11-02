import { ReceiptIndianRupee } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { billingOverview } from "@/domain/billing/queries";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "Billing" };

const inr = (v: number) =>
  `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => iso.split("-").reverse().join(".");

function Row({
  href,
  children,
  alert,
}: {
  href: string;
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex flex-col gap-0.5 rounded-lg border bg-surface p-3 hover:border-primary",
          alert ? "border-fail" : "border-border",
        )}
      >
        {children}
      </Link>
    </li>
  );
}

/**
 * Accounts' page: WCRs to issue and to chase, invoices due (GST Rule 47's 30
 * days from the WCR), open invoices with what is left and how late, and what
 * cleared in the last 30 days.
 */
export default async function BillingPage() {
  const actor = await requirePermission("jobs.money");
  const o = await billingOverview(db, actor);
  const empty =
    !o.wcrToIssue.length &&
    !o.wcrWaiting.length &&
    !o.invoiceDue.length &&
    !o.open.length &&
    !o.cleared.length;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Billing"
        description="From the work completion report to the money in the bank. Invoices are raised in Tally and recorded here."
      />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Outstanding</dt>
          <dd className="text-lg font-semibold">{inr(o.totals.outstanding)}</dd>
        </div>
        <div
          className={cn(
            "rounded-lg border bg-surface p-3",
            o.totals.overdue ? "border-fail" : "border-border",
          )}
        >
          <dt className="text-xs text-muted-foreground">Overdue ({o.totals.overdueCount})</dt>
          <dd className={cn("text-lg font-semibold", o.totals.overdue ? "text-fail" : "")}>
            {inr(o.totals.overdue)}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Invoice due</dt>
          <dd className="text-lg font-semibold">{o.invoiceDue.length}</dd>
        </div>
      </dl>
      {o.msme && o.totals.overdueCount ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          QA Tech is registered under Udyam: clients must pay within 45 days (MSMED Act s.15), and
          can only claim a late payment as an expense when they pay it (Income-tax Act s.43B(h)).
        </p>
      ) : null}
      {empty ? (
        <EmptyState
          icon={ReceiptIndianRupee}
          title="Nothing to bill yet"
          description="Jobs appear here once every report is with the client and the WCR can be issued."
        />
      ) : null}

      {o.invoiceDue.length ? (
        <section aria-labelledby="due" className="flex flex-col gap-2">
          <h2 id="due" className="text-sm font-semibold">
            Invoice due ({o.invoiceDue.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {o.invoiceDue.map((j) => (
              <Row key={j.jobId} href={`/jobs/${j.jobId}#money`} alert={j.days > o.invoiceWithin}>
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{j.number}</strong>
                  <StatusBadge tone={j.days > o.invoiceWithin - 5 ? "attention" : "info"}>
                    WCR signed {j.days} day{j.days === 1 ? "" : "s"} ago
                  </StatusBadge>
                </span>
                <span className="text-sm">
                  {j.company} · WCR signed {dmy(j.wcrSignedOn)} · invoice within {o.invoiceWithin}{" "}
                  days (GST Rule 47)
                </span>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {o.open.length ? (
        <section aria-labelledby="open" className="flex flex-col gap-2">
          <h2 id="open" className="text-sm font-semibold">
            Open invoices ({o.open.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {o.open.map((v) => (
              <Row key={v.id} href={`/jobs/${v.jobId}#money`} alert={v.overdueDays > 0}>
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{v.number}</strong>
                  <StatusBadge tone={v.overdueDays > 0 ? "fail" : "info"}>
                    {v.overdueDays > 0 ? `${v.overdueDays} days overdue` : `due ${dmy(v.due)}`}
                  </StatusBadge>
                  <span className="text-sm font-medium">{inr(v.balance)} left</span>
                </span>
                <span className="text-sm">
                  {v.company} · {v.jobNumber} · {dmy(v.invoiceDate)} · {inr(v.total)} · {v.days}{" "}
                  days since the invoice
                </span>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {o.wcrWaiting.length ? (
        <section aria-labelledby="wcr-waiting" className="flex flex-col gap-2">
          <h2 id="wcr-waiting" className="text-sm font-semibold">
            WCR with the client ({o.wcrWaiting.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {o.wcrWaiting.map((j) => (
              <Row key={j.jobId} href={`/jobs/${j.jobId}#money`}>
                <strong>{j.number}</strong>
                <span className="text-sm">
                  {j.company} · issued {j.days} day{j.days === 1 ? "" : "s"} ago
                </span>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {o.wcrToIssue.length ? (
        <section aria-labelledby="wcr-issue" className="flex flex-col gap-2">
          <h2 id="wcr-issue" className="text-sm font-semibold">
            WCR to issue ({o.wcrToIssue.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {o.wcrToIssue.map((j) => (
              <Row key={j.jobId} href={`/jobs/${j.jobId}#money`}>
                <strong>{j.number}</strong>
                <span className="text-sm">{j.company} · every report is with the client</span>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {o.cleared.length ? (
        <section aria-labelledby="cleared" className="flex flex-col gap-2">
          <h2 id="cleared" className="text-sm font-semibold text-muted-foreground">
            Cleared in the last 30 days ({o.cleared.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {o.cleared.map((v) => (
              <Row key={v.id} href={`/jobs/${v.jobId}#money`}>
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{v.number}</strong>
                  <StatusBadge tone="pass">Cleared</StatusBadge>
                </span>
                <span className="text-sm">
                  {v.company} · {v.jobNumber} · {inr(v.total)}
                  {v.tds ? ` · TDS ${inr(v.tds)}` : ""}
                </span>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
