import { ChevronLeft, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { getFieldStudy } from "@/domain/field/queries";
import { STUDY_STATUS_LABELS } from "@/domain/field/types";
import { WORK_TYPE_LABELS, type WorkType } from "@/domain/jobs/types";
import { requirePermission } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

import { LayoutEditor } from "./layout-editor";
import { RoomSize } from "./room-size";
import { LoggerPanel } from "./logger-panel";
import { PhotosPanel } from "./photos-panel";
import { PrecalPanel } from "./precal-panel";
import { TimesPanel } from "./times-panel";

export const metadata = { title: "Study" };

const TABS = [
  { key: "layout", label: "Layout" },
  { key: "loggers", label: "Loggers" },
  { key: "precal", label: "Pre-cal" },
  { key: "times", label: "Times" },
  { key: "photos", label: "Photos" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function StudyPage({ params, searchParams }: PageProps<"/studies/[studyId]">) {
  const actor = await requirePermission("jobs.view");
  const { studyId } = await params;
  const s = await getFieldStudy(db, actor, studyId);
  if (!s) notFound();
  const canWork = can(actor, "field.perform");
  const onSite = ["ready", "field_work", "data_issue"].includes(s.job.status);
  const layoutOpen = ["created", "ready", "field_work", "data_issue"].includes(s.job.status);
  const done = s.status === "completed";

  const placed = s.positions.filter((p) => p.instrumentId).length;
  // Open where the work is: positions first, then loggers, then the times.
  const suggested: Tab =
    s.positions.length === 0
      ? "layout"
      : placed < s.positions.length && !done
        ? "loggers"
        : "times";
  const asked = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === asked) ? (asked as Tab) : suggested;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href="/studies"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        My studies
      </Link>
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

      {!onSite ? (
        <p className="rounded-md bg-attention-soft px-3 py-2 text-sm text-attention">
          {s.job.status === "created"
            ? "The job isn't ready for field work yet: the layout can be prepared, but loggers and times wait until it is Ready."
            : "This job is past field work: the study can be viewed, not changed."}
        </p>
      ) : null}

      <nav aria-label="Study steps" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {TABS.map((t) => {
          const count =
            t.key === "layout"
              ? s.positions.length
              : t.key === "loggers"
                ? `${placed}/${s.positions.length}`
                : t.key === "photos"
                  ? s.photos.length
                  : t.key === "precal"
                    ? s.precal.length
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
          <RoomSize
            studyId={studyId}
            dims={s.equipment.dims}
            readOnly={!canWork || !layoutOpen || done}
          />
          <LayoutEditor
            key={studyId}
            studyId={studyId}
            dims={s.equipment.dims}
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
          />
        </div>
      ) : tab === "loggers" ? (
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
      ) : tab === "precal" ? (
        <PrecalPanel
          studyId={studyId}
          readOnly={!canWork || !onSite || done}
          needed={s.precalNeeded}
          masters={s.masters.map((m) => ({ id: m.id, code: m.code }))}
          rows={s.precal}
        />
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
      ) : (
        <PhotosPanel
          studyId={studyId}
          readOnly={!canWork || !onSite}
          positions={s.positions.map((p) => p.label)}
          photos={s.photos}
        />
      )}

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
