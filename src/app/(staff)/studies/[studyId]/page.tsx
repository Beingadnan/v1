import { ChevronLeft, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import type { SessionUser } from "@/domain/auth/session-service";
import { can } from "@/domain/auth/permissions";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import { getStudyData } from "@/domain/data/queries";
import { getStudyReport } from "@/domain/reports/queries";
import { getFieldStudy } from "@/domain/field/queries";
import { STUDY_STATUS_LABELS } from "@/domain/field/types";
import { WORK_TYPE_LABELS, type WorkType } from "@/domain/jobs/types";
import { sketchReader } from "@/lib/ai";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

import { AnalysisPanel } from "./analysis-panel";
import { ReportPanel } from "./report-panel";
import { DataPanel } from "./data-panel";
import { LayoutEditor } from "./layout-editor";
import { ShowActiveTab } from "./show-active-tab";
import { LoggerPanel } from "./logger-panel";
import { PrecalPanel } from "./precal-panel";
import { TimesPanel } from "./times-panel";

export const metadata = { title: "Study" };

const TABS = [
  { key: "layout", label: "Layout" },
  { key: "precal", label: "Pre-cal" },
  { key: "times", label: "Times" },
  { key: "data", label: "Data" },
  { key: "postcal", label: "Post-cal" },
  { key: "analysis", label: "Analysis" },
  { key: "report", label: "Report" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** What the Data, Analysis, Post-cal and Report tabs read beyond the study itself. */
async function tabData(actor: SessionUser, studyId: string, tab: Tab) {
  const [data, analysis, report] = await Promise.all([
    tab === "data" ? getStudyData(db, actor, studyId) : null,
    tab === "analysis" || tab === "postcal" ? getStudyAnalysis(db, actor, studyId) : null,
    tab === "report" ? getStudyReport(db, actor, studyId) : null,
  ]);
  return { data, analysis, report };
}

export default async function StudyPage({ params, searchParams }: PageProps<"/studies/[studyId]">) {
  const actor = await requirePermission("jobs.view");
  const [{ studyId }, { tab: asked }] = await Promise.all([params, searchParams]);
  // The tab's own data is read alongside the study when the link names the tab (every tab
  // click does), instead of after it: one wait instead of two on a distant database.
  const named = TABS.some((t) => t.key === asked) ? (asked as Tab) : null;
  const [s, early] = await Promise.all([
    getFieldStudy(db, actor, studyId),
    named ? tabData(actor, studyId, named) : Promise.resolve(null),
  ]);
  if (!s) notFound();
  const canWork = can(actor, "field.perform");
  const onSite = ["ready", "field_work", "data_issue"].includes(s.job.status);
  const layoutOpen = ["created", "ready", "field_work", "data_issue"].includes(s.job.status);
  const done = s.status === "completed";

  const placed = s.positions.filter((p) => p.instrumentId).length;
  // Pre- and post-cal only when the study has them (QA Tech chooses per study).
  const tabs = TABS.filter(
    (t) => (t.key !== "precal" || s.precalNeeded) && (t.key !== "postcal" || s.postcalNeeded),
  );
  // Open where the work is: positions and their loggers first, then the times.
  const suggested: Tab =
    s.positions.length === 0
      ? "layout"
      : placed < s.positions.length && !done
        ? "layout"
        : done
          ? s.study.analysisApprovedAt
            ? "report"
            : s.study.dataStatus === "received"
              ? "analysis"
              : "data"
          : "times";
  const tab: Tab = named && tabs.some((t) => t.key === named) ? named : suggested;
  const { data, analysis, report } = early ?? (await tabData(actor, studyId, tab));
  const preRows = s.precal.filter((r) => r.phase === "pre");
  const overrideProps = {
    overrides: s.overrides,
    me: actor.id,
    canAsk:
      can(actor, "field.perform") || can(actor, "postcal.record") || can(actor, "analysis.approve"),
    canDecide: can(actor, "analysis.approve"),
  };
  const postRows = s.precal.filter((r) => r.phase === "post");
  const postOpen = [
    "field_work",
    "data_issue",
    "data_received",
    "analysis",
    "report_draft",
    "rework",
  ].includes(s.job.status);
  const DATA_MARK: Record<string, string> = {
    none: "—",
    issues: "!",
    checked: "?",
    received: "✓",
  };

  return (
    <div
      className={cn("mx-auto flex flex-col gap-4", tab === "report" ? "max-w-6xl" : "max-w-3xl")}
    >
      {can(actor, "data.import") ? (
        <Link
          href="/studies"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          My studies
        </Link>
      ) : (
        <Link
          href={`/jobs/${s.job.id}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Job {s.job.number}
        </Link>
      )}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">
            {s.equipment.code}{" "}
            <span className="font-normal text-muted-foreground">{s.equipment.name}</span>
          </h1>
          <StatusBadge tone={done ? "pass" : s.status === "in_progress" ? "info" : "neutral"}>
            {STUDY_STATUS_LABELS[s.status]}
          </StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          {s.companyName} · {s.siteName}
          {s.equipment.department ? ` · ${s.equipment.department}` : ""} ·{" "}
          <Link href={`/jobs/${s.job.id}`} className="text-primary hover:underline">
            {s.job.number}
          </Link>
        </p>
        <p className="text-sm text-muted-foreground">
          {WORK_TYPE_LABELS[s.study.workType as WorkType] ?? s.study.workType} ·{" "}
          {s.study.loggerCount} loggers
          {s.study.durationHours ? ` · ${s.study.durationHours} h` : ""}
          {s.study.intervalMinutes ? ` · every ${s.study.intervalMinutes} min` : ""}
        </p>
        <p className="font-mono text-xs break-all text-muted-foreground">{s.study.reportNumber}</p>
      </header>

      {!onSite && !["data", "postcal", "analysis", "report"].includes(tab) ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          {s.job.status === "created"
            ? "The job isn't ready for field work yet: the layout can be prepared, but loggers and times wait until it is Ready."
            : "Field work on this job is closed: layout, loggers and times can be viewed, not changed."}
        </p>
      ) : null}

      <ShowActiveTab />
      <nav aria-label="Study steps" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {tabs.map((t) => {
          const count =
            t.key === "layout"
              ? // Positions with a logger, of all positions.
                `${placed}/${s.positions.length}`
              : t.key === "data"
                ? (DATA_MARK[s.study.dataStatus] ?? "")
                : t.key === "precal"
                  ? preRows.length
                  : t.key === "postcal"
                    ? `${new Set(postRows.map((r) => r.instrumentId)).size}/${placed}`
                    : t.key === "analysis"
                      ? s.study.analysisApprovedAt
                        ? "✓"
                        : ""
                      : t.key === "report"
                        ? ""
                        : `${s.cycles.filter((c) => c.done).length}/${s.cycles.length}`;
          return (
            <Link
              key={t.key}
              href={`/studies/${studyId}?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm",
                tab === t.key ? "bg-primary text-primary-foreground" : "bg-surface-muted",
              )}
            >
              {t.label}
              <span
                className={cn("text-xs", tab === t.key ? "opacity-80" : "text-muted-foreground")}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {tab === "layout" ? (
        <div className="flex flex-col gap-4">
          <LayoutEditor
            key={studyId}
            studyId={studyId}
            dims={{ ...s.equipment.dims, shape: s.study.roomShape }}
            loggerCount={s.study.loggerCount}
            readOnly={!canWork || !layoutOpen || done}
            initial={s.positions.map((p) => ({
              label: p.label,
              x: p.x,
              y: p.y,
              z: p.z,
              note: p.note,
              ambient: p.ambient,
              placed: !!p.instrumentId,
            }))}
            previous={s.positions.length === 0 ? s.previousLayout : null}
            room={s.equipment.type === "room"}
            initialFeatures={s.study.planFeatures}
            canReadSketch={sketchReader !== null}
          />
          {s.positions.length > 0 ? (
            <section id="loggers" aria-labelledby="loggers-h" className="flex flex-col gap-3">
              <h2 id="loggers-h" className="font-semibold">
                Logger at each position
              </h2>
              <LoggerPanel
                studyId={studyId}
                readOnly={!canWork || !onSite || done}
                spare={s.spare}
                positions={s.positions.map((p) => ({
                  id: p.id,
                  label: p.label,
                  note: p.note,
                  ambient: p.ambient,
                  instrumentId: p.instrumentId,
                  code: p.code,
                  serialNo: p.serialNo,
                  due: p.certificate?.validUntil ?? null,
                }))}
              />
            </section>
          ) : null}
        </div>
      ) : tab === "precal" ? (
        <PrecalPanel
          studyId={studyId}
          readOnly={!canWork || !onSite || done}
          needed={s.precalNeeded}
          masters={s.masters.map((m) => ({ id: m.id, code: m.code }))}
          rows={preRows}
          {...overrideProps}
        />
      ) : tab === "postcal" ? (
        analysis ? (
          <PrecalPanel
            studyId={studyId}
            phase="post"
            readOnly={!analysis.can.postCal || !postOpen || !done}
            needed={analysis.study.postCalRequired}
            masters={analysis.masters.map((m) => ({ id: m.id, code: m.code }))}
            rows={postRows}
            {...overrideProps}
            waiting={analysis.postCal
              .filter((p) => p.readings.length === 0)
              .map((p) => ({ code: p.code, label: p.label }))}
          />
        ) : null
      ) : tab === "analysis" ? (
        analysis ? (
          <AnalysisPanel a={analysis} />
        ) : null
      ) : tab === "report" ? (
        report ? (
          <ReportPanel r={report} />
        ) : null
      ) : tab === "times" ? (
        <TimesPanel
          studyId={studyId}
          readOnly={!canWork || !onSite}
          canStart={s.positions.length > 0 && placed === s.positions.length}
          durationHours={s.study.durationHours}
          cycles={s.cycles}
          thermal={s.study.workType === "thermal_validation"}
          plannedStart={s.job.plannedStart}
          plannedEnd={s.job.plannedEnd}
        />
      ) : tab === "data" ? (
        data ? (
          <DataPanel data={data} />
        ) : null
      ) : null}

      <a
        href={`/studies/${studyId}/ft12`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-border px-4 text-sm hover:border-primary"
      >
        <FileText className="size-4" aria-hidden="true" />
        Sensor location sheet (FT-12)
      </a>
    </div>
  );
}
