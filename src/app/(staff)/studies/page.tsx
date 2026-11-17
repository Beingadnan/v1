import { ChevronRight, ThermometerSnowflake } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { nextStep, STAGE_LABELS, type NextStep, type StudyStage } from "@/domain/field/next-step";
import { myStudies, type MyStudy } from "@/domain/field/queries";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "Studies" };

const dmy = (iso: string) => iso.split("-").reverse().join(".");

const STAGES = ["site", "data", "postcal", "analysis", "done"] as const;

const BUTTON: Record<NextStep["tone"], string> = {
  attention: "border-attention/50 bg-attention-soft text-attention",
  fail: "border-fail/50 bg-fail-soft text-fail",
  info: "border-primary/40 bg-primary/10 text-primary",
  neutral: "border-border bg-surface text-foreground",
  pass: "border-transparent text-muted-foreground",
};

type Row = MyStudy & { next: NextStep };

/**
 * The studies list (QA Tech, Nov 2026): one compact line per study, grouped
 * by job, each with the one thing to do next as its button.
 */
export default async function StudiesPage({ searchParams }: PageProps<"/studies">) {
  const actor = await requirePermission("data.import");
  const params = await searchParams;
  const everyone = params.all === "1" && can(actor, "jobs.manage");
  const stage = STAGES.find((s) => s === params.stage);
  const all: Row[] = (await myStudies(db, actor, { everyone })).map((r) => ({
    ...r,
    next: nextStep(r),
  }));
  const count = (s: StudyStage) => all.filter((r) => r.next.stage === s).length;
  const open = all.filter((r) => r.next.stage !== "done");
  const shown = stage ? all.filter((r) => r.next.stage === stage) : open;

  // By job, today's first, then by date.
  const jobs = new Map<string, Row[]>();
  for (const r of [...shown].sort(
    (a, b) => Number(b.today) - Number(a.today) || a.plannedStart.localeCompare(b.plannedStart),
  )) {
    jobs.set(r.jobId, [...(jobs.get(r.jobId) ?? []), r]);
  }

  const href = (next: { stage?: StudyStage; all?: boolean }) => {
    const q = new URLSearchParams();
    if (next.all) q.set("all", "1");
    if (next.stage) q.set("stage", next.stage);
    const s = q.toString();
    return `/studies${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-surface hover:border-primary",
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        title="Studies"
        description={
          everyone
            ? "Every team's studies, by job. The button on each says what to do next."
            : "The studies you're on, by job. The button on each says what to do next."
        }
        action={
          can(actor, "jobs.manage") ? (
            <nav
              aria-label="Whose"
              className="flex rounded-full border border-border p-0.5 text-sm"
            >
              {[
                [false, "Mine"],
                [true, "Everyone's"],
              ].map(([v, l]) => (
                <Link
                  key={String(v)}
                  href={href({ stage, all: v as boolean })}
                  aria-current={v === everyone ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1",
                    v === everyone
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l as string}
                </Link>
              ))}
            </nav>
          ) : undefined
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon={ThermometerSnowflake}
          title="No studies for you"
          description="Studies appear here when you are on the team of a job that is Ready, in field work, or waiting for data."
        />
      ) : (
        <>
          <nav aria-label="Stage" className="flex flex-wrap gap-2">
            <Link
              href={href({ all: everyone })}
              aria-current={!stage ? "page" : undefined}
              className={chip(!stage)}
            >
              To do <span className="tabular opacity-80">{open.length}</span>
            </Link>
            {STAGES.map((s) =>
              count(s) ? (
                <Link
                  key={s}
                  href={href({ stage: s, all: everyone })}
                  aria-current={stage === s ? "page" : undefined}
                  className={chip(stage === s)}
                >
                  {STAGE_LABELS[s]} <span className="tabular opacity-80">{count(s)}</span>
                </Link>
              ) : null,
            )}
          </nav>

          {jobs.size === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing here.{" "}
              {stage ? (
                <Link href={href({ all: everyone })} className="text-primary hover:underline">
                  Show what&apos;s to do
                </Link>
              ) : (
                "Every study is done."
              )}
            </p>
          ) : (
            [...jobs.values()].map((rows) => <JobGroup key={rows[0]!.jobId} rows={rows} />)
          )}
        </>
      )}
    </div>
  );
}

function JobGroup({ rows }: { rows: Row[] }) {
  const job = rows[0]!;
  return (
    <section
      aria-label={`Job ${job.jobNumber}`}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-muted/60 px-4 py-2 text-sm">
        <Link href={`/jobs/${job.jobId}`} className="font-semibold hover:underline">
          {job.jobNumber}
        </Link>
        <span className="min-w-0 truncate text-muted-foreground">
          {job.companyName} · {job.siteName}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {job.today ? (
            <span className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground">
              Today
            </span>
          ) : null}
          <span className="tabular">
            {dmy(job.plannedStart)}
            {job.plannedEnd !== job.plannedStart ? ` – ${dmy(job.plannedEnd)}` : ""}
          </span>
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/studies/${r.id}?tab=${r.next.tab}`}
              className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 hover:bg-surface-muted/60"
            >
              <span className="flex min-w-0 flex-1 basis-56 flex-col">
                <span className="truncate text-sm">
                  <span className="font-semibold">{r.equipmentCode}</span>{" "}
                  <span className="text-muted-foreground">{r.equipmentName}</span>
                </span>
                {r.department || r.next.detail ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {[r.department, r.next.detail ? `Asked for: ${r.next.detail}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
              {r.next.stage === "site" && r.positions > 0 ? (
                <span
                  className="flex w-28 items-center gap-2 text-xs text-muted-foreground"
                  title={`${r.placed} of ${r.positions} loggers placed`}
                >
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.round((100 * r.placed) / r.positions)}%` }}
                    />
                  </span>
                  <span className="tabular">
                    {r.placed}/{r.positions}
                  </span>
                </span>
              ) : null}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium",
                  BUTTON[r.next.tone],
                )}
              >
                {r.next.label}
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
  );
}
