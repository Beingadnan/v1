import {
  ArrowUp,
  Building2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Folder,
  FolderOpen,
  MapPin,
  Refrigerator,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/domain/reports/types";
import { JOB_STATUS_LABELS, WORK_TYPE_LABELS, type JobStatus } from "@/domain/jobs/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { statusTone } from "../../jobs/display";

/**
 * Where the client page is (ADR 0023). Each site holds its signed reports by
 * year (year → month → department → equipment → reports), its equipment list
 * (→ department → equipment) and the studies in progress.
 */
export type Place = {
  site?: string;
  year?: string;
  month?: string;
  /** The department inside a month of reports ("none" for equipment in none). */
  adept?: string;
  eq?: string;
  /** The equipment list, and a department in it. */
  equipment?: boolean;
  dept?: string;
  open?: boolean;
};

export function placeHref(companyId: string, p: Place): string {
  const q = new URLSearchParams();
  for (const k of ["site", "year", "month", "adept", "eq"] as const) {
    if (p[k]) q.set(k, p[k]!);
  }
  if (p.equipment || p.dept) q.set("view", "equipment");
  if (p.dept) q.set("dept", p.dept);
  if (p.open) q.set("open", "1");
  const s = q.toString();
  return `/clients/${companyId}${s ? `?${s}` : ""}`;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type TreeSite = {
  id: string;
  name: string;
  active: boolean;
  equipment: number;
  overdue: number;
  departments: { id: string; name: string; active: boolean; equipment: number; overdue: number }[];
  /** Signed reports by year, newest first, with their months. */
  years: { year: string; months: string[] }[];
  /** Studies not yet signed. */
  open: number;
};

/** The three kinds of folder, each with its own look so they're never mixed up. */
export type FolderKind = "reports" | "equipment" | "progress";
const KIND: Record<FolderKind, { icon: typeof Folder; tone: string }> = {
  reports: { icon: Folder, tone: "fill-amber-300 text-amber-500" },
  equipment: { icon: ClipboardList, tone: "text-sky-600" },
  progress: { icon: Clock, tone: "text-orange-500" },
};

function FolderIcon({
  open,
  kind = "reports",
  className,
}: {
  open?: boolean;
  kind?: FolderKind;
  className?: string;
}) {
  const Icon = kind === "reports" && open ? FolderOpen : KIND[kind].icon;
  return (
    <Icon
      className={cn("shrink-0", KIND[kind].tone, className)}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );
}

function OverdueDot({ n }: { n: number }) {
  return n > 0 ? (
    <span
      className="size-1.5 shrink-0 rounded-full bg-fail"
      title={`${n} overdue`}
      aria-label={`${n} overdue`}
    />
  ) : null;
}

/**
 * The navigation pane, as in Windows Explorer: the client, its sites, and in
 * each site its report years (with months), its equipment list (with
 * departments) and what is in progress. Only the open path is unfolded.
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
  const row = (here: boolean, inactive = false) =>
    cn(
      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-primary/10",
      here && "bg-primary/15 font-semibold",
      inactive && "text-muted-foreground",
    );
  const caret = (open: boolean, show = true) => (
    <ChevronRight
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground",
        open && "rotate-90",
        !show && "invisible",
      )}
      aria-hidden="true"
    />
  );
  const nest = "ml-4 flex flex-col gap-px border-l border-border/70 pl-1.5";
  const onEquipment = !!place.equipment || !!place.dept;
  return (
    <nav aria-label="Client folders" className="flex flex-col gap-px text-sm">
      <Link
        href={placeHref(companyId, {})}
        className={row(!place.site)}
        aria-current={!place.site ? "page" : undefined}
      >
        <Building2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate">{companyName}</span>
      </Link>
      <div className={nest}>
        {sites.map((s) => {
          const onSite = place.site === s.id;
          const siteHere = onSite && !place.year && !onEquipment && !place.open;
          return (
            <div key={s.id} className="flex flex-col gap-px">
              <Link
                href={placeHref(companyId, { site: s.id })}
                className={row(siteHere, !s.active)}
                aria-current={siteHere ? "page" : undefined}
              >
                {caret(onSite)}
                <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{s.name}</span>
                <OverdueDot n={s.overdue} />
              </Link>
              {onSite ? (
                <div className={nest}>
                  {s.years.map((y) => {
                    const yearOpen = place.year === y.year;
                    return (
                      <div key={y.year} className="flex flex-col gap-px">
                        <Link
                          href={placeHref(companyId, { site: s.id, year: y.year })}
                          className={row(yearOpen && !place.month)}
                          aria-current={yearOpen && !place.month ? "page" : undefined}
                        >
                          {caret(yearOpen)}
                          <FolderIcon open={yearOpen} className="size-4" />
                          <span className="tabular">{y.year}</span>
                        </Link>
                        {yearOpen ? (
                          <div className={nest}>
                            {y.months.map((m) => {
                              const here = place.month === m;
                              return (
                                <Link
                                  key={m}
                                  href={placeHref(companyId, {
                                    site: s.id,
                                    year: y.year,
                                    month: m,
                                  })}
                                  className={row(here && !place.adept)}
                                  aria-current={here && !place.adept ? "page" : undefined}
                                >
                                  {caret(false, false)}
                                  <FolderIcon open={here} className="size-4" />
                                  {MONTH_NAMES[Number(m) - 1]}
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <Link
                    href={placeHref(companyId, { site: s.id, equipment: true })}
                    className={row(onEquipment && !place.dept)}
                    aria-current={onEquipment && !place.dept ? "page" : undefined}
                  >
                    {caret(onEquipment, s.departments.length > 0)}
                    <FolderIcon kind="equipment" className="size-4" />
                    <span className="truncate">Equipment</span>
                    <span className="tabular ml-auto text-xs text-muted-foreground">
                      {s.equipment}
                    </span>
                  </Link>
                  {onEquipment && s.departments.length ? (
                    <div className={nest}>
                      {s.departments.map((d) => (
                        <Link
                          key={d.id}
                          href={placeHref(companyId, { site: s.id, dept: d.id })}
                          className={row(place.dept === d.id, !d.active)}
                          aria-current={place.dept === d.id ? "page" : undefined}
                        >
                          {caret(false, false)}
                          <span className="truncate">{d.name}</span>
                          <OverdueDot n={d.overdue} />
                          <span className="tabular ml-auto text-xs text-muted-foreground">
                            {d.equipment}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {s.open ? (
                    <Link
                      href={placeHref(companyId, { site: s.id, open: true })}
                      className={row(!!place.open)}
                      aria-current={place.open ? "page" : undefined}
                    >
                      {caret(false, false)}
                      <FolderIcon kind="progress" className="size-4" />
                      <span className="truncate">In progress</span>
                      <span className="tabular ml-auto text-xs text-muted-foreground">
                        {s.open}
                      </span>
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/** "Clients › Watson › Seawoods › Stores › 2026", each part a link up. */
export function Trail({ parts }: { parts: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {parts.map((p, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            {p.href ? (
              <Link
                href={p.href}
                className="truncate rounded px-1 hover:bg-primary/10 hover:text-primary"
              >
                {p.label}
              </Link>
            ) : (
              <span className="truncate px-1 font-medium text-foreground" aria-current="page">
                {p.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * One window, as Windows Explorer: Up and the address bar on top, the folder
 * tree on the left, what's in this folder on the right, a count at the bottom.
 */
export function ExplorerWindow({
  up,
  trail,
  tree,
  status,
  children,
}: {
  up?: string;
  trail: { label: string; href?: string }[];
  tree: ReactNode;
  status: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Client folders and files"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-2 py-1.5">
        {up ? (
          <Link
            href={up}
            className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-primary/10"
            aria-label="Up one folder"
            title="Up one folder"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground/40">
            <ArrowUp className="size-4" aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-border bg-surface px-2 py-1">
          <FolderIcon open className="size-4" />
          <Trail parts={trail} />
        </div>
      </div>
      <div className="grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-border p-2 md:max-h-[34rem] md:overflow-y-auto md:border-r md:border-b-0">
          {tree}
        </aside>
        <div className="min-h-64 min-w-0 p-3">{children}</div>
      </div>
      <div className="border-t border-border bg-surface-muted px-3 py-1 text-xs text-muted-foreground">
        {status}
      </div>
    </section>
  );
}

/** A folder in the right pane: big yellow icon, name, what's in it. */
export function FolderTile({
  href,
  title,
  facts,
  overdue = 0,
  inactive,
  kind = "reports",
}: {
  href: string;
  title: string;
  facts: string[];
  overdue?: number;
  inactive?: boolean;
  kind?: FolderKind;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col items-center gap-1 rounded-md border border-transparent p-3 text-center hover:border-primary/30 hover:bg-primary/10 focus-visible:border-primary",
        inactive && "opacity-60",
      )}
    >
      <span className="relative">
        <FolderIcon kind={kind} className="size-14" />
        {overdue > 0 ? (
          <span className="absolute -top-0.5 -right-1 rounded-full bg-fail px-1.5 text-[10px] font-semibold text-white">
            {overdue}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-2 text-sm font-medium break-words group-hover:text-primary">
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{facts.join(" · ")}</span>
      {overdue > 0 ? <span className="sr-only">{overdue} overdue</span> : null}
    </Link>
  );
}

export function FolderGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1">{children}</div>
  );
}

/** Files in a folder, in Details view: name with its icon, then columns. */
export function DetailsList({
  columns,
  rows,
}: {
  columns: string[];
  rows: {
    key: string;
    icon: "equipment" | "report";
    name: ReactNode;
    cells: ReactNode[];
    muted?: boolean;
  }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const Icon = r.icon === "equipment" ? Refrigerator : FileText;
            return (
              <tr
                key={r.key}
                className={cn(
                  "border-b border-border/60 hover:bg-primary/5",
                  r.muted && "text-muted-foreground",
                )}
              >
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        r.icon === "equipment" ? "text-sky-600" : "text-rose-600",
                      )}
                      aria-hidden="true"
                    />
                    {r.name}
                  </span>
                </td>
                {r.cells.map((c, i) => (
                  <td key={i} className="px-2 py-1.5 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

/** One year's studies as files: the report, its equipment, the work, when, and the job. */
export function StudyFiles({
  rows,
  equipmentCode,
}: {
  rows: StudyRow[];
  equipmentCode: Map<string, string>;
}) {
  return (
    <DetailsList
      columns={["Report", "Equipment", "Work", "Date", "Job"]}
      rows={rows.map((s) => ({
        key: s.id,
        icon: "report" as const,
        name: (
          <span>
            <Link
              href={`/studies/${s.id}?tab=report`}
              className="font-medium text-primary hover:underline"
            >
              {s.reportNumber}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {s.reportStatus
                ? `Rev ${String(s.reportRev ?? 0).padStart(2, "0")} · ${
                    REPORT_STATUS_LABELS[s.reportStatus as ReportStatus] ?? s.reportStatus
                  }`
                : "No report yet"}
            </span>
          </span>
        ),
        cells: [
          <span key="e" className="whitespace-nowrap">
            {equipmentCode.get(s.equipmentId) ?? "—"}
          </span>,
          s.workType in WORK_TYPE_LABELS
            ? WORK_TYPE_LABELS[s.workType as keyof typeof WORK_TYPE_LABELS]
            : s.workType,
          <span key="d" className="tabular whitespace-nowrap">
            {formatDate(s.start)}
          </span>,
          <span key="j" className="flex flex-col items-start gap-0.5">
            <Link href={`/jobs/${s.jobId}`} className="text-primary hover:underline">
              {s.jobNumber}
            </Link>
            <StatusBadge tone={statusTone(s.jobStatus as JobStatus)}>
              {JOB_STATUS_LABELS[s.jobStatus as JobStatus] ?? s.jobStatus}
            </StatusBadge>
          </span>,
        ],
      }))}
    />
  );
}

/** A signed report as a file: its number and revision, the work, when it was signed, the job. */
export function ReportFiles({
  rows,
}: {
  rows: {
    studyId: string;
    reportId: string;
    reportNumber: string;
    rev: number;
    workType: string;
    signedOn: string;
    signedVia: string | null;
    jobId: string;
    jobNumber: string;
  }[];
}) {
  return (
    <DetailsList
      columns={["Report", "Work", "Signed", "Job", ""]}
      rows={rows.map((r) => ({
        key: r.reportId,
        icon: "report" as const,
        name: (
          <span>
            <Link
              href={`/studies/${r.studyId}?tab=report`}
              className="font-medium text-primary hover:underline"
            >
              {r.reportNumber}
            </Link>
            <span className="block text-xs text-muted-foreground">
              Rev {String(r.rev).padStart(2, "0")}
            </span>
          </span>
        ),
        cells: [
          r.workType in WORK_TYPE_LABELS
            ? WORK_TYPE_LABELS[r.workType as keyof typeof WORK_TYPE_LABELS]
            : r.workType,
          <span key="s" className="tabular whitespace-nowrap">
            {formatDate(r.signedOn)}
            {r.signedVia === "paper" ? " (paper)" : ""}
          </span>,
          <Link key="j" href={`/jobs/${r.jobId}`} className="text-primary hover:underline">
            {r.jobNumber}
          </Link>,
          <a
            key="p"
            href={`/studies/${r.studyId}/report/${r.reportId}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            PDF
          </a>,
        ],
      }))}
    />
  );
}
