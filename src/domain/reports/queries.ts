import "server-only";

import { and, asc, desc, eq, inArray, sql, isNotNull, ne } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  equipment,
  jobs,
  reportComments,
  reportPaperSignoffs,
  signatures,
  studies,
  studyReports,
  users,
} from "@/db/schema";
import { approvalBlockers } from "@/domain/analysis/analysis-service";
import { assertCan, can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import type { JobStatus } from "@/domain/jobs/types";

import { reportContext } from "./report-data";
import { clientRecipients } from "./review-service";
import { conclusionText, observationText } from "./templates";
import {
  REPORT_SECTION_LABELS,
  revLabel,
  type ReportSection,
  type ReportStatus,
  type SignedVia,
} from "./types";

/** Everything the Report tab shows for a study. */
export async function getStudyReport(db: Database, actor: SessionUser, studyId: string) {
  assertCan(actor, "jobs.view");
  if (!isUuid(studyId)) return null;
  const [row] = await db
    .select({
      study: studies,
      jobStatus: jobs.status,
      jobNumber: jobs.number,
      companyId: jobs.companyId,
      code: equipment.code,
    })
    .from(studies)
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) return null;
  const { study } = row;
  // The study is checked against the organisation above; the rest goes out at once.
  const revisionIds = db
    .select({ id: studyReports.id })
    .from(studyReports)
    .where(eq(studyReports.studyId, study.id));
  const approved = Boolean(study.analysisApprovedAt && study.analysisRunId);
  const [revisions, staff, blockers, sigs, paper, comments, people] = await Promise.all([
    db
      .select({ r: studyReports, by: users.name })
      .from(studyReports)
      .leftJoin(users, eq(users.id, studyReports.createdByUserId))
      .where(eq(studyReports.studyId, study.id))
      .orderBy(desc(studyReports.rev)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, actor.organisationId)),
    approved ? approvalBlockers(db, actor.organisationId, study) : Promise.resolve(null),
    db
      .select()
      .from(signatures)
      .where(
        and(
          eq(signatures.entityType, "report"),
          // signatures.entity_id is text (it points at any kind of record).
          inArray(
            signatures.entityId,
            db
              .select({ id: sql<string>`${studyReports.id}::text` })
              .from(studyReports)
              .where(eq(studyReports.studyId, study.id)),
          ),
        ),
      )
      .orderBy(asc(signatures.signedAt)),
    db.select().from(reportPaperSignoffs).where(inArray(reportPaperSignoffs.reportId, revisionIds)),
    db
      .select({ c: reportComments, by: users.name, rev: studyReports.rev })
      .from(reportComments)
      .innerJoin(users, eq(users.id, reportComments.byUserId))
      .innerJoin(studyReports, eq(studyReports.id, reportComments.reportId))
      .where(eq(reportComments.studyId, study.id))
      .orderBy(asc(reportComments.createdAt)),
    clientRecipients(db, row.companyId),
  ]);
  const frozenBy = new Map(staff.map((u) => [u.id, u.name]));

  // Why a report can't be made yet, in words.
  let blocked: string | null = null;
  if (!blockers) {
    blocked = "The analysis isn't approved yet (Analysis tab).";
  } else {
    const { run, out } = blockers;
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
    me: actor.id,
    recipients: people,
    comments: comments.map(({ c, by, rev }) => ({
      id: c.id,
      rev: revLabel(rev),
      section: c.section as ReportSection,
      sectionLabel: REPORT_SECTION_LABELS[c.section as ReportSection],
      page: c.page,
      body: c.body,
      side: c.side,
      by,
      at: c.createdAt,
      answer: c.answer,
      answeredBy: c.answeredByUserId ? (frozenBy.get(c.answeredByUserId) ?? null) : null,
      answeredAt: c.answeredAt,
    })),
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
      frozenByUserId: r.frozenByUserId,
      sha256: r.sha256,
      pages: r.pages,
      sections: r.layout?.sections ?? {},
      checkedAt: r.checkedAt,
      releasedAt: r.releasedAt,
      releasedTo: people.filter((p) => r.releasedTo.includes(p.id)).map((p) => p.name),
      returnedAt: r.returnedAt,
      signedAt: r.signedAt,
      signedVia: r.signedVia as SignedVia | null,
      issuedSha256: r.signedSha256,
      signatures: sigs
        .filter((g) => g.entityId === r.id && g.recordHash === r.sha256)
        .map((g) => ({
          id: g.id,
          userId: g.userId,
          meaning: g.meaning,
          name: g.signerName,
          role: g.signerRole,
          at: g.signedAt,
        })),
      paper: (() => {
        const p = paper.find((x) => x.reportId === r.id);
        return p
          ? {
              reviewedBy: p.reviewedByName,
              reviewedOn: p.reviewedOn,
              approvedBy: p.approvedByName,
              approvedByTitle: p.approvedByTitle,
              approvedOn: p.approvedOn,
              scanSha256: p.scanSha256,
            }
          : null;
      })(),
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
    can: {
      prepare: can(actor, "reports.prepare"),
      check: can(actor, "reports.check"),
      release: can(actor, "reports.release"),
    },
  };
}

export type StudyReport = NonNullable<Awaited<ReturnType<typeof getStudyReport>>>;

/** The Reports page: every study with a report, and studies whose analysis is approved but not yet reported. */
export async function listReports(db: Database, actor: SessionUser) {
  assertCan(actor, "jobs.view");
  const [rows, withReports] = await Promise.all([
    db
      .select({
        studyId: studies.id,
        reportNumber: studies.reportNumber,
        code: equipment.code,
        name: equipment.name,
        company: clientCompanies.name,
        companyId: clientCompanies.id,
        jobNumber: jobs.number,
        jobStatus: jobs.status,
        approvedAt: studies.analysisApprovedAt,
      })
      .from(studies)
      .innerJoin(jobs, eq(jobs.id, studies.jobId))
      .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .where(
        and(
          eq(studies.organisationId, actor.organisationId),
          isNotNull(studies.analysisApprovedAt),
        ),
      )
      .orderBy(desc(studies.analysisApprovedAt))
      .limit(300),
    db
      .select({
        r: studyReports,
        code: equipment.code,
        name: equipment.name,
        company: clientCompanies.name,
        companyId: clientCompanies.id,
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
          ne(studyReports.status, "superseded"),
          // A cancelled job's reports are void: they stay on the study, not in this list.
          ne(jobs.status, "cancelled"),
        ),
      )
      .orderBy(desc(studyReports.createdAt))
      .limit(300),
  ]);
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
      companyId: x.companyId,
      jobNumber: x.jobNumber,
      at:
        x.r.signedAt ??
        x.r.returnedAt ??
        x.r.releasedAt ??
        x.r.checkedAt ??
        x.r.frozenAt ??
        x.r.createdAt,
      frozenBy: x.r.frozenByUserId,
    })),
  };
}
