import { Briefcase, Plus, Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { listJobs, type JobListRow } from "@/domain/jobs/queries";
import {
  BOARD_COLUMNS,
  boardStatus,
  JOB_STATUS_LABELS,
  ORDER_TYPE_SHORT,
  type OrderType,
} from "@/domain/jobs/types";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

import { dateRange, rupees, statusTone } from "./display";

export const metadata = { title: "Jobs" };

const SCOPES = [
  { key: "open", label: "Open" },
  { key: "finished", label: "Closed & cancelled" },
  { key: "all", label: "All" },
] as const;

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const actor = await requirePermission("jobs.view");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const scope = SCOPES.some((s) => s.key === params.scope) ? (params.scope as string) : "open";
  const mine = params.mine === "1";
  const orderPending = params.order === "pending";
  const sort = params.sort === "start" ? "start" : "newest";
  // Field roles mostly want their own jobs as a list; planners want the board.
  const view =
    params.view === "list" || params.view === "board"
      ? params.view
      : q || orderPending
        ? "list"
        : "board";
  const rows = await listJobs(db, actor, { q, scope, mine, orderPending, sort });
  const canManage = can(actor, "jobs.manage");
  const money = can(actor, "jobs.money");

  const link = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = {
      q: q || undefined,
      scope: scope === "open" ? undefined : scope,
      mine: mine ? "1" : undefined,
      order: orderPending ? "pending" : undefined,
      sort: sort === "start" ? "start" : undefined,
      view,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return `/jobs${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Every job from enquiry to payment. Find one by job number, PO, client, equipment ID or report number."
        action={
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <Button asChild>
                <Link href="/jobs/new">
                  <Plus aria-hidden="true" />
                  New job
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show" className="flex flex-wrap gap-1">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={link({ scope: s.key === "open" ? undefined : s.key })}
              aria-current={scope === s.key ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                scope === s.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary",
              )}
            >
              {s.label}
            </Link>
          ))}
          <Link
            href={link({ mine: mine ? undefined : "1" })}
            aria-current={mine ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              mine
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary",
            )}
          >
            My jobs
          </Link>
          <Link
            href={link({ order: orderPending ? undefined : "pending" })}
            aria-current={orderPending ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              orderPending
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary",
            )}
          >
            Order pending
          </Link>
        </nav>
        <nav aria-label="Order" className="flex gap-1 text-sm">
          {(
            [
              ["newest", "Newest first"],
              ["start", "By start date"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={link({ sort: key === "start" ? "start" : undefined })}
              aria-current={sort === key ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1",
                sort === key
                  ? "bg-surface-muted font-medium"
                  : "text-muted-foreground hover:text-primary",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <nav aria-label="View" className="flex gap-1 text-sm">
          {(["board", "list"] as const).map((v) => (
            <Link
              key={v}
              href={link({ view: v })}
              aria-current={view === v ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1",
                view === v
                  ? "bg-surface-muted font-medium"
                  : "text-muted-foreground hover:text-primary",
              )}
            >
              {v === "board" ? "Board" : "List"}
            </Link>
          ))}
        </nav>
        <form role="search" className="flex w-full max-w-md gap-2 sm:w-auto sm:flex-1">
          {scope !== "open" ? <input type="hidden" name="scope" value={scope} /> : null}
          {mine ? <input type="hidden" name="mine" value="1" /> : null}
          {orderPending ? <input type="hidden" name="order" value="pending" /> : null}
          {sort === "start" ? <input type="hidden" name="sort" value="start" /> : null}
          <label htmlFor="q" className="sr-only">
            Search jobs
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Job no., PO, client, equipment, report no."
          />
          <Button type="submit" variant="secondary">
            <Search aria-hidden="true" />
            Search
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={q ? `No job matches “${q}”` : "No jobs yet"}
          description={
            q
              ? "Search looks at the job number, PO number, client, site, equipment ID or name, and report number."
              : canManage
                ? "Create a job from New job, or from the Clients › Requalification due list."
                : "Jobs appear here once a team leader creates them."
          }
        />
      ) : view === "board" ? (
        <Board rows={rows} />
      ) : (
        <JobTable rows={rows} money={money} />
      )}
    </div>
  );
}

function JobCard({ row }: { row: JobListRow }) {
  return (
    <li>
      <Link
        href={`/jobs/${row.id}`}
        className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm hover:border-primary"
      >
        <span className="flex items-center justify-between gap-2">
          <strong className="font-mono text-xs">{row.number}</strong>
          {row.status === "data_issue" ||
          row.status === "rework" ||
          row.status === "on_hold" ||
          row.status === "data_received" ? (
            <StatusBadge tone={statusTone(row.status)}>{JOB_STATUS_LABELS[row.status]}</StatusBadge>
          ) : null}
        </span>
        <span className="font-medium">{row.companyName}</span>
        <span className="text-xs text-muted-foreground">
          {row.siteName} · {dateRange(row.plannedStart, row.plannedEnd)}
        </span>
        <span className="truncate text-xs" title={row.equipmentCodes.join(", ")}>
          {row.equipmentCodes.slice(0, 4).join(", ")}
          {row.equipmentCodes.length > 4 ? ` +${row.equipmentCodes.length - 4}` : ""}
        </span>
        {row.team.length > 0 ? (
          <span className="text-xs text-muted-foreground">{row.team.join(", ")}</span>
        ) : null}
        {row.status === "field_work" || row.studiesDone > 0 ? (
          <span className="text-xs font-medium text-info">
            {row.studiesDone} of {row.studyCount} studies done
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function Board({ rows }: { rows: JobListRow[] }) {
  const columns = BOARD_COLUMNS.map((c) => ({
    ...c,
    rows: rows.filter((r) => c.statuses.includes(boardStatus(r.status, r.heldFrom))),
  }));
  const finished = rows.filter((r) => r.status === "closed" || r.status === "cancelled");
  return (
    <div className="flex flex-col gap-4">
      <div
        className="-mx-4 overflow-x-auto px-4 pb-2"
        tabIndex={0}
        aria-label="Job board, scrolls sideways"
      >
        <div className="flex min-w-max gap-3">
          {columns.map((c) => (
            <section
              key={c.key}
              aria-labelledby={`col-${c.key}`}
              className="flex w-64 shrink-0 flex-col gap-2"
            >
              <h2
                id={`col-${c.key}`}
                className="flex items-baseline justify-between text-sm font-semibold"
              >
                {c.label}
                <span className="text-xs font-normal text-muted-foreground">{c.rows.length}</span>
              </h2>
              <ul className="flex min-h-16 flex-col gap-2 rounded-lg bg-surface-muted p-2">
                {c.rows.map((r) => (
                  <JobCard key={r.id} row={r} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      {finished.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {finished.length} closed or cancelled job{finished.length === 1 ? "" : "s"} are in the
          list view.
        </p>
      ) : null}
    </div>
  );
}

function JobTable({ rows, money }: { rows: JobListRow[]; money: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Equipment</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Status</TableHead>
          {money ? <TableHead className="text-right">PO value</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link
                href={`/jobs/${r.id}`}
                className="font-mono text-xs font-medium text-primary hover:underline"
              >
                {r.number}
              </Link>
              {r.orderPending && r.status !== "cancelled" ? (
                <p className="text-xs text-attention">
                  {ORDER_TYPE_SHORT[r.orderType as OrderType]} pending
                </p>
              ) : r.poNumber ? (
                <p className="text-xs text-muted-foreground">
                  {ORDER_TYPE_SHORT[r.orderType as OrderType]} {r.poNumber}
                </p>
              ) : null}
            </TableCell>
            <TableCell>
              {r.companyName}
              <p className="text-xs text-muted-foreground">{r.siteName}</p>
            </TableCell>
            <TableCell className="max-w-56">
              <span className="line-clamp-2 text-sm" title={r.equipmentCodes.join(", ")}>
                {r.equipmentCodes.join(", ")}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {dateRange(r.plannedStart, r.plannedEnd)}
            </TableCell>
            <TableCell>
              <StatusBadge tone={statusTone(r.status)}>{JOB_STATUS_LABELS[r.status]}</StatusBadge>
            </TableCell>
            {money ? <TableCell className="text-right">{rupees(r.poValue)}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
