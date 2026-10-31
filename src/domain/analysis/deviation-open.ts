import "server-only";

import type { Transaction } from "@/db/client-factory";
import { eq } from "drizzle-orm";

import { deviations, studies } from "@/db/schema";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { allocateNumber } from "@/domain/numbering/allocate";
import { recordAudit } from "@/lib/audit";

import { DEFAULT_DEVIATION_NUMBER_FORMAT, type DeviationSource } from "./types";

/**
 * Opens a deviation inside the caller's transaction, numbered QT/DEV/YYYY/NNNN
 * (the number is given back if the transaction rolls back). Kept free of the
 * other services so the post-calibration screen can open one in the same
 * transaction that records the failure.
 */
export async function openDeviationTx(
  tx: Transaction,
  actor: SessionUser,
  input: {
    studyId: string;
    source: DeviationSource;
    title: string;
    description?: string;
    positionId?: string | null;
    instrumentId?: string | null;
    precalId?: string | null;
    /** For the audit line: the equipment and job. */
    context: string;
  },
  request?: RequestInfo,
) {
  const { number } = await allocateNumber(tx, {
    organisationId: actor.organisationId,
    kind: "deviation",
    format: DEFAULT_DEVIATION_NUMBER_FORMAT,
    date: new Date(),
  });
  const [row] = await tx
    .insert(deviations)
    .values({
      organisationId: actor.organisationId,
      studyId: input.studyId,
      number,
      source: input.source,
      title: input.title,
      description: input.description ?? "",
      positionId: input.positionId ?? null,
      instrumentId: input.instrumentId ?? null,
      precalId: input.precalId ?? null,
      openedByUserId: actor.id,
    })
    .returning();
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: { type: "user", userId: actor.id },
    action: "deviation.opened",
    entityType: "deviation",
    entityId: row!.id,
    summary: `${number} opened on ${input.context}: ${input.title}`,
    after: { number, source: input.source, title: input.title, studyId: input.studyId },
    request,
  });
  const [study] = await tx.select().from(studies).where(eq(studies.id, input.studyId));
  if (study?.analysisApprovedAt) {
    await clearApproval(tx, actor, study, `${number} was opened`, request);
  }
  return row!;
}

/** Takes an approval back when something changes under it; audited. */
export async function clearApproval(
  tx: Transaction,
  actor: SessionUser,
  study: { id: string; analysisRunId: string | null },
  why: string,
  request?: RequestInfo,
) {
  await tx
    .update(studies)
    .set({ analysisRunId: null, analysisApprovedAt: null, analysisApprovedByUserId: null })
    .where(eq(studies.id, study.id));
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: { type: "user", userId: actor.id },
    action: "study.analysis_approval_withdrawn",
    entityType: "study",
    entityId: study.id,
    summary: `Analysis approval withdrawn: ${why}`,
    before: { runId: study.analysisRunId },
    reason: why,
    request,
  });
}
