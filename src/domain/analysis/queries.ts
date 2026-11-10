import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  deviations,
  equipment,
  instruments,
  jobs,
  storedFiles,
  studies,
  studyAnalysisRuns,
  studyExcursionReviews,
  studyPositions,
  studyPrecal,
  users,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import type { JobStatus } from "@/domain/jobs/types";

import { approvalBlockers } from "./analysis-service";
import { excursionKey, type DeviationDecision, type DeviationSource } from "./types";
import { calibrationOf } from "@/domain/jobs/studies";
import { effectiveResult } from "@/domain/field/override-service";

/** Everything the Analysis tab shows for a study. */
export async function getStudyAnalysis(db: Database, actor: SessionUser, studyId: string) {
  assertCan(actor, "jobs.view");
  if (!isUuid(studyId)) return null;
  const [row] = await db
    .select({
      study: studies,
      code: equipment.code,
      jobStatus: jobs.status,
      jobNumber: jobs.number,
    })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) return null;
  const { study } = row;

  // Started first, awaited after the rest: it reads the most.
  const blockersRead = approvalBlockers(db, actor.organisationId, study);
  const [runs, reviews, devRows, peopleRows, positions, post, masters] = await Promise.all([
    db
      .select({
        id: studyAnalysisRuns.id,
        runNo: studyAnalysisRuns.runNo,
        kind: studyAnalysisRuns.kind,
        deviationId: studyAnalysisRuns.deviationId,
        engineVersion: studyAnalysisRuns.engineVersion,
        inputHash: studyAnalysisRuns.inputHash,
        createdAt: studyAnalysisRuns.createdAt,
        by: users.name,
      })
      .from(studyAnalysisRuns)
      .innerJoin(users, eq(users.id, studyAnalysisRuns.byUserId))
      .where(eq(studyAnalysisRuns.studyId, study.id))
      .orderBy(desc(studyAnalysisRuns.runNo)),
    db
      .select({ r: studyExcursionReviews, by: users.name })
      .from(studyExcursionReviews)
      .innerJoin(users, eq(users.id, studyExcursionReviews.byUserId))
      .where(eq(studyExcursionReviews.studyId, study.id))
      .orderBy(asc(studyExcursionReviews.at)),
    db
      .select({ d: deviations, file: storedFiles.firstFileName })
      .from(deviations)
      .leftJoin(storedFiles, eq(storedFiles.id, deviations.decisionFileId))
      .where(eq(deviations.studyId, study.id))
      .orderBy(asc(deviations.openedAt)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, actor.organisationId)),
    db
      .select({
        id: studyPositions.id,
        label: studyPositions.label,
        ambient: studyPositions.ambient,
        instrumentId: studyPositions.instrumentId,
        code: instruments.code,
        serialNo: instruments.serialNo,
      })
      .from(studyPositions)
      .leftJoin(instruments, eq(instruments.id, studyPositions.instrumentId))
      .where(eq(studyPositions.studyId, study.id))
      .orderBy(asc(studyPositions.sort)),
    // Post-calibration per placed logger: the latest reading per quantity.
    db
      .select({
        id: studyPrecal.id,
        instrumentId: studyPrecal.instrumentId,
        quantity: studyPrecal.quantity,
        reference: studyPrecal.reference,
        reading: studyPrecal.reading,
        deviation: studyPrecal.deviation,
        tolerance: studyPrecal.tolerance,
        // An approved override's result, else the computed one.
        result: effectiveResult,
        at: studyPrecal.at,
        by: users.name,
      })
      .from(studyPrecal)
      .leftJoin(users, eq(users.id, studyPrecal.byUserId))
      .where(and(eq(studyPrecal.studyId, study.id), eq(studyPrecal.phase, "post")))
      .orderBy(asc(studyPrecal.at)),
    db
      .select({ id: instruments.id, code: instruments.code, serialNo: instruments.serialNo })
      .from(instruments)
      .where(
        and(eq(instruments.organisationId, actor.organisationId), eq(instruments.tier, "master")),
      )
      .orderBy(asc(instruments.code)),
  ]);
  const { run, stale, out: blockers } = await blockersRead;
  const people = new Map(peopleRows.map((u) => [u.id, u.name]));

  const liveReview = new Map(
    reviews.filter((x) => !x.r.withdrawnAt).map((x) => [x.r.fingerprint, x]),
  );

  const impactRuns =
    devRows.length === 0
      ? []
      : await db
          .select()
          .from(studyAnalysisRuns)
          .where(
            and(
              inArray(
                studyAnalysisRuns.deviationId,
                devRows.map((x) => x.d.id),
              ),
              eq(studyAnalysisRuns.kind, "impact"),
            ),
          )
          .orderBy(desc(studyAnalysisRuns.runNo));
  const label = new Map(positions.map((p) => [p.id, p.label]));

  const deviationList = devRows.map(({ d, file }) => {
    const impact = impactRuns.find((r) => r.deviationId === d.id) ?? null;
    return {
      id: d.id,
      number: d.number,
      source: d.source as DeviationSource,
      title: d.title,
      description: d.description,
      position: d.positionId ? (label.get(d.positionId) ?? null) : null,
      openedAt: d.openedAt,
      openedBy: d.openedByUserId ? (people.get(d.openedByUserId) ?? null) : null,
      assessment: d.assessment,
      assessedBy: d.assessedByUserId ? (people.get(d.assessedByUserId) ?? null) : null,
      assessedAt: d.assessedAt,
      decision: d.decision as DeviationDecision | null,
      decidedByName: d.decidedByName,
      decidedByTitle: d.decidedByTitle,
      decidedOn: d.decidedOn,
      decisionNote: d.decisionNote,
      decisionFile: d.decisionFileId ? { id: d.decisionFileId, name: file ?? "Scan" } : null,
      recordedBy: d.decisionRecordedByUserId
        ? (people.get(d.decisionRecordedByUserId) ?? null)
        : null,
      closedAt: d.closedAt,
      impact: impact
        ? {
            runNo: impact.runNo,
            note: impact.result.notes.find((n) => n.startsWith("Impact")) ?? "",
            cycles: impact.result.cycles.map((c) => ({
              label: c.label,
              pass: c.pass,
              position: c.positions.find((p) => p.positionId === d.positionId) ?? null,
            })),
          }
        : null,
    };
  });

  const postCal = positions
    .filter((p) => p.instrumentId)
    .map((p) => {
      const mine = post.filter((x) => x.instrumentId === p.instrumentId);
      return {
        positionId: p.id,
        label: p.label,
        ambient: p.ambient,
        code: p.code!,
        serialNo: p.serialNo ?? "",
        readings: mine,
        result: mine.length === 0 ? null : mine.some((x) => x.result === "fail") ? "fail" : "pass",
      };
    });

  const approvedBy = study.analysisApprovedByUserId
    ? (people.get(study.analysisApprovedByUserId) ?? null)
    : null;
  const excursions = run
    ? run.result.cycles.flatMap((c) =>
        c.excursions.map((e) => {
          const fingerprint = excursionKey({ ...e, cycle: c.cycle });
          const r = liveReview.get(fingerprint);
          return {
            ...e,
            cycle: c.label,
            fingerprint,
            review: r
              ? {
                  decision: r.r.decision,
                  reason: r.r.reason,
                  by: r.by,
                  at: r.r.at,
                  deviation: r.r.deviationId
                    ? (devRows.find((x) => x.d.id === r.r.deviationId)?.d.number ?? null)
                    : null,
                }
              : null,
          };
        }),
      )
    : [];

  return {
    study: {
      id: study.id,
      code: row.code,
      jobNumber: row.jobNumber,
      jobStatus: row.jobStatus as JobStatus,
      dataStatus: study.dataStatus,
      thermal: study.workType === "thermal_validation",
      postCalRequired: calibrationOf(study).post,
      limits: {
        tempMin: study.tempMinC,
        tempMax: study.tempMaxC,
        rhMin: study.rhMinPct,
        rhMax: study.rhMaxPct,
      },
    },
    run: run
      ? {
          id: run.id,
          runNo: run.runNo,
          engineVersion: run.engineVersion,
          createdAt: run.createdAt,
          by: runs.find((r) => r.id === run.id)?.by ?? "",
          inputs: run.inputs,
          result: run.result,
        }
      : null,
    stale,
    runs: runs.filter((r) => r.kind === "analysis"),
    excursions,
    deviations: deviationList,
    postCal,
    masters,
    approval: study.analysisApprovedAt
      ? { runId: study.analysisRunId, at: study.analysisApprovedAt, by: approvedBy }
      : null,
    blockers,
    can: {
      run: can(actor, "analysis.run"),
      approve: can(actor, "analysis.approve"),
      deviations: can(actor, "deviation.manage"),
      postCal: can(actor, "postcal.record"),
    },
    positions: positions.map((p) => ({ id: p.id, label: p.label })),
  };
}

export type StudyAnalysis = NonNullable<Awaited<ReturnType<typeof getStudyAnalysis>>>;
