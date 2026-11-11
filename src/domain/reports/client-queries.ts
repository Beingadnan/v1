import "server-only";

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientSites,
  equipment,
  jobs,
  reportComments,
  reportPaperSignoffs,
  signatures,
  studies,
  studyReports,
  users,
} from "@/db/schema";
import { can } from "@/domain/auth/permissions";
import { isClientRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";

import { REPORT_SECTION_LABELS, revLabel, type ReportSection, type ReportStatus } from "./types";

/** A client user's company, or nothing for anyone else. */
function companyOf(actor: SessionUser) {
  return isClientRole(actor.role) && actor.clientCompanyId ? actor.clientCompanyId : null;
}

/**
 * Every revision QA Tech released to the client's company, newest first.
 * Drafts and QA Tech's internal steps are never shown to the client.
 */
export async function listClientReports(db: Database, actor: SessionUser) {
  const companyId = companyOf(actor);
  if (!companyId) return [];
  // "Reviewed by me" only needs this person's own review signatures: read them alongside.
  const [rows, reviewers] = await Promise.all([
    db
      .select({
        r: studyReports,
        reportNumber: studies.reportNumber,
        code: equipment.code,
        name: equipment.name,
        site: clientSites.name,
        jobNumber: jobs.number,
      })
      .from(studyReports)
      .innerJoin(studies, eq(studies.id, studyReports.studyId))
      .innerJoin(jobs, eq(jobs.id, studies.jobId))
      .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
      .leftJoin(clientSites, eq(clientSites.id, equipment.siteId))
      .where(
        and(
          eq(studyReports.organisationId, actor.organisationId),
          eq(jobs.companyId, companyId),
          isNotNull(studyReports.releasedAt),
        ),
      )
      .orderBy(desc(studyReports.releasedAt))
      .limit(500),
    db
      .select({
        entityId: signatures.entityId,
        userId: signatures.userId,
        hash: signatures.recordHash,
      })
      .from(signatures)
      .where(
        and(
          eq(signatures.organisationId, actor.organisationId),
          eq(signatures.userId, actor.id),
          eq(signatures.entityType, "report"),
          eq(signatures.meaning, "reviewed_by"),
        ),
      ),
  ]);
  return rows.map((x) => ({
    id: x.r.id,
    label: revLabel(x.r.rev),
    status: x.r.status as ReportStatus,
    reportNumber: x.reportNumber,
    code: x.code,
    name: x.name,
    site: x.site,
    jobNumber: x.jobNumber,
    releasedAt: x.r.releasedAt!,
    signedAt: x.r.signedAt,
    signedVia: x.r.signedVia,
    reviewedByMe: reviewers.some(
      (g) => g.entityId === x.r.id && g.userId === actor.id && g.hash === x.r.sha256,
    ),
  }));
}

export type ClientReportRow = Awaited<ReturnType<typeof listClientReports>>[number];

/** One released revision, for the client's review page. */
export async function getClientReport(db: Database, actor: SessionUser, reportId: string) {
  const companyId = companyOf(actor);
  if (!companyId || !isUuid(reportId)) return null;
  const [row] = await db
    .select({
      r: studyReports,
      reportNumber: studies.reportNumber,
      code: equipment.code,
      name: equipment.name,
      jobNumber: jobs.number,
    })
    .from(studyReports)
    .innerJoin(studies, eq(studies.id, studyReports.studyId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(
      and(
        eq(studyReports.id, reportId),
        eq(studyReports.organisationId, actor.organisationId),
        eq(jobs.companyId, companyId),
        isNotNull(studyReports.releasedAt),
      ),
    );
  if (!row) return null;
  const { r } = row;
  const sigs = await db
    .select()
    .from(signatures)
    .where(
      and(
        eq(signatures.entityType, "report"),
        eq(signatures.entityId, r.id),
        eq(signatures.recordHash, r.sha256!),
      ),
    )
    .orderBy(asc(signatures.signedAt));
  // The client sees its own comments on this study, and QA Tech's answers to them.
  const comments = await db
    .select({ c: reportComments, by: users.name, rev: studyReports.rev })
    .from(reportComments)
    .innerJoin(users, eq(users.id, reportComments.byUserId))
    .innerJoin(studyReports, eq(studyReports.id, reportComments.reportId))
    .where(and(eq(reportComments.studyId, r.studyId), eq(reportComments.side, "client")))
    .orderBy(asc(reportComments.createdAt));
  const [paper] = await db
    .select()
    .from(reportPaperSignoffs)
    .where(eq(reportPaperSignoffs.reportId, r.id));
  const status = r.status as ReportStatus;
  const reviewed = sigs.find((g) => g.meaning === "reviewed_by");
  return {
    id: r.id,
    label: revLabel(r.rev),
    status,
    reason: r.reason,
    reportNumber: row.reportNumber,
    code: row.code,
    name: row.name,
    jobNumber: row.jobNumber,
    pages: r.pages,
    sha256: r.sha256!,
    issuedSha256: r.signedSha256,
    releasedAt: r.releasedAt!,
    signedVia: r.signedVia,
    sections: r.layout?.sections ?? {},
    signatures: sigs.map((g) => ({
      id: g.id,
      meaning: g.meaning,
      name: g.signerName,
      role: g.signerRole,
      at: g.signedAt,
    })),
    paper: paper
      ? {
          reviewedBy: paper.reviewedByName,
          reviewedOn: paper.reviewedOn,
          approvedBy: paper.approvedByName,
          approvedOn: paper.approvedOn,
        }
      : null,
    comments: comments.map(({ c, by, rev }) => ({
      id: c.id,
      rev: revLabel(rev),
      sectionLabel: REPORT_SECTION_LABELS[c.section as ReportSection],
      page: c.page,
      body: c.body,
      by,
      at: c.createdAt,
      answer: c.answer,
    })),
    can: {
      // One client signature (QA Tech, Nov 2026): the authorised signatory approves.
      approve:
        can(actor, "reports.client_approve") && (status === "released" || status === "reviewed"),
      return:
        can(actor, "reports.client_review") && (status === "released" || status === "reviewed"),
    },
    reviewedByMe: reviewed?.userId === actor.id,
  };
}

export type ClientReport = NonNullable<Awaited<ReturnType<typeof getClientReport>>>;
