import "server-only";

import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { clientCompanies, equipment, jobs, studies, studyReports, users } from "@/db/schema";
import { approvalBlockers } from "@/domain/analysis/analysis-service";
import { assertCan, can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import type { JobStatus } from "@/domain/jobs/types";

import { reportContext } from "./report-data";
import { conclusionText, observationText } from "./templates";
import { revLabel, type ReportStatus } from "./types";

/** Everything the Report tab shows for a study. */
export async function getStudyReport(db: Database, actor: SessionUser, studyId: string) {
  assertCan(actor, "jobs.view");
  if (!isUuid(studyId)) return null;
  const [row] = await db
    .select({
      study: studies,
      jobStatus: jobs.status,
      jobNumber: jobs.number,
      code: equipment.code,
    })
    .from(studies)
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) return null;
  const { study } = row;
  const revisions = await db
    .select({ r: studyReports, by: users.name })
    .from(studyReports)
    .leftJoin(users, eq(users.id, studyReports.createdByUserId))
    .where(eq(studyReports.studyId, study.id))
    .orderBy(desc(studyReports.rev));
  const frozenBy = new Map(
    (
      await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.organisationId, actor.organisationId))
    ).map((u) => [u.id, u.name]),
  );

  // Why a report can't be made yet, in words.
  let blocked: string | null = null;
  if (!study.analysisApprovedAt || !study.analysisRunId) {
    blocked = "The analysis isn't approved yet (Analysis tab).";
  } else {
    const { run, out } = await approvalBlockers(db, actor.organisationId, study);
    if (!run || run.id !== study.analysisRunId)
      blocked = "A newer analysis was run after the approval.";
    else if (out.length) blocked = out.join(" ");
  }

  const draft = revisions.find((x) => x.r.status === "draft")?.r ?? null;
  // Template wording, shown when a section hasn't been edited.
  let template: { observation: string; conclusion: string } | null = null;
  if (draft && !blocked && study.analysisRunId) {
    const ctx = await reportContext(db, actor, study, study.analysisRunId);
    template = {
      observation: observationText(ctx.template),
      conclusion: conclusionText(ctx.template),
    };
  }

  return {
    study: {
      id: study.id,
      code: row.code,
      reportNumber: study.reportNumber,
      jobNumber: row.jobNumber,
      jobStatus: row.jobStatus as JobStatus,
    },
    blocked,
    open: ["analysis", "report_draft", "rework"].includes(row.jobStatus),
    revisions: revisions.map(({ r, by }) => ({
      id: r.id,
      rev: r.rev,
      label: revLabel(r.rev),
      status: r.status as ReportStatus,
      reason: r.reason,
      by,
      createdAt: r.createdAt,
      frozenAt: r.frozenAt,
      frozenBy: r.frozenByUserId ? (frozenBy.get(r.frozenByUserId) ?? null) : null,
      sha256: r.sha256,
      pages: r.pages,
    })),
    draft: draft
      ? {
          id: draft.id,
          rev: draft.rev,
          observation: draft.observation,
          conclusion: draft.conclusion,
        }
      : null,
    template,
    can: { prepare: can(actor, "reports.prepare") },
  };
}

export type StudyReport = NonNullable<Awaited<ReturnType<typeof getStudyReport>>>;

/** The Reports page: every study with a report, and studies whose analysis is approved but not yet reported. */
export async function listReports(db: Database, actor: SessionUser) {
  assertCan(actor, "jobs.view");
  const rows = await db
    .select({
      studyId: studies.id,
      reportNumber: studies.reportNumber,
      code: equipment.code,
      name: equipment.name,
      company: clientCompanies.name,
      jobNumber: jobs.number,
      jobStatus: jobs.status,
      approvedAt: studies.analysisApprovedAt,
    })
    .from(studies)
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .where(
      and(eq(studies.organisationId, actor.organisationId), isNotNull(studies.analysisApprovedAt)),
    )
    .orderBy(desc(studies.analysisApprovedAt))
    .limit(300);
  const withReports = await db
    .select({
      r: studyReports,
      code: equipment.code,
      name: equipment.name,
      company: clientCompanies.name,
      jobNumber: jobs.number,
      reportNumber: studies.reportNumber,
    })
    .from(studyReports)
    .innerJoin(studies, eq(studies.id, studyReports.studyId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .where(
      and(
        eq(studyReports.organisationId, actor.organisationId),
        inArray(studyReports.status, ["draft", "frozen"]),
        // A cancelled job's reports are void: they stay on the study, not in this list.
        ne(jobs.status, "cancelled"),
      ),
    )
    .orderBy(desc(studyReports.createdAt))
    .limit(300);
  const reported = new Set(withReports.map((x) => x.r.studyId));
  return {
    toStart: rows
      .filter((r) => !reported.has(r.studyId) && !["cancelled", "closed"].includes(r.jobStatus))
      .map((r) => ({ ...r, jobStatus: r.jobStatus as JobStatus })),
    reports: withReports.map((x) => ({
      id: x.r.id,
      studyId: x.r.studyId,
      label: revLabel(x.r.rev),
      status: x.r.status as ReportStatus,
      reportNumber: x.reportNumber,
      code: x.code,
      name: x.name,
      company: x.company,
      jobNumber: x.jobNumber,
      at: x.r.frozenAt ?? x.r.createdAt,
    })),
  };
}
