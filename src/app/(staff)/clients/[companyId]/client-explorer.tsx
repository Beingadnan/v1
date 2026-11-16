import {
  ArrowUp,
  Building2,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
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

/** A folder as Windows draws it: yellow, open when it's the one shown. */
function FolderIcon({ open, className }: { open?: boolean; className?: string }) {
  const Icon = open ? FolderOpen : Folder;
  return (
    <Icon
      className={cn("shrink-0 fill-amber-300 text-amber-500", className)}
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
 * The navigation pane: every folder of the client, opened down to where you
 * are, each openable on its own (▸) without leaving the page, as in Windows
 * Explorer. Plain links, so every folder has its own address.
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
      "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-primary/10",
      here ? "bg-primary/15 font-semibold text-foreground" : "text-foreground",
      inactive && "text-muted-foreground",
    );
  const twisty =
    "flex size-5 shrink-0 cursor-pointer list-none items-center justify-center rounded text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden";
  return (
    <nav aria-label="Client folders" className="flex flex-col text-sm">
      <div className="flex items-center gap-0.5">
        <span className="size-5 shrink-0" />
        <Link
          href={placeHref(companyId, {})}
          className={row(!place.site)}
          aria-current={!place.site ? "page" : undefined}
        >
          <Building2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{companyName}</span>
        </Link>
      </div>
      <ul className="ml-2.5 flex flex-col border-l border-dotted border-border pl-1">
        {sites.map((s) => {
          const onPath = place.site === s.id;
          return (
            <li key={s.id}>
              <details open={onPath} className="group/site">
                <summary className="flex items-center gap-0.5 [&::-webkit-details-marker]:hidden">
                  <span className={twisty} aria-hidden="true">
                    <ChevronRight className="size-3.5 transition-transform group-open/site:rotate-90" />
                  </span>
                  <Link
                    href={placeHref(companyId, { site: s.id })}
                    className={row(onPath && !place.dept, !s.active)}
                    aria-current={onPath && !place.dept ? "page" : undefined}
                  >
                    <HardDrive
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="truncate">{s.name}</span>
                    <OverdueDot n={s.overdue} />
                  </Link>
                </summary>
                <ul className="ml-2.5 flex flex-col border-l border-dotted border-border pl-1">
                  {s.departments.length === 0 ? (
                    <li className="py-1 pl-6 text-xs text-muted-foreground">Empty</li>
                  ) : null}
                  {s.departments.map((d) => {
                    const here = onPath && place.dept === d.id;
                    return (
                      <li key={d.id}>
                        <details open={here} className="group/dept">
                          <summary className="flex items-center gap-0.5 [&::-webkit-details-marker]:hidden">
                            <span
                              className={cn(twisty, d.years.length === 0 && "invisible")}
                              aria-hidden="true"
                            >
                              <ChevronRight className="size-3.5 transition-transform group-open/dept:rotate-90" />
                            </span>
                            <Link
                              href={placeHref(companyId, { site: s.id, dept: d.id })}
                              className={row(here && !place.year, !d.active)}
                              aria-current={here && !place.year ? "page" : undefined}
                            >
                              <FolderIcon open={here} className="size-4" />
                              <span className="truncate">{d.name}</span>
                              <OverdueDot n={d.overdue} />
                            </Link>
                          </summary>
                          <ul className="ml-2.5 flex flex-col border-l border-dotted border-border pl-1">
                            {d.years.map((y) => {
                              const yearHere = here && place.year === y;
                              return (
                                <li key={y} className="flex items-center gap-0.5">
                                  <span className="size-5 shrink-0" />
                                  <Link
                                    href={placeHref(companyId, { site: s.id, dept: d.id, year: y })}
                                    className={row(yearHere)}
                                    aria-current={yearHere ? "page" : undefined}
                                  >
                                    <FolderIcon open={yearHere} className="size-4" />
                                    <span className="tabular">{y}</span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </details>
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
}: {
  href: string;
  title: string;
  facts: string[];
  overdue?: number;
  inactive?: boolean;
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
        <FolderIcon className="size-14" />
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
