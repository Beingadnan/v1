import { Building2, ChevronRight, Folder, FolderOpen, MapPin } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/domain/reports/types";
import { JOB_STATUS_LABELS, WORK_TYPE_LABELS, type JobStatus } from "@/domain/jobs/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { statusTone } from "../../jobs/display";

/** Where the client page is: the company, a site, a department, a year in it. */
export type Place = { site?: string; dept?: string; year?: string };

export function placeHref(companyId: string, p: Place): string {
  const q = new URLSearchParams();
  if (p.site) q.set("site", p.site);
  if (p.dept) q.set("dept", p.dept);
  if (p.year) q.set("year", p.year);
  const s = q.toString();
  return `/clients/${companyId}${s ? `?${s}` : ""}`;
}

export type TreeSite = {
  id: string;
  name: string;
  active: boolean;
  equipment: number;
  overdue: number;
  departments: {
    id: string;
    name: string;
    active: boolean;
    equipment: number;
    overdue: number;
    years: string[];
  }[];
};

function Count({ n, overdue }: { n: number; overdue: number }) {
  return (
    <span className="tabular ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      {overdue > 0 ? (
        <span
          className="size-1.5 rounded-full bg-fail"
          title={`${overdue} overdue`}
          aria-label={`${overdue} overdue`}
        />
      ) : null}
      {n}
    </span>
  );
}

/**
 * The client's folders, as QA Tech keeps them: company → site (region) →
 * department → year. Plain links, so every level has its own address.
 */
export function ClientTree({
  companyId,
  companyName,
  sites,
  place,
}: {
  companyId: string;
  companyName: string;
  sites: TreeSite[];
  place: Place;
}) {
  const row = (active: boolean) =>
    cn(
      "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
      active ? "bg-primary/10 font-semibold text-primary" : "text-foreground",
    );
  const total = sites.reduce((n, s) => n + s.equipment, 0);
  const overdue = sites.reduce((n, s) => n + s.overdue, 0);
  return (
    <nav aria-label="Client folders" className="flex flex-col gap-0.5 text-sm">
      <Link
        href={placeHref(companyId, {})}
        className={row(!place.site)}
        aria-current={!place.site ? "page" : undefined}
      >
        <Building2 className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{companyName}</span>
        <Count n={total} overdue={overdue} />
      </Link>
      <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
        {sites.map((s) => {
          const open = place.site === s.id;
          return (
            <li key={s.id}>
              <Link
                href={placeHref(companyId, { site: s.id })}
                className={cn(row(open && !place.dept), !s.active && "text-muted-foreground")}
                aria-current={open && !place.dept ? "page" : undefined}
              >
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{s.name}</span>
                <Count n={s.equipment} overdue={s.overdue} />
              </Link>
              {open && s.departments.length > 0 ? (
                <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                  {s.departments.map((d) => {
                    const here = place.dept === d.id;
                    const Icon = here ? FolderOpen : Folder;
                    return (
                      <li key={d.id}>
                        <Link
                          href={placeHref(companyId, { site: s.id, dept: d.id })}
                          className={cn(
                            row(here && !place.year),
                            !d.active && "text-muted-foreground",
                          )}
                          aria-current={here && !place.year ? "page" : undefined}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{d.name}</span>
                          <Count n={d.equipment} overdue={d.overdue} />
                        </Link>
                        {here && d.years.length > 0 ? (
                          <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                            {d.years.map((y) => (
                              <li key={y}>
                                <Link
                                  href={placeHref(companyId, { site: s.id, dept: d.id, year: y })}
                                  className={row(place.year === y)}
                                  aria-current={place.year === y ? "page" : undefined}
                                >
                                  <span className="tabular">{y}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Clients › Watson › Seawoods › Stores › 2026", each part a link up. */
export function Trail({ parts }: { parts: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {parts.map((p, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5" aria-hidden="true" /> : null}
            {p.href ? (
              <Link href={p.href} className="hover:text-primary">
                {p.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground" aria-current="page">
                {p.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A folder below this one: a site or a department, with what's in it. */
export function FolderCard({
  href,
  icon: Icon,
  title,
  subtitle,
  facts,
  overdue,
  inactive,
}: {
  href: string;
  icon: typeof Folder;
  title: string;
  subtitle?: string;
  facts: string[];
  overdue: number;
  inactive?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary",
        inactive && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold group-hover:text-primary">{title}</p>
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"
          aria-hidden="true"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {facts.map((f) => (
          <span key={f}>{f}</span>
        ))}
        {overdue > 0 ? <StatusBadge tone="fail">{overdue} overdue</StatusBadge> : null}
        {inactive ? <StatusBadge tone="neutral">Inactive</StatusBadge> : null}
      </div>
    </Link>
  );
}

export type StudyRow = {
  id: string;
  equipmentId: string;
  workType: string;
  reportNumber: string;
  jobId: string;
  jobNumber: string;
  jobStatus: string;
  start: string;
  reportStatus: string | null;
  reportRev: number | null;
};

/** One year's studies: when, which job, which equipment, and where the report is. */
export function StudyTable({
  rows,
  equipmentCode,
}: {
  rows: StudyRow[];
  equipmentCode: Map<string, string>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Equipment</TableHead>
          <TableHead>Work</TableHead>
          <TableHead>Report</TableHead>
          <TableHead>Job</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="tabular whitespace-nowrap">{formatDate(s.start)}</TableCell>
            <TableCell className="font-medium whitespace-nowrap">
              {equipmentCode.get(s.equipmentId) ?? "—"}
            </TableCell>
            <TableCell>
              {s.workType in WORK_TYPE_LABELS
                ? WORK_TYPE_LABELS[s.workType as keyof typeof WORK_TYPE_LABELS]
                : s.workType}
            </TableCell>
            <TableCell>
              <Link href={`/studies/${s.id}?tab=report`} className="text-primary hover:underline">
                {s.reportNumber}
              </Link>
              <p className="text-xs text-muted-foreground">
                {s.reportStatus
                  ? `Rev ${String(s.reportRev ?? 0).padStart(2, "0")} · ${
                      REPORT_STATUS_LABELS[s.reportStatus as ReportStatus] ?? s.reportStatus
                    }`
                  : "No report yet"}
              </p>
            </TableCell>
            <TableCell>
              <Link href={`/jobs/${s.jobId}`} className="text-primary hover:underline">
                {s.jobNumber}
              </Link>
              <div>
                <StatusBadge tone={statusTone(s.jobStatus as JobStatus)}>
                  {JOB_STATUS_LABELS[s.jobStatus as JobStatus] ?? s.jobStatus}
                </StatusBadge>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
