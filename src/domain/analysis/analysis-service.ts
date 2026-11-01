import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  deviations,
  equipment,
  storedFiles,
  studies,
  studyAnalysisRuns,
  studyDataAcceptances,
  studyDataFiles,
  studyExcursionReviews,
  studyPositions,
  studyPrecal,
  type Job,
  type Study,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { dataContext } from "@/domain/data/data-service";
import { lockJob, setStatus } from "@/domain/jobs/job-service";
import { JOB_STATUS_LABELS, type JobStatus } from "@/domain/jobs/types";
import { recordAudit } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { shortList } from "@/lib/text";

import { clearApproval, openDeviationTx } from "./deviation-open";
import {
  analyse,
  DEFAULT_CONSTANTS,
  ENGINE_VERSION,
  type EngineInput,
  type EngineResult,
  type Excursion,
  type Series,
} from "./engine";
import { AnalysisError } from "./errors";
import {
  DEVIATION_DECISION_LABELS,
  DEVIATION_DECISIONS,
  excursionKey,
  type DeviationDecision,
  type RunInputs,
} from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

/** Job statuses in which a study can be analysed. */
// Report draft and rework too: a data fix after the report was started needs a rerun.
const ANALYSIS_OPEN: readonly JobStatus[] = ["data_received", "analysis", "report_draft", "rework"];
/** Deviations can be worked on from the end of the study until the report is out. */
const DEVIATION_OPEN: readonly JobStatus[] = [
  "field_work",
  "data_issue",
  "data_received",
  "analysis",
  "report_draft",
  "rework",
];

type Loaded = { study: Study; job: Job; code: string };

async function load(tx: Transaction, actor: SessionUser, studyId: string): Promise<Loaded> {
  if (!isUuid(studyId)) throw new AnalysisError("That study does not exist.");
  const [row] = await tx
    .select({ study: studies, code: equipment.code })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) throw new AnalysisError("That study does not exist.");
  const job = await lockJob(tx, actor, row.study.jobId);
  await tx.select({ id: studies.id }).from(studies).where(eq(studies.id, studyId)).for("update");
  return { study: row.study, job, code: row.code };
}

const ctxLine = (l: Loaded) => `${l.code} (job ${l.job.number})`;
const num = (v: string | null) => (v === null ? null : Number(v));
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

// ---------------------------------------------------------------- inputs

/**
 * Everything the engine needs for a study, from the database, plus what is
 * kept with a run. Excluded positions come from closed "Exclude probe"
 * deviations; corrections are given only for an impact recalculation.
 */
export async function analysisInputs(
  tx: Transaction | Database,
  organisationId: string,
  study: Study,
  corrections: RunInputs["corrections"] = [],
): Promise<{ engine: EngineInput; inputs: RunInputs; hash: string }> {
  const ctx = await dataContext(tx, organisationId, study);
  const thermal = study.workType === "thermal_validation";
  const sums = new Map(
    ctx.files.length === 0
      ? []
      : (
          await tx
            .select({ id: storedFiles.id, sha256: storedFiles.sha256 })
            .from(storedFiles)
            .where(
              inArray(
                storedFiles.id,
                ctx.files.map((f) => f.fileId),
              ),
            )
        ).map((f) => [f.id, f.sha256]),
  );
  const fileById = new Map(ctx.files.map((f) => [f.id, f]));
  const positionById = new Map(ctx.positions.map((p) => [p.id, p]));

  const series: Series[] = [];
  const matches: RunInputs["matches"] = [];
  const taken = new Set<string>();
  for (const c of ctx.channels) {
    const m = ctx.matches.get(c.id);
    if (!m?.positionId) continue;
    const p = positionById.get(m.positionId);
    const f = fileById.get(c.fileId);
    if (!p || !f) continue;
    // A position in two places is a data problem resolved before confirming; first one wins.
    const key = `${p.id}|${c.quantity}`;
    if (taken.has(key)) continue;
    taken.add(key);
    matches.push({ channelId: c.id, positionId: p.id, quantity: c.quantity });
    series.push({
      positionId: p.id,
      label: p.label,
      ambient: p.ambient,
      quantity: c.quantity,
      logger: p.logger,
      times: f.times,
      values: c.values,
    });
  }
  // Positions in the study's own order.
  const order = new Map(ctx.positions.map((p, i) => [p.id, i]));
  series.sort((a, b) => order.get(a.positionId)! - order.get(b.positionId)!);

  const markerKinds = new Set([
    "door_opened",
    "door_closed",
    "power_off",
    "power_on",
    "hold_start",
    "hold_end",
  ]);
  const windows = ctx.windows
    .filter((w) => w.start !== null && w.end !== null)
    .map((w) => ({
      cycle: w.cycle,
      label: w.label,
      start: w.start!,
      end: w.end!,
      markers: (ctx.cycles.find((c) => c.cycle === w.cycle)?.events ?? [])
        .filter((e) => markerKinds.has(e.kind))
        .map((e) => ({ kind: e.kind, at: e.at.getTime() })),
    }));

  const excludedRows = await tx
    .select({
      positionId: deviations.positionId,
      number: deviations.number,
      by: deviations.decidedByName,
    })
    .from(deviations)
    .where(
      and(
        eq(deviations.studyId, study.id),
        eq(deviations.decision, "exclude_probe"),
        isNotNull(deviations.positionId),
      ),
    )
    .orderBy(asc(deviations.number));
  const excluded = excludedRows.map((d) => ({
    positionId: d.positionId!,
    reason: `${d.number}, decided by ${d.by}`,
  }));

  const accepted = (
    await tx
      .select({ fingerprint: studyDataAcceptances.fingerprint })
      .from(studyDataAcceptances)
      .where(
        and(eq(studyDataAcceptances.studyId, study.id), isNull(studyDataAcceptances.withdrawnAt)),
      )
  )
    .map((a) => a.fingerprint)
    .sort();

  const limits = {
    tempMin: num(study.tempMinC),
    tempMax: num(study.tempMaxC),
    rhMin: num(study.rhMinPct),
    rhMax: num(study.rhMaxPct),
  };
  const inputs: RunInputs = {
    constants: DEFAULT_CONSTANTS,
    limits,
    thermal,
    windows,
    files: ctx.files.map((f) => ({
      id: f.id,
      name: f.fileName,
      sha256: sums.get(f.fileId) ?? "",
    })),
    matches,
    acceptedProblems: accepted,
    excluded,
    corrections,
  };
  const engine: EngineInput = {
    series,
    windows,
    limits,
    constants: DEFAULT_CONSTANTS,
    thermal,
    excluded,
    corrections,
  };
  return { engine, inputs, hash: sha({ v: ENGINE_VERSION, inputs }) };
}

async function nextRunNo(tx: Transaction, studyId: string) {
  const [r] = await tx
    .select({ n: max(studyAnalysisRuns.runNo) })
    .from(studyAnalysisRuns)
    .where(eq(studyAnalysisRuns.studyId, studyId));
  return (r?.n ?? 0) + 1;
}

async function latestRun(tx: Transaction | Database, studyId: string) {
  const [run] = await tx
    .select()
    .from(studyAnalysisRuns)
    .where(and(eq(studyAnalysisRuns.studyId, studyId), eq(studyAnalysisRuns.kind, "analysis")))
    .orderBy(desc(studyAnalysisRuns.runNo))
    .limit(1);
  return run ?? null;
}

/** Offset to subtract from a failed logger's readings: its post-cal error. */
async function correctionFor(tx: Transaction, deviation: typeof deviations.$inferSelect) {
  if (!deviation.precalId || !deviation.positionId) return null;
  const [pc] = await tx.select().from(studyPrecal).where(eq(studyPrecal.id, deviation.precalId));
  if (!pc) return null;
  return {
    positionId: deviation.positionId,
    quantity: pc.quantity === "humidity" ? ("rh" as const) : ("temp" as const),
    offset: Number(pc.deviation),
  };
}

/** Stores an impact run for a post-cal deviation (the verdict with the error applied). */
async function impactRun(
  tx: Transaction,
  actor: SessionUser,
  l: Loaded,
  deviation: typeof deviations.$inferSelect,
  request?: RequestInfo,
) {
  const corr = await correctionFor(tx, deviation);
  if (!corr) return null;
  const { engine, inputs, hash } = await analysisInputs(tx, actor.organisationId, l.study, [corr]);
  if (engine.series.length === 0) return null;
  const [seen] = await tx
    .select()
    .from(studyAnalysisRuns)
    .where(
      and(eq(studyAnalysisRuns.deviationId, deviation.id), eq(studyAnalysisRuns.inputHash, hash)),
    );
  if (seen) return seen;
  const result = analyse(engine);
  const [run] = await tx
    .insert(studyAnalysisRuns)
    .values({
      organisationId: actor.organisationId,
      studyId: l.study.id,
      runNo: await nextRunNo(tx, l.study.id),
      kind: "impact",
      deviationId: deviation.id,
      engineVersion: ENGINE_VERSION,
      inputs,
      inputHash: hash,
      result,
      byUserId: actor.id,
    })
    .returning();
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "deviation.impact_recalculated",
    entityType: "deviation",
    entityId: deviation.id,
    summary: `${deviation.number}: impact recalculated with ${corr.offset > 0 ? "−" : "+"}${Math.abs(corr.offset)} applied — ${verdictLine(result)}`,
    after: { runNo: run!.runNo, correction: corr, pass: result.cycles.map((c) => c.pass) },
    request,
  });
  return run!;
}

function verdictLine(r: EngineResult) {
  return r.cycles
    .map((c) => `${c.label}: ${c.pass === null ? "no limits" : c.pass ? "pass" : "fail"}`)
    .join(", ");
}

// ---------------------------------------------------------------- running

/**
 * Runs the engine on the study's confirmed data and keeps the run. Nothing
 * changed since the last run: that run is given back. The first run moves
 * the job from Data received to Analysis. Open post-cal deviations get their
 * impact recalculated on the same data.
 */
export async function runAnalysis(
  db: Database,
  actor: SessionUser,
  studyId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "analysis.run");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    const s = l.job.status as JobStatus;
    if (!ANALYSIS_OPEN.includes(s)) {
      throw new AnalysisError(
        `Analysis isn't possible while job ${l.job.number} is ${JOB_STATUS_LABELS[s]?.toLowerCase() ?? s}.`,
      );
    }
    if (l.study.dataStatus !== "received") {
      throw new AnalysisError(`Confirm ${l.code}'s data (Data tab) before analysing it.`);
    }
    const { engine, inputs, hash } = await analysisInputs(tx, actor.organisationId, l.study);
    if (engine.series.length === 0)
      throw new AnalysisError("No readings are matched to a position.");
    const last = await latestRun(tx, l.study.id);
    if (last && last.inputHash === hash) {
      await refreshImpacts(tx, actor, l, request);
      return { runId: last.id, runNo: last.runNo, fresh: false };
    }
    const result = analyse(engine);
    const runNo = await nextRunNo(tx, l.study.id);
    const [run] = await tx
      .insert(studyAnalysisRuns)
      .values({
        organisationId: actor.organisationId,
        studyId: l.study.id,
        runNo,
        kind: "analysis",
        engineVersion: ENGINE_VERSION,
        inputs,
        inputHash: hash,
        result,
        byUserId: actor.id,
      })
      .returning();
    // The data changed after an approval: the approval of the older run no longer stands.
    if (l.study.analysisApprovedAt) {
      await clearApproval(tx, actor, l.study, `a new analysis (run ${runNo}) replaced it`, request);
    }
    const hot = result.cycles.map((c) => c.hot?.label).filter(Boolean);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.analysis_run",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} ran analysis ${runNo} on ${ctxLine(l)}: ${verdictLine(result)}${hot.length ? `; hot spot ${hot.join(", ")}` : ""}`,
      after: {
        runNo,
        engineVersion: ENGINE_VERSION,
        inputHash: hash,
        excursions: result.cycles.reduce((n, c) => n + c.excursions.length, 0),
        pass: result.cycles.map((c) => c.pass),
      },
      request,
    });
    if (s === "data_received") {
      await setStatus(tx, actor, l.job, "analysis", `Analysis of ${l.code} started`, request);
    }
    await refreshImpacts(tx, actor, l, request);
    return { runId: run!.id, runNo, fresh: true };
  });
}

/** Open post-cal deviations get their impact worked out on the current data. */
async function refreshImpacts(
  tx: Transaction,
  actor: SessionUser,
  l: Loaded,
  request?: RequestInfo,
) {
  const open = await tx
    .select()
    .from(deviations)
    .where(
      and(
        eq(deviations.studyId, l.study.id),
        eq(deviations.source, "post_cal"),
        isNull(deviations.closedAt),
      ),
    );
  for (const d of open) await impactRun(tx, actor, l, d, request);
}

// ---------------------------------------------------------------- excursions

const reviewSchema = z.discriminatedUnion("decision", [
  z.object({
    fingerprint: z.string().min(1).max(300),
    decision: z.literal("accepted"),
    reason: z.string().trim().min(5, "Say why the excursion is acceptable.").max(1000),
  }),
  z.object({
    fingerprint: z.string().min(1).max(300),
    decision: z.literal("deviation"),
    reason: z.string().trim().min(5, "Describe the excursion for the deviation.").max(1000),
  }),
]);

function describeExcursion(e: Excursion, cycleLabel: string) {
  const unit = e.quantity === "rh" ? "%RH" : "°C";
  return `${e.label} ${e.side === "high" ? "above" : "below"} ${e.limit} ${unit} for ${e.minutes} min from ${formatDateTime(new Date(e.start))} (${cycleLabel}), peak ${e.peak} ${unit}`;
}

/**
 * A person accepts an excursion with a reason, or raises it as a deviation.
 * The decision sticks to the excursion's fingerprint, so a rerun on the same
 * data keeps it.
 */
export async function reviewExcursion(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "analysis.run");
  const v = reviewSchema.parse(input);
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    const run = await latestRun(tx, l.study.id);
    const found = run?.result.cycles
      .flatMap((c) => c.excursions.map((e) => ({ e, c })))
      .find(({ e, c }) => excursionKey({ ...e, cycle: c.cycle }) === v.fingerprint);
    if (!run || !found) throw new AnalysisError("That excursion isn't in the latest analysis.");
    const [seen] = await tx
      .select()
      .from(studyExcursionReviews)
      .where(
        and(
          eq(studyExcursionReviews.studyId, l.study.id),
          eq(studyExcursionReviews.fingerprint, v.fingerprint),
          isNull(studyExcursionReviews.withdrawnAt),
        ),
      );
    if (seen) throw new AnalysisError("That excursion has already been reviewed.");
    const what = describeExcursion(found.e, found.c.label);
    let deviationId: string | null = null;
    let number: string | null = null;
    if (v.decision === "deviation") {
      const d = await openDeviationTx(
        tx,
        actor,
        {
          studyId: l.study.id,
          source: "excursion",
          title: `Excursion: ${what}`,
          description: v.reason,
          positionId: found.e.positionId,
          context: ctxLine(l),
        },
        request,
      );
      deviationId = d.id;
      number = d.number;
    }
    await tx.insert(studyExcursionReviews).values({
      organisationId: actor.organisationId,
      studyId: l.study.id,
      fingerprint: v.fingerprint,
      decision: v.decision,
      reason: v.reason,
      deviationId,
      byUserId: actor.id,
    });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.excursion_reviewed",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} ${v.decision === "accepted" ? "accepted" : `raised ${number} for`} an excursion on ${ctxLine(l)}: ${what}`,
      after: { fingerprint: v.fingerprint, decision: v.decision, deviation: number },
      reason: v.reason,
      request,
    });
    return { deviationNumber: number };
  });
}

/** Takes back an acceptance (a raised deviation is closed by its own decision instead). */
export async function withdrawExcursionReview(
  db: Database,
  actor: SessionUser,
  studyId: string,
  fingerprint: string,
  request?: RequestInfo,
) {
  assertCan(actor, "analysis.run");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    const [seen] = await tx
      .select()
      .from(studyExcursionReviews)
      .where(
        and(
          eq(studyExcursionReviews.studyId, l.study.id),
          eq(studyExcursionReviews.fingerprint, fingerprint),
          isNull(studyExcursionReviews.withdrawnAt),
        ),
      );
    if (!seen) throw new AnalysisError("That excursion has no review to withdraw.");
    if (seen.decision === "deviation") {
      throw new AnalysisError(
        "A deviation was raised for it; record the decision on the deviation.",
      );
    }
    if (l.study.analysisApprovedAt) {
      throw new AnalysisError("The analysis is approved. Withdraw the approval first.");
    }
    await tx
      .update(studyExcursionReviews)
      .set({ withdrawnAt: new Date(), withdrawnByUserId: actor.id })
      .where(eq(studyExcursionReviews.id, seen.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.excursion_review_withdrawn",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} withdrew the acceptance of an excursion on ${ctxLine(l)}`,
      before: { fingerprint, reason: seen.reason },
      request,
    });
  });
}

// ---------------------------------------------------------------- deviations

async function loadDeviation(tx: Transaction, actor: SessionUser, deviationId: string) {
  if (!isUuid(deviationId)) throw new AnalysisError("That deviation does not exist.");
  const [d] = await tx
    .select()
    .from(deviations)
    .where(
      and(eq(deviations.id, deviationId), eq(deviations.organisationId, actor.organisationId)),
    );
  if (!d) throw new AnalysisError("That deviation does not exist.");
  const l = await load(tx, actor, d.studyId);
  const [locked] = await tx.select().from(deviations).where(eq(deviations.id, d.id)).for("update");
  const s = l.job.status as JobStatus;
  if (!DEVIATION_OPEN.includes(s)) {
    throw new AnalysisError(
      `Deviations can't be changed while job ${l.job.number} is ${JOB_STATUS_LABELS[s]?.toLowerCase() ?? s}.`,
    );
  }
  return { d: locked!, l };
}

const openSchema = z.object({
  title: z.string().trim().min(5, "Give the deviation a title.").max(300),
  description: z.string().trim().max(4000).default(""),
  positionId: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().uuid().nullable().default(null),
  ),
});

/** Opens a deviation by hand (anything else that went wrong on the study). */
export async function openDeviation(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "deviation.manage");
  const v = openSchema.parse(input);
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    const s = l.job.status as JobStatus;
    if (!DEVIATION_OPEN.includes(s)) {
      throw new AnalysisError(
        `Deviations can't be opened while job ${l.job.number} is ${JOB_STATUS_LABELS[s]?.toLowerCase() ?? s}.`,
      );
    }
    if (v.positionId) {
      const [p] = await tx
        .select({ id: studyPositions.id })
        .from(studyPositions)
        .where(and(eq(studyPositions.id, v.positionId), eq(studyPositions.studyId, l.study.id)));
      if (!p) throw new AnalysisError("Pick a position of this study.");
    }
    const d = await openDeviationTx(
      tx,
      actor,
      { studyId: l.study.id, source: "manual", ...v, context: ctxLine(l) },
      request,
    );
    return { id: d.id, number: d.number };
  });
}

const assessSchema = z.object({
  assessment: z
    .string()
    .trim()
    .min(10, "Write QA Tech's assessment: what happened and whether it affects the result.")
    .max(4000),
});

export async function assessDeviation(
  db: Database,
  actor: SessionUser,
  deviationId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "deviation.manage");
  const v = assessSchema.parse(input);
  return db.transaction(async (tx) => {
    const { d, l } = await loadDeviation(tx, actor, deviationId);
    if (d.closedAt) throw new AnalysisError(`${d.number} is closed.`);
    await tx
      .update(deviations)
      .set({ assessment: v.assessment, assessedByUserId: actor.id, assessedAt: new Date() })
      .where(eq(deviations.id, d.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "deviation.assessed",
      entityType: "deviation",
      entityId: d.id,
      summary: `${actor.name} wrote QA Tech's assessment of ${d.number} (${ctxLine(l)})`,
      before: d.assessment ? { assessment: d.assessment } : undefined,
      after: { assessment: v.assessment },
      request,
    });
  });
}

const decideSchema = z.object({
  decision: z.enum(DEVIATION_DECISIONS),
  decidedByName: z.string().trim().min(2, "Who decided? (the client's QA head)").max(200),
  decidedByTitle: z.string().trim().max(200).default(""),
  decidedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of the decision."),
  note: z.string().trim().max(4000).default(""),
  fileId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().default(null)),
});

/**
 * Records the client QA head's decision (by name and date; an optional scan
 * of the signed paper) and closes the deviation. QA Tech's assessment must
 * come first. "Exclude probe" leaves the position out of the next run.
 */
export async function decideDeviation(
  db: Database,
  actor: SessionUser,
  deviationId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "deviation.manage");
  const v = decideSchema.parse(input);
  return db.transaction(async (tx) => {
    const { d, l } = await loadDeviation(tx, actor, deviationId);
    if (d.closedAt) {
      throw new AnalysisError(
        `${d.number} was already closed (${DEVIATION_DECISION_LABELS[d.decision as DeviationDecision]}, ${d.decidedByName}).`,
      );
    }
    if (!d.assessment) throw new AnalysisError("Write QA Tech's assessment before the decision.");
    if (v.decision === "exclude_probe" && !d.positionId) {
      throw new AnalysisError(
        "This deviation isn't about one position, so no probe can be excluded.",
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    if (v.decidedOn > today) throw new AnalysisError("The decision date is in the future.");
    if (v.decidedOn < d.openedAt.toISOString().slice(0, 10)) {
      throw new AnalysisError("The decision date is before the deviation was opened.");
    }
    if (v.fileId) {
      const [f] = await tx
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(
          and(eq(storedFiles.id, v.fileId), eq(storedFiles.organisationId, actor.organisationId)),
        );
      if (!f) throw new AnalysisError("That file was not uploaded.");
    }
    await tx
      .update(deviations)
      .set({
        decision: v.decision,
        decidedByName: v.decidedByName,
        decidedByTitle: v.decidedByTitle || null,
        decidedOn: v.decidedOn,
        decisionNote: v.note,
        decisionFileId: v.fileId,
        decisionRecordedByUserId: actor.id,
        closedAt: new Date(),
      })
      .where(eq(deviations.id, d.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "deviation.decided",
      entityType: "deviation",
      entityId: d.id,
      summary: `${d.number} (${ctxLine(l)}) closed: ${DEVIATION_DECISION_LABELS[v.decision]}, decided by ${v.decidedByName} on ${v.decidedOn}; recorded by ${actor.name}`,
      after: {
        decision: v.decision,
        decidedByName: v.decidedByName,
        decidedByTitle: v.decidedByTitle,
        decidedOn: v.decidedOn,
        file: v.fileId,
      },
      reason: v.note || undefined,
      request,
    });
  });
}

/** Recalculates a post-cal deviation's impact on the current data. */
export async function recalculateImpact(
  db: Database,
  actor: SessionUser,
  deviationId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "analysis.run");
  return db.transaction(async (tx) => {
    const { d, l } = await loadDeviation(tx, actor, deviationId);
    if (d.source !== "post_cal") {
      throw new AnalysisError("Only a post-calibration failure has an error to apply.");
    }
    if (l.study.dataStatus !== "received") {
      throw new AnalysisError(`Confirm ${l.code}'s data before recalculating.`);
    }
    const run = await impactRun(tx, actor, l, d, request);
    if (!run) throw new AnalysisError("There are no readings for that logger.");
    return { runNo: run.runNo };
  });
}

// ---------------------------------------------------------------- approval

/** What still stands between the study and an approved analysis, in words. */
export async function approvalBlockers(
  tx: Transaction | Database,
  organisationId: string,
  study: Study,
) {
  const out: string[] = [];
  const run = await latestRun(tx, study.id);
  if (study.dataStatus !== "received") out.push("The data isn't confirmed.");
  if (!run) {
    out.push("No analysis has been run.");
    return { run, stale: false, out };
  }
  const { hash } = await analysisInputs(tx, organisationId, study);
  const stale = hash !== run.inputHash;
  if (stale)
    out.push(`The data or decisions changed after run ${run.runNo}. Run the analysis again.`);

  const reviewed = new Set(
    (
      await tx
        .select({ fingerprint: studyExcursionReviews.fingerprint })
        .from(studyExcursionReviews)
        .where(
          and(
            eq(studyExcursionReviews.studyId, study.id),
            isNull(studyExcursionReviews.withdrawnAt),
          ),
        )
    ).map((r) => r.fingerprint),
  );
  const unreviewed = run.result.cycles.flatMap((c) =>
    c.excursions.filter((e) => !reviewed.has(excursionKey({ ...e, cycle: c.cycle }))),
  );
  if (unreviewed.length > 0) {
    out.push(
      `${unreviewed.length} excursion${unreviewed.length === 1 ? "" : "s"} not reviewed: ${shortList(unreviewed.map((e) => `${e.label} ${e.side === "high" ? "above" : "below"} ${e.limit}`))}`,
    );
  }

  const devs = await tx.select().from(deviations).where(eq(deviations.studyId, study.id));
  const open = devs.filter((d) => !d.closedAt);
  if (open.length > 0) {
    out.push(
      `Deviation${open.length === 1 ? "" : "s"} open: ${open.map((d) => d.number).join(", ")}.`,
    );
  }
  // "Repeat study": new data must come in after the decision.
  const repeat = devs.filter((d) => d.decision === "repeat_study" && d.closedAt);
  if (repeat.length > 0) {
    const [newest] = await tx
      .select({ at: studyDataFiles.uploadedAt })
      .from(studyDataFiles)
      .where(and(eq(studyDataFiles.studyId, study.id), isNull(studyDataFiles.replacedAt)))
      .orderBy(desc(studyDataFiles.uploadedAt))
      .limit(1);
    for (const d of repeat) {
      if (!newest || newest.at <= d.closedAt!) {
        out.push(`${d.number} decided to repeat the study: upload the new study's data.`);
      }
    }
  }

  // Post-calibration, when the client or thermal validation asks for it.
  if (study.postCalRequired || study.workType === "thermal_validation") {
    const placed = await tx
      .select({ id: studyPositions.instrumentId, label: studyPositions.label })
      .from(studyPositions)
      .where(and(eq(studyPositions.studyId, study.id), isNotNull(studyPositions.instrumentId)));
    const done = new Set(
      (
        await tx
          .select({ id: studyPrecal.instrumentId })
          .from(studyPrecal)
          .where(and(eq(studyPrecal.studyId, study.id), eq(studyPrecal.phase, "post")))
      ).map((r) => r.id),
    );
    const missing = placed.filter((p) => !done.has(p.id!));
    if (missing.length > 0) {
      out.push(
        `Post-calibration missing for ${missing.length} logger${missing.length === 1 ? "" : "s"}: ${shortList(missing.map((m) => m.label))}`,
      );
    }
  }
  return { run, stale, out };
}

/** The checker approves the latest run; the report (phase 8) is built from it. */
export async function approveAnalysis(
  db: Database,
  actor: SessionUser,
  studyId: string,
  runId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "analysis.approve");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    const s = l.job.status as JobStatus;
    if (!["analysis", "report_draft", "rework"].includes(s)) {
      throw new AnalysisError(
        `Approving isn't possible while job ${l.job.number} is ${JOB_STATUS_LABELS[s]?.toLowerCase() ?? s}.`,
      );
    }
    if (l.study.analysisApprovedAt)
      throw new AnalysisError(`${l.code}'s analysis is already approved.`);
    const { run, out } = await approvalBlockers(tx, actor.organisationId, l.study);
    if (!run || run.id !== runId) {
      throw new AnalysisError("A newer analysis was run. Check it before approving.");
    }
    if (out.length > 0) throw new AnalysisError(`Not yet: ${out.join(" ")}`);
    await tx
      .update(studies)
      .set({
        analysisRunId: run.id,
        analysisApprovedAt: new Date(),
        analysisApprovedByUserId: actor.id,
      })
      .where(eq(studies.id, l.study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.analysis_approved",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} approved analysis ${run.runNo} of ${ctxLine(l)}: ${verdictLine(run.result)}`,
      after: { runId: run.id, runNo: run.runNo, inputHash: run.inputHash },
      request,
    });
  });
}

export async function withdrawApproval(
  db: Database,
  actor: SessionUser,
  studyId: string,
  reason: string,
  request?: RequestInfo,
) {
  assertCan(actor, "analysis.approve");
  const why = z
    .string()
    .trim()
    .min(5, "Say why the approval is withdrawn.")
    .max(1000)
    .parse(reason);
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    if (!l.study.analysisApprovedAt)
      throw new AnalysisError(`${l.code}'s analysis isn't approved.`);
    if (!ANALYSIS_OPEN.includes(l.job.status as JobStatus)) {
      throw new AnalysisError(
        `The report is already under way (job ${l.job.number} is ${JOB_STATUS_LABELS[l.job.status as JobStatus]?.toLowerCase()}).`,
      );
    }
    await tx
      .update(studies)
      .set({ analysisRunId: null, analysisApprovedAt: null, analysisApprovedByUserId: null })
      .where(eq(studies.id, l.study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.analysis_approval_withdrawn",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} withdrew the approval of ${ctxLine(l)}'s analysis`,
      before: { runId: l.study.analysisRunId },
      reason: why,
      request,
    });
  });
}
