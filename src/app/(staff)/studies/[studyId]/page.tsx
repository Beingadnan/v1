import { Check, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import type { SessionUser } from "@/domain/auth/session-service";
import { can } from "@/domain/auth/permissions";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import { getStudyData } from "@/domain/data/queries";
import { getStudyReport, latestReportStatus } from "@/domain/reports/queries";
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
import { ConfirmData } from "./confirm-data";
import { StudyPeriod } from "./study-period";
import { TimesPanel } from "./times-panel";

export const metadata = { title: "Study" };

/**
 * The study's steps, in the order QA Tech does them; each is a tab. The data
 * comes before Start & end (Nov 2026): the report's period is chosen from it.
 */
const TABS = [
  { key: "layout", label: "Positions" },
  { key: "loggers", label: "Loggers" },
  { key: "precal", label: "Pre-cal" },
  { key: "data", label: "Data" },
  { key: "times", label: "Start & end" },
  { key: "postcal", label: "Post-cal" },
  { key: "analysis", label: "Analysis" },
  { key: "report", label: "Report" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** What the Data, Analysis, Post-cal and Report tabs read beyond the study itself. */
async function tabData(actor: SessionUser, studyId: string, tab: Tab) {
  const [data, analysis, report] = await Promise.all([
    tab === "data" || tab === "times" ? getStudyData(db, actor, studyId) : null,
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
  const [s, early, reportStatus] = await Promise.all([
    getFieldStudy(db, actor, studyId),
    named ? tabData(actor, studyId, named) : Promise.resolve(null),
    latestReportStatus(db, actor, studyId),
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
  const preDone = new Set(preRows.map((r) => r.instrumentId)).size;
  const postDone = new Set(postRows.map((r) => r.instrumentId)).size;
  // What each step has done, and so the first step still to do.
  const doneStep: Record<Tab, boolean> = {
    layout: s.positions.length > 0,
    loggers: s.positions.length > 0 && placed === s.positions.length,
    precal: placed > 0 && preDone >= placed,
    // Uploaded with nothing wrong left; Start & end is done once the period is chosen and
    // the data confirmed for it.
    data: s.study.dataStatus === "checked" || s.study.dataStatus === "received",
    times:
      s.cycles.length > 0 && s.cycles.every((c) => c.done) && s.study.dataStatus === "received",
    postcal: placed > 0 && postDone >= placed,
    analysis: !!s.study.analysisApprovedAt,
    report: [
      "checked",
      "sent_to_client",
      "client_signed",
      "wcr_signed",
      "invoiced",
      "paid",
      "closed",
    ].includes(s.job.status),
  };
  // A checked or signed report ends the study: nothing earlier is left to do.
  const current: Tab = doneStep.report
    ? "report"
    : (tabs.find((t) => !doneStep[t.key])?.key ?? "report");
  const tab: Tab = named && tabs.some((t) => t.key === named) ? named : current;
  const { data, analysis, report } = early ?? (await tabData(actor, studyId, tab));
  const stepLabel = (k: Tab) => TABS.find((t) => t.key === k)!.label;
  // The uploaded data's first and last reading, for choosing the report's period.
  const live = data?.files.filter((f) => !f.replaced && f.first && f.last) ?? [];
  const span = live.length
    ? {
        from: Math.min(...live.map((f) => new Date(f.first!).getTime())),
        to: Math.max(...live.map((f) => new Date(f.last!).getTime())),
      }
    : null;
  const periodOpen = ["ready", "field_work", "data_issue", "data_received"].includes(s.job.status);

  // The one thing to do now, in plain words.
  const waitingForJob =
    s.job.status === "created" && ["loggers", "precal", "data", "times"].includes(current);
  const NEXT: Record<Tab, { title: string; text: string }> = {
    layout: {
      title: "Lay out the positions",
      text: "Read the engineer's sketch, start from the template, or add positions on the drawing. Then save.",
    },
    loggers: {
      title: "Put a logger at each position",
      text: `Scan or type each logger's ID. ${placed} of ${s.positions.length} placed.`,
    },
    precal: {
      title: "Record the pre-calibration",
      text: `Compare each logger with the master before the study starts. ${preDone} of ${placed} done.`,
    },
    data: {
      title: s.study.dataStatus === "issues" ? "Fix the data problems" : "Upload the logger data",
      text:
        s.study.dataStatus === "issues"
          ? "The uploaded data has gaps or errors: accept each with a reason, or upload again."
          : "Upload the loggers' export. Next you choose, from that data, the start and end the report covers.",
    },
    times: {
      title: "Choose the report's start and end",
      text: "Pick from the uploaded data the hours the report covers, e.g. 12-11-2026 12:00 AM for 24 h. Then confirm the data.",
    },
    postcal: {
      title: "Record the post-calibration",
      text: `Compare each logger with the master after the study. ${postDone} of ${placed} done.`,
    },
    analysis: {
      title: "Check and approve the analysis",
      text: "Review the results against the limits, then approve them for the report.",
    },
    report: doneStep.report
      ? {
          title: "Study complete",
          text: "The report is checked. It goes to the client from the job.",
        }
      : reportStatus === "checking"
        ? {
            title: "Check the report",
            text: "A team leader or manager who didn't prepare it signs it for QA Tech, or returns it with comments.",
          }
        : reportStatus === "returned"
          ? {
              title: "Revise the report",
              text: "The client sent it back: answer their comments in a new revision.",
            }
          : {
              title: "Prepare the report",
              text: "Draft the report, then send it for checking.",
            },
  };
  const next = waitingForJob
    ? {
        title: "Waiting for the job to be ready",
        text: "Loggers can be placed once the job has its gate pass and booked loggers.",
      }
    : NEXT[current];

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
          Studies
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold">
            {s.equipment.code}{" "}
            <span className="font-normal text-muted-foreground">{s.equipment.name}</span>{" "}
            <StatusBadge tone={done ? "pass" : s.status === "in_progress" ? "info" : "neutral"}>
              {STUDY_STATUS_LABELS[s.status]}
            </StatusBadge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {WORK_TYPE_LABELS[s.study.workType as WorkType] ?? s.study.workType} ·{" "}
            {s.study.loggerCount} loggers
            {s.study.durationHours ? ` · ${s.study.durationHours} h` : ""} · {s.companyName},{" "}
            {s.siteName} ·{" "}
            <Link href={`/jobs/${s.job.id}`} className="text-primary hover:underline">
              {s.job.number}
            </Link>
          </p>
        </div>
        <a
          href={`/studies/${studyId}/ft12`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:border-primary"
        >
          <FileText className="size-4" aria-hidden="true" />
          Sensor location sheet (FT-12)
        </a>
      </header>

      <ShowActiveTab />
      <nav aria-label="Study steps" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        {tabs.map((t, i) => {
          const isDone = doneStep[t.key];
          const isCurrent = t.key === current && !(t.key === "report" && doneStep.report);
          return (
            <Link
              key={t.key}
              href={`/studies/${studyId}?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm",
                tab === t.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : isCurrent
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-primary",
              )}
            >
              {isDone ? (
                <Check
                  className={cn("size-3.5", tab === t.key ? "" : "text-pass")}
                  aria-hidden="true"
                />
              ) : (
                <span className="text-xs" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              {t.label}
              {isDone ? <span className="sr-only"> (done)</span> : null}
              {t.key === "data" && s.study.dataStatus === "issues" ? (
                <span className="size-2 rounded-full bg-fail" aria-label="problems" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <section
        aria-labelledby="next"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-primary/40 bg-surface p-4"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">
            What to do now
          </p>
          <h2 id="next" className="text-lg font-semibold">
            {next.title}
          </h2>
          <p className="text-sm text-muted-foreground">{next.text}</p>
        </div>
        {waitingForJob ? (
          <Link
            href={`/jobs/${s.job.id}`}
            className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Open the job
          </Link>
        ) : tab !== current ? (
          <Link
            href={`/studies/${studyId}?tab=${current}`}
            className="inline-flex min-h-10 items-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Go to {stepLabel(current)}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </section>

      {!onSite && ["layout", "loggers", "precal"].includes(tab) && !waitingForJob ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          {s.job.status === "created"
            ? "Positions can be prepared now; loggers and times wait until the job is Ready."
            : "Field work on this job is closed: this step can be viewed, not changed."}
        </p>
      ) : null}

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
        </div>
      ) : tab === "loggers" ? (
        s.positions.length > 0 ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">Lay out the positions first.</p>
        )
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
        <div className="flex flex-col gap-4">
          {span && data ? (
            <>
              <StudyPeriod
                studyId={studyId}
                periods={data.periods}
                dataFrom={span.from}
                dataTo={span.to}
                durationHours={s.study.durationHours}
                canSet={data.can.accept && periodOpen}
              />
              {data.can.accept && data.study.dataStatus === "checked" && periodOpen ? (
                <ConfirmData
                  studyId={studyId}
                  jobNumber={s.job.number}
                  periodSet={data.periods.every((p) => p.fromData && p.start && p.end)}
                />
              ) : data.study.dataStatus === "issues" ? (
                <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
                  The data has problems for this period:{" "}
                  <Link href={`/studies/${studyId}?tab=data`} className="underline">
                    resolve them in Data
                  </Link>
                  , then confirm it here.
                </p>
              ) : data.study.dataStatus === "received" ? (
                <p className="text-sm text-pass">
                  Data confirmed for this period by {data.study.receivedBy}.
                </p>
              ) : null}
            </>
          ) : (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Upload the logger data first: the report&apos;s start and end are chosen from it.{" "}
              <Link href={`/studies/${studyId}?tab=data`} className="text-primary underline">
                Go to Data
              </Link>
            </p>
          )}
          <details
            className="rounded-lg border border-border bg-surface p-3"
            open={!span && onSite}
          >
            <summary className="cursor-pointer text-sm font-semibold">
              Site log: start, end, door and power taps on site (optional)
            </summary>
            <div className="mt-3">
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
            </div>
          </details>
        </div>
      ) : tab === "data" ? (
        data ? (
          <DataPanel data={data} />
        ) : null
      ) : null}
    </div>
  );
}
