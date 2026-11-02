import "server-only";

import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { deviations, equipment, instruments, jobs, studies, studyPositions } from "@/db/schema";
import { can } from "@/domain/auth/permissions";
import { isClientRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";

import { DEVIATION_DECISION_LABELS, type DeviationDecision } from "./types";

/**
 * Open deviations on the client's own studies that QA Tech has assessed and
 * that wait for the client QA head's decision (phase 9).
 */
export async function clientDeviations(db: Database, actor: SessionUser) {
  if (!isClientRole(actor.role) || !actor.clientCompanyId) return [];
  if (!can(actor, "deviation.client_decide")) return [];
  return db
    .select({
      id: deviations.id,
      number: deviations.number,
      title: deviations.title,
      code: equipment.code,
    })
    .from(deviations)
    .innerJoin(studies, eq(studies.id, deviations.studyId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(
      and(
        eq(deviations.organisationId, actor.organisationId),
        eq(jobs.companyId, actor.clientCompanyId),
        isNull(deviations.closedAt),
        ne(deviations.assessment, ""),
        ne(jobs.status, "cancelled"),
      ),
    )
    .orderBy(asc(deviations.openedAt));
}

/** One deviation, as the client QA head reads it before deciding. */
export async function getClientDeviation(db: Database, actor: SessionUser, id: string) {
  if (!isClientRole(actor.role) || !actor.clientCompanyId || !isUuid(id)) return null;
  const [row] = await db
    .select({
      d: deviations,
      code: equipment.code,
      name: equipment.name,
      reportNumber: studies.reportNumber,
      jobNumber: jobs.number,
    })
    .from(deviations)
    .innerJoin(studies, eq(studies.id, deviations.studyId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(
      and(
        eq(deviations.id, id),
        eq(deviations.organisationId, actor.organisationId),
        eq(jobs.companyId, actor.clientCompanyId),
        isNotNull(deviations.assessedAt),
      ),
    );
  if (!row) return null;
  const { d } = row;
  const [where] = d.positionId
    ? await db
        .select({ label: studyPositions.label, logger: instruments.code })
        .from(studyPositions)
        .leftJoin(instruments, eq(instruments.id, studyPositions.instrumentId))
        .where(eq(studyPositions.id, d.positionId))
    : [];
  return {
    id: d.id,
    number: d.number,
    title: d.title,
    description: d.description,
    source: d.source,
    assessment: d.assessment,
    position: where ? `${where.label}${where.logger ? ` (logger ${where.logger})` : ""}` : null,
    canExclude: Boolean(d.positionId),
    code: row.code,
    name: row.name,
    reportNumber: row.reportNumber,
    jobNumber: row.jobNumber,
    closed: d.closedAt
      ? {
          decision: DEVIATION_DECISION_LABELS[d.decision as DeviationDecision],
          by: d.decidedByName,
          on: d.decidedOn,
          note: d.decisionNote,
          inApp: Boolean(d.decisionSignatureId),
        }
      : null,
    canDecide: can(actor, "deviation.client_decide") && !d.closedAt,
  };
}

export type ClientDeviation = NonNullable<Awaited<ReturnType<typeof getClientDeviation>>>;
