import { ChevronRight, FileText, Search } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { reportStep, type ReportStage, type ReportStep } from "@/domain/reports/next-step";
import { listReports } from "@/domain/reports/queries";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/domain/reports/types";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

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

const STAGES: { key: ReportStage | "all"; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "client", label: "With the client" },
  { key: "signed", label: "Signed" },
  { key: "all", label: "All" },
];

const BUTTON: Record<ReportStep["tone"], string> = {
  attention: "border-attention/50 bg-attention-soft text-attention",
  fail: "border-fail/50 bg-fail-soft text-fail",
  info: "border-primary/40 bg-primary/10 text-primary",
  neutral: "border-border bg-surface text-foreground",
  pass: "border-transparent text-muted-foreground",
};

/** Most urgent first: what the client sent back, then what waits on a check… */
const URGENCY: (ReportStatus | null)[] = [
  "returned",
  "checking",
  "checked",
  null,
  "draft",
  "released",
  "reviewed",
  "signed",
];

type Row = {
  key: string;
  studyId: string;
  companyId: string;
  company: string;
  code: string;
  name: string;
  jobNumber: string;
  reportNumber: string;
  status: ReportStatus | null;
  /** "Rev 00 · Signed", or "Not started". */
  state: string;
  at: Date | null;
  step: ReportStep;
};

/**
 * The reports list (QA Tech, Nov 2026): by client, one line per report, with
 * the one thing to do next as its button; tabs for QA Tech's work, the
 * client's, and what's signed.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const actor = await requirePermission("jobs.view");
  const params = await searchParams;
  const { toStart, reports } = await listReports(db, actor);
  const rows: Row[] = [
    ...toStart.map((r) => ({
      key: `s-${r.studyId}`,
      studyId: r.studyId,
      companyId: r.companyId,
      company: r.company,
      code: r.code,
      name: r.name,
      jobNumber: r.jobNumber,
      reportNumber: r.reportNumber,
      status: null,
      state: "Not started",
      at: r.approvedAt,
      step: reportStep(null),
    })),
    ...reports.map((r) => ({
      key: r.id,
      studyId: r.studyId,
      companyId: r.companyId,
      company: r.company,
      code: r.code,
      name: r.name,
      jobNumber: r.jobNumber,
      reportNumber: r.reportNumber,
      status: r.status,
      state: `${r.label} · ${REPORT_STATUS_LABELS[r.status]}`,
      at: r.at,
      step: reportStep(r.status),
    })),
  ];
  const stage = STAGES.find((s) => s.key === params.stage)?.key ?? "todo";
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const needle = q.toLowerCase();
  const count = (k: ReportStage) => rows.filter((r) => r.step.stage === k).length;
  const shown = rows
    .filter((r) => stage === "all" || r.step.stage === stage)
    .filter(
      (r) =>
        !needle ||
        [r.code, r.name, r.company, r.jobNumber, r.reportNumber].some((t) =>
          t.toLowerCase().includes(needle),
        ),
    )
    .sort(
      (a, b) =>
        URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status) ||
        (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
    );
  // By client, the client with the most urgent report first.
  const clients = new Map<string, Row[]>();
  for (const r of shown) clients.set(r.companyId, [...(clients.get(r.companyId) ?? []), r]);

  const href = (next: { stage?: string; q?: string }) => {
    const sp = new URLSearchParams();
    const st = next.stage ?? stage;
    if (st !== "todo") sp.set("stage", st);
    const qq = next.q ?? q;
    if (qq) sp.set("q", qq);
    const s = sp.toString();
    return `/reports${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        title="Reports"
        description="By client. The button on each says what to do next."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          description="A report can be drafted once a study's analysis is approved."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Stage" className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <Link
                  key={s.key}
                  href={href({ stage: s.key })}
                  aria-current={stage === s.key ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                    stage === s.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface hover:border-primary",
                  )}
                >
                  {s.label}
                  {s.key !== "all" ? (
                    <span className="tabular opacity-80">{count(s.key)}</span>
                  ) : null}
                </Link>
              ))}
            </nav>
            <form action="/reports" className="relative w-full sm:w-64">
              {stage !== "todo" ? <input type="hidden" name="stage" value={stage} /> : null}
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Client, equipment, job…"
                aria-label="Find a report"
                className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
              />
            </form>
          </div>

          {clients.size === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
              {q ? (
                <>
                  Nothing matches &ldquo;{q}&rdquo;.{" "}
                  <Link href={href({ q: "" })} className="text-primary hover:underline">
                    Clear the search
                  </Link>
                </>
              ) : stage === "todo" ? (
                "Nothing to do: every report is with the client or signed."
              ) : (
                "Nothing here."
              )}
            </p>
          ) : (
            [...clients.values()].map((list) => (
              <section
                key={list[0]!.companyId}
                aria-label={list[0]!.company}
                className="overflow-hidden rounded-lg border border-border bg-surface"
              >
                <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-4 py-2 text-sm">
                  <Link
                    href={`/clients/${list[0]!.companyId}`}
                    className="font-semibold hover:underline"
                  >
                    {list[0]!.company}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {list.length} report{list.length === 1 ? "" : "s"}
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {list.map((r) => (
                    <li key={r.key}>
                      <Link
                        href={`/studies/${r.studyId}?tab=report`}
                        className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 hover:bg-surface-muted/60"
                      >
                        <span className="flex min-w-0 flex-1 basis-64 flex-col">
                          <span className="truncate text-sm">
                            <span className="font-semibold">{r.code}</span>{" "}
                            <span className="text-muted-foreground">{r.name}</span>
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {r.jobNumber} · <span className="font-mono">{r.reportNumber}</span>
                          </span>
                        </span>
                        <span className="flex flex-col items-end text-xs text-muted-foreground max-sm:items-start">
                          <span>{r.state}</span>
                          <span className="tabular">{when(r.at)}</span>
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center justify-between gap-1 rounded-md border px-2.5 py-1 text-sm font-medium",
                            r.step.tone === "pass" ? "sm:w-20" : "sm:w-44",
                            BUTTON[r.step.tone],
                          )}
                        >
                          {r.step.label}
                          <ChevronRight
                            className="size-4 transition-transform group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
