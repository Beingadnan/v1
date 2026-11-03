import "server-only";

import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  equipment,
  instrumentModels,
  instruments,
  jobInstruments,
  studies,
  studyEvents,
  studyPhotos,
  studyPositions,
  studyPrecal,
  deviations,
  storedFiles,
  type Job,
  type Study,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { todayInIndia } from "@/domain/clients/requalification";
import { STUDY_CYCLE_LABELS, type StudyCycle } from "@/domain/clients/study-defaults";
import { certificatesOf } from "@/domain/instruments/certificate-service";
import type { AccuracySpec } from "@/domain/instruments/calibration-math";
import { computeReadiness, validThrough } from "@/domain/jobs/readiness";
import {
  busyInstruments,
  lockBookings,
  lockJob,
  readinessInputFor,
  setStatus,
} from "@/domain/jobs/job-service";
import { JOB_STATUS_LABELS, type JobStatus } from "@/domain/jobs/types";
import { recordAudit } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";
import { shortList } from "@/lib/text";

import { recheckIfData } from "@/domain/data/data-service";

import { FieldError } from "./errors";
import { parseRoomSize, templateLayout } from "./layout";
import { evaluatePrecal } from "./precal";
import { openDeviationTx } from "@/domain/analysis/deviation-open";
import {
  EVENT_LABELS,
  ROUTINE,
  markersFor,
  type CycleKey,
  type EventKind,
  STUDY_STATUS_LABELS,
  type StudyStatus,
} from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

/** Statuses in which a job's studies can be worked on site. */
const ON_SITE: readonly JobStatus[] = ["ready", "field_work", "data_issue"];
/** Layouts can also be drawn up in the office while the job is planned. */
const LAYOUT_OK: readonly JobStatus[] = ["created", "ready", "field_work", "data_issue"];

type Loaded = { study: Study; job: Job; equipment: typeof equipment.$inferSelect };

/** The study, its job (locked) and its equipment. Other organisations' ids look missing. */
async function loadStudy(tx: Transaction, actor: SessionUser, studyId: string): Promise<Loaded> {
  if (!isUuid(studyId)) throw new FieldError("That study does not exist.");
  const [row] = await tx
    .select({ study: studies, equipment })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) throw new FieldError("That study does not exist.");
  const job = await lockJob(tx, actor, row.study.jobId);
  // Lock the study too: two engineers on one study save one at a time.
  await tx.select({ id: studies.id }).from(studies).where(eq(studies.id, studyId)).for("update");
  return { study: row.study, job, equipment: row.equipment };
}

function assertJob(job: Job, allowed: readonly JobStatus[], what: string) {
  const status = job.status as JobStatus;
  if (!allowed.includes(status)) {
    throw new FieldError(
      `${what} isn't possible while job ${job.number} is ${JOB_STATUS_LABELS[status]}.`,
    );
  }
}

export function cyclesOf(study: Pick<Study, "cycles">): CycleKey[] {
  return study.cycles.length > 0 ? (study.cycles as StudyCycle[]) : [ROUTINE];
}

const cycleLabel = (c: CycleKey) => (c === ROUTINE ? "Study" : STUDY_CYCLE_LABELS[c]);

// ---------------------------------------------------------------- layout

const layoutSchema = z
  .array(
    z.object({
      label: z
        .string()
        .trim()
        .min(1, "Every position needs a label.")
        .max(20, "Labels are at most 20 characters."),
      x: z.coerce.number().min(0).max(1),
      y: z.coerce.number().min(0).max(1),
      z: z.coerce.number().min(0).max(1),
      note: z.string().trim().max(200).default(""),
      ambient: z.boolean().default(false),
    }),
  )
  .max(500, "At most 500 positions per study.")
  .superRefine((points, ctx) => {
    const seen = new Set<string>();
    points.forEach((p, i) => {
      const key = p.label.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: [i, "label"], message: `${p.label} is used twice.` });
      }
      seen.add(key);
    });
  });
export type LayoutInput = z.input<typeof layoutSchema>;

/**
 * Saves a study's positions. Positions keep their logger when their label
 * stays; removing a position that holds a logger is refused.
 */
export async function saveLayout(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: unknown,
  request?: RequestInfo,
): Promise<{ count: number }> {
  assertCan(actor, "field.perform");
  const points = layoutSchema.parse(input);
  return db.transaction(async (tx) => {
    const { study, job, equipment: e } = await loadStudy(tx, actor, studyId);
    assertJob(job, LAYOUT_OK, "Changing the layout");
    if (study.status === "completed")
      throw new FieldError(`The ${e.code} study is done; its layout is fixed.`);
    const current = await tx
      .select()
      .from(studyPositions)
      .where(eq(studyPositions.studyId, study.id));
    const byLabel = new Map(current.map((p) => [p.label.toLowerCase(), p]));
    const keep = new Set(points.map((p) => p.label.toLowerCase()));
    const losing = current.filter((p) => p.instrumentId && !keep.has(p.label.toLowerCase()));
    if (losing.length > 0) {
      throw new FieldError(
        `Remove the logger from ${shortList(losing.map((p) => p.label))} before removing ${losing.length === 1 ? "that position" : "those positions"}.`,
      );
    }
    const gone = current.filter((p) => !keep.has(p.label.toLowerCase())).map((p) => p.id);
    if (gone.length > 0) await tx.delete(studyPositions).where(inArray(studyPositions.id, gone));
    for (const [sort, p] of points.entries()) {
      const values = {
        label: p.label,
        sort: sort + 1,
        x: String(p.x),
        y: String(p.y),
        z: String(p.z),
        note: p.note,
        ambient: p.ambient,
      };
      const existing = byLabel.get(p.label.toLowerCase());
      if (existing) {
        await tx.update(studyPositions).set(values).where(eq(studyPositions.id, existing.id));
      } else {
        await tx
          .insert(studyPositions)
          .values({ organisationId: actor.organisationId, studyId: study.id, ...values });
      }
    }
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.layout_saved",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} saved the layout of ${e.code} on job ${job.number}: ${points.length} positions`,
      before: current.map(({ label, x, y, z, ambient }) => ({ label, x, y, z, ambient })),
      after: points,
      request,
    });
    return { count: points.length };
  });
}

/**
 * Records the room's size on the equipment when it wasn't known (or was
 * wrong), from what the engineer measured on site. The WHO grid and FT-12
 * use it. Typed as "3.36 x 6.4 x 2.4 m", in mm, cm or m.
 */
export async function setRoomSize(
  db: Database,
  actor: SessionUser,
  studyId: string,
  text: string,
  request?: RequestInfo,
): Promise<{ lengthM: number; widthM: number; heightM: number }> {
  assertCan(actor, "field.perform");
  const size = parseRoomSize(typeof text === "string" ? text : "");
  if (!size.ok) throw new FieldError(size.error);
  return db.transaction(async (tx) => {
    const { study, job, equipment: e } = await loadStudy(tx, actor, studyId);
    assertJob(job, LAYOUT_OK, "Changing the size");
    if (study.status === "completed")
      throw new FieldError(`The ${e.code} study is done; its size is fixed.`);
    const { lengthM, widthM, heightM } = size;
    await tx
      .update(equipment)
      .set({
        lengthM: String(lengthM),
        widthM: String(widthM),
        heightM: String(heightM),
        updatedAt: new Date(),
      })
      .where(and(eq(equipment.id, e.id), eq(equipment.organisationId, actor.organisationId)));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "equipment.updated",
      entityType: "equipment",
      entityId: e.id,
      summary: `${actor.name} recorded the size of ${e.code} on site (job ${job.number}): ${lengthM} × ${widthM} × ${heightM} m`,
      before: { lengthM: e.lengthM, widthM: e.widthM, heightM: e.heightM },
      after: { lengthM, widthM, heightM },
      request,
    });
    return { lengthM, widthM, heightM };
  });
}

/** The template layout for the study's logger count and the equipment's size. */
export async function layoutTemplate(db: Database, actor: SessionUser, studyId: string) {
  assertCan(actor, "field.perform");
  return db.transaction(async (tx) => {
    const { study, equipment: e } = await loadStudy(tx, actor, studyId);
    const n = (v: string | null) => (v === null ? null : Number(v));
    return templateLayout(study.loggerCount, {
      lengthM: n(e.lengthM),
      widthM: n(e.widthM),
      heightM: n(e.heightM),
    });
  });
}

// ---------------------------------------------------------------- loggers

async function findInstrument(tx: Transaction, actor: SessionUser, code: string) {
  const c = code.trim().toLowerCase();
  if (!c) throw new FieldError("Scan or type the logger's ID or serial number.");
  const rows = await tx
    .select({ i: instruments, modelAccuracy: instrumentModels.accuracy })
    .from(instruments)
    .leftJoin(instrumentModels, eq(instrumentModels.id, instruments.modelId))
    .where(
      and(
        eq(instruments.organisationId, actor.organisationId),
        or(sql`lower(${instruments.code}) = ${c}`, sql`lower(${instruments.serialNo}) = ${c}`),
      ),
    );
  // An ID match wins over a serial that happens to look the same.
  const row = rows.find((r) => r.i.code.toLowerCase() === c) ?? rows[0];
  if (!row) throw new FieldError(`${code.trim()} is not in the instrument register.`);
  return {
    ...row.i,
    effectiveAccuracy: (row.i.accuracy ?? row.modelAccuracy ?? null) as AccuracySpec | null,
  };
}

/** Why this logger can't go into this study now, or null. */
async function placementProblem(
  tx: Transaction,
  actor: SessionUser,
  job: Job,
  study: Study,
  inst: Awaited<ReturnType<typeof findInstrument>>,
): Promise<string | null> {
  if (inst.tier === "master") return `${inst.code} is a master standard, not a logger.`;
  const certs = await certificatesOf(tx, actor.organisationId, [inst.id]);
  const valid = validThrough(
    { ...inst, certificates: certs.get(inst.id) ?? [] },
    job.plannedStart,
    job.plannedEnd,
  );
  if (!valid.ok)
    return `${valid.reason} (the study runs to ${job.plannedEnd.split("-").reverse().join(".")}).`;
  const busy = (await busyInstruments(tx, actor.organisationId, job, [inst.id])).get(inst.id);
  if (busy) return `${inst.code} is booked on ${busy.join(", ")} on these dates.`;
  const [elsewhere] = await tx
    .select({ label: studyPositions.label, code: equipment.code })
    .from(studyPositions)
    .innerJoin(studies, eq(studies.id, studyPositions.studyId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.jobId, job.id), eq(studyPositions.instrumentId, inst.id)));
  if (elsewhere)
    return `${inst.code} is already at ${elsewhere.label} (${elsewhere.code}). Remove it there first.`;
  const [last] = await tx
    .select({ result: studyPrecal.result })
    .from(studyPrecal)
    .where(
      and(
        eq(studyPrecal.studyId, study.id),
        eq(studyPrecal.instrumentId, inst.id),
        eq(studyPrecal.phase, "pre"),
      ),
    )
    .orderBy(desc(studyPrecal.at))
    .limit(1);
  if (last?.result === "fail") return `${inst.code} failed pre-calibration and can't be used.`;
  if (study.workType === "thermal_validation" && last?.result !== "pass") {
    return `${inst.code} needs a passing pre-calibration before thermal validation.`;
  }
  return null;
}

export type PlaceResult = {
  label: string;
  code: string;
  serialNo: string;
  booked: boolean;
  left: number;
};

/**
 * Puts a scanned or typed logger at a position (the one given, or the next
 * empty one). A valid, free logger that wasn't booked is booked for the job.
 */
export async function placeLogger(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: { code: unknown; positionId?: unknown },
  request?: RequestInfo,
): Promise<PlaceResult> {
  assertCan(actor, "field.perform");
  const code = typeof input.code === "string" ? input.code.slice(0, 100) : "";
  return db.transaction(async (tx) => {
    await lockBookings(tx, actor.organisationId);
    const { study, job, equipment: e } = await loadStudy(tx, actor, studyId);
    assertJob(job, ON_SITE, "Placing loggers");
    if (study.status === "completed") throw new FieldError(`The ${e.code} study is done.`);
    const positions = await tx
      .select()
      .from(studyPositions)
      .where(eq(studyPositions.studyId, study.id))
      .orderBy(asc(studyPositions.sort));
    if (positions.length === 0) throw new FieldError("Set up the positions first (Layout).");
    const inst = await findInstrument(tx, actor, code);
    const here = positions.find((p) => p.instrumentId === inst.id);
    if (here) throw new FieldError(`${inst.code} is already at ${here.label}.`);
    // What is wrong with the logger matters more than where it would go.
    const problem = await placementProblem(tx, actor, job, study, inst);
    if (problem) throw new FieldError(problem);
    let target = positions.find((p) => p.instrumentId === null) ?? null;
    if (typeof input.positionId === "string" && input.positionId) {
      target = positions.find((p) => p.id === input.positionId) ?? null;
      if (!target) throw new FieldError("That position does not exist.");
      if (target.instrumentId) {
        const [occupant] = await tx
          .select({ code: instruments.code })
          .from(instruments)
          .where(eq(instruments.id, target.instrumentId));
        throw new FieldError(
          `${target.label} already has ${occupant?.code ?? "a logger"}. Remove it first.`,
        );
      }
    }
    if (!target)
      throw new FieldError(
        `All ${positions.length} positions have a logger. Add a position in Layout.`,
      );

    const [booking] = await tx
      .select({ id: jobInstruments.instrumentId })
      .from(jobInstruments)
      .where(and(eq(jobInstruments.jobId, job.id), eq(jobInstruments.instrumentId, inst.id)));
    if (!booking) {
      await tx.insert(jobInstruments).values({
        organisationId: actor.organisationId,
        jobId: job.id,
        instrumentId: inst.id,
        bookedByUserId: actor.id,
      });
    }
    await tx
      .update(studyPositions)
      .set({ instrumentId: inst.id, placedAt: new Date(), placedByUserId: actor.id })
      .where(eq(studyPositions.id, target.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.logger_placed",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} placed ${inst.code} at ${target.label} in ${e.code} (job ${job.number})${booking ? "" : ", booked on site"}`,
      after: { position: target.label, instrument: inst.code, serial: inst.serialNo },
      request,
    });
    const left = positions.filter((p) => p.instrumentId === null && p.id !== target.id).length;
    return {
      label: target.label,
      code: inst.code,
      serialNo: inst.serialNo,
      booked: !booking,
      left,
    };
  });
}

export async function removeLogger(
  db: Database,
  actor: SessionUser,
  positionId: string,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "field.perform");
  if (!isUuid(positionId)) throw new FieldError("That position does not exist.");
  await db.transaction(async (tx) => {
    const [pos] = await tx
      .select()
      .from(studyPositions)
      .where(
        and(
          eq(studyPositions.id, positionId),
          eq(studyPositions.organisationId, actor.organisationId),
        ),
      );
    if (!pos) throw new FieldError("That position does not exist.");
    const { study, job, equipment: e } = await loadStudy(tx, actor, pos.studyId);
    assertJob(job, ON_SITE, "Removing a logger");
    if (study.status === "completed") throw new FieldError(`The ${e.code} study is done.`);
    if (!pos.instrumentId) return;
    const [inst] = await tx
      .select({ code: instruments.code })
      .from(instruments)
      .where(eq(instruments.id, pos.instrumentId));
    await tx
      .update(studyPositions)
      .set({ instrumentId: null, placedAt: null, placedByUserId: null })
      .where(eq(studyPositions.id, pos.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.logger_removed",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} removed ${inst?.code ?? "a logger"} from ${pos.label} in ${e.code} (job ${job.number})`,
      request,
    });
  });
}

// ---------------------------------------------------------------- time markers

const eventSchema = z.object({
  id: z.string().uuid("The phone sent a bad id. Reload the page."),
  cycle: z.string(),
  kind: z.string(),
  at: z.coerce.date({ message: "The time is not valid." }),
  note: z.string().trim().max(300).default(""),
});

/** What the study's cycles look like from its markers. */
export function cycleProgress<E extends { cycle: string; kind: string; at: Date; voided: boolean }>(
  cycles: CycleKey[],
  events: E[],
  thermal = false,
) {
  return cycles.map((cycle) => {
    const mine = events
      .filter((e) => e.cycle === cycle && !e.voided)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const first = (k: EventKind) => mine.find((e) => e.kind === k)?.at ?? null;
    const done = new Set(mine.map((e) => e.kind));
    const next =
      markersFor(cycle, thermal).find(
        (k) => !done.has(k) || k === "door_opened" || k === "power_off",
      ) ?? null;
    return {
      cycle,
      label: cycleLabel(cycle),
      startedAt: first("start"),
      endedAt: first("end"),
      holdStartedAt: first("hold_start"),
      holdEndedAt: first("hold_end"),
      done: done.has("end"),
      events: mine,
      next: done.has("end") ? null : done.has("start") ? next : "start",
    };
  });
}

function statusFrom(progress: ReturnType<typeof cycleProgress>): StudyStatus {
  if (progress.every((c) => c.done)) return "completed";
  if (progress.some((c) => c.startedAt)) return "in_progress";
  return "planned";
}

async function syncStudyStatus(
  tx: Transaction,
  actor: SessionUser,
  loaded: Loaded,
  request?: RequestInfo,
) {
  const events = await tx
    .select()
    .from(studyEvents)
    .where(eq(studyEvents.studyId, loaded.study.id));
  const status = statusFrom(
    cycleProgress(cyclesOf(loaded.study), events, loaded.study.workType === "thermal_validation"),
  );
  if (status === loaded.study.status) return status;
  await tx.update(studies).set({ status }).where(eq(studies.id, loaded.study.id));
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "study.status_changed",
    entityType: "study",
    entityId: loaded.study.id,
    summary: `${loaded.equipment.code} on job ${loaded.job.number}: ${STUDY_STATUS_LABELS[loaded.study.status as StudyStatus]} → ${STUDY_STATUS_LABELS[status]}`,
    before: { status: loaded.study.status },
    after: { status },
    request,
  });
  return status;
}

/**
 * Records a cycle's start or end, or a door or power marker, at the time it
 * was tapped. Sending the same id again (a retry after a dropped connection)
 * changes nothing. The first start moves a Ready job to Field Work.
 */
export async function recordEvent(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: unknown,
  request?: RequestInfo,
  now = new Date(),
): Promise<{ status: StudyStatus; duplicate: boolean }> {
  assertCan(actor, "field.perform");
  const v = eventSchema.parse(input);
  return db.transaction(async (tx) => {
    const loaded = await loadStudy(tx, actor, studyId);
    const { study, job, equipment: e } = loaded;
    const [seen] = await tx
      .select({ id: studyEvents.id })
      .from(studyEvents)
      .where(eq(studyEvents.id, v.id));
    if (seen) return { status: study.status as StudyStatus, duplicate: true };

    assertJob(job, ON_SITE, "Recording times");
    const cycles = cyclesOf(study);
    if (!cycles.includes(v.cycle as CycleKey))
      throw new FieldError("That cycle isn't part of this study.");
    const cycle = v.cycle as CycleKey;
    const thermal = study.workType === "thermal_validation";
    if (!markersFor(cycle, thermal).includes(v.kind as EventKind)) {
      throw new FieldError(`${cycleLabel(cycle)} has no "${v.kind}" marker.`);
    }
    const kind = v.kind as EventKind;
    if (v.at.getTime() > now.getTime() + 10 * 60_000)
      throw new FieldError("That time is in the future. Check the phone's clock.");
    if (v.at.getTime() < now.getTime() - 30 * 86_400_000)
      throw new FieldError("That time is more than 30 days ago.");

    const events = await tx.select().from(studyEvents).where(eq(studyEvents.studyId, study.id));
    const progress = cycleProgress(cycles, events, thermal).find((c) => c.cycle === cycle)!;
    if (kind === "start") {
      if (progress.startedAt) throw new FieldError(`${progress.label} has already started.`);
      // One equipment runs one condition at a time: cycles don't overlap.
      const all = cycleProgress(cycles, events, thermal);
      const clash = all.find(
        (c) =>
          c.cycle !== cycle &&
          c.startedAt &&
          v.at >= c.startedAt &&
          (c.endedAt === null || v.at < c.endedAt),
      );
      if (clash) {
        throw new FieldError(
          clash.endedAt
            ? `${clash.label} ran until ${formatDateTime(clash.endedAt)}; ${progress.label.toLowerCase()} can't start inside it.`
            : `${clash.label} is still running. End it before starting ${progress.label.toLowerCase()}.`,
        );
      }
      const positions = await tx
        .select({ label: studyPositions.label, instrumentId: studyPositions.instrumentId })
        .from(studyPositions)
        .where(eq(studyPositions.studyId, study.id))
        .orderBy(asc(studyPositions.sort));
      if (positions.length === 0 || positions.every((p) => p.instrumentId === null)) {
        throw new FieldError("Place the loggers before starting.");
      }
      // A study started with gaps would report positions without data.
      const empty = positions.filter((p) => p.instrumentId === null).map((p) => p.label);
      if (empty.length > 0) {
        throw new FieldError(
          `${empty.length === 1 ? "1 position has" : `${empty.length} positions have`} no logger (${shortList(empty)}). Place loggers there, or remove ${empty.length === 1 ? "that position" : "those positions"} in Layout.`,
        );
      }
      if (job.status === "ready") {
        const readiness = computeReadiness(await readinessInputFor(tx, actor.organisationId, job));
        if (!readiness.ready) {
          throw new FieldError(
            `Job ${job.number} isn't ready for field work: ${readiness.items
              .filter((i) => i.state === "pending")
              .map((i) => i.label)
              .join(", ")}.`,
          );
        }
        await setStatus(
          tx,
          actor,
          job,
          "field_work",
          `${EVENT_LABELS.start} ${e.code} on site`,
          request,
        );
      }
    } else {
      if (!progress.startedAt) throw new FieldError(`Start ${progress.label.toLowerCase()} first.`);
      if (progress.endedAt) throw new FieldError(`${progress.label} has already ended.`);
      if (v.at < progress.startedAt)
        throw new FieldError(`That is before ${progress.label.toLowerCase()} started.`);
      if (kind === "door_closed" || kind === "power_on") {
        const opener = kind === "door_closed" ? "door_opened" : "power_off";
        const opens = progress.events.filter((x) => x.kind === opener).length;
        const closes = progress.events.filter((x) => x.kind === kind).length;
        if (opens <= closes) throw new FieldError(`Record "${EVENT_LABELS[opener]}" first.`);
      }
      // The hold (F0 window) opens once and closes once, inside the cycle.
      const live = progress.events;
      const holdStarted = live.some((x) => x.kind === "hold_start");
      const holdEnded = live.some((x) => x.kind === "hold_end");
      if (kind === "hold_start" && holdStarted)
        throw new FieldError("The hold has already started.");
      if (kind === "hold_end" && !holdStarted)
        throw new FieldError(`Record "${EVENT_LABELS.hold_start}" first.`);
      if (kind === "hold_end" && holdEnded) throw new FieldError("The hold has already ended.");
      if (kind === "end" && holdStarted && !holdEnded)
        throw new FieldError(`Record "${EVENT_LABELS.hold_end}" before ending.`);
      if (kind === "end") {
        const opens = progress.events.filter(
          (x) => x.kind === "door_opened" || x.kind === "power_off",
        ).length;
        const closes = progress.events.filter(
          (x) => x.kind === "door_closed" || x.kind === "power_on",
        ).length;
        if (opens > closes)
          throw new FieldError("The door is still open or the power still off. Record it first.");
      }
    }
    await tx.insert(studyEvents).values({
      id: v.id,
      organisationId: actor.organisationId,
      studyId: study.id,
      cycle,
      kind,
      at: v.at,
      note: v.note,
      byUserId: actor.id,
    });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.event_recorded",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} recorded ${e.code} ${progress.label.toLowerCase()}: ${EVENT_LABELS[kind].toLowerCase()} at ${formatDateTime(v.at)} (job ${loaded.job.number})`,
      after: { cycle, kind, at: v.at.toISOString(), note: v.note },
      request,
    });
    const status = await syncStudyStatus(tx, actor, loaded, request);
    await recheckIfData(tx, actor, study.id);
    return { status, duplicate: false };
  });
}

/** Strikes out a wrong marker, with a reason. It stays in the record. */
export async function voidEvent(
  db: Database,
  actor: SessionUser,
  eventId: string,
  reasonInput: unknown,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "field.perform");
  const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 300) : "";
  if (!reason) throw new FieldError("Say why the time is wrong.");
  if (!isUuid(eventId)) throw new FieldError("That time does not exist.");
  await db.transaction(async (tx) => {
    const [ev] = await tx
      .select()
      .from(studyEvents)
      .where(
        and(eq(studyEvents.id, eventId), eq(studyEvents.organisationId, actor.organisationId)),
      );
    if (!ev || ev.voided) throw new FieldError("That time does not exist.");
    const loaded = await loadStudy(tx, actor, ev.studyId);
    assertJob(loaded.job, ON_SITE, "Correcting times");
    const later = await tx
      .select({ id: studyEvents.id })
      .from(studyEvents)
      .where(
        and(
          eq(studyEvents.studyId, ev.studyId),
          eq(studyEvents.cycle, ev.cycle),
          eq(studyEvents.voided, false),
          ne(studyEvents.id, ev.id),
          sql`${studyEvents.at} > ${ev.at}`,
        ),
      );
    if (later.length > 0) throw new FieldError("Strike out the later times of this cycle first.");
    await tx.update(studyEvents).set({ voided: true }).where(eq(studyEvents.id, ev.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.event_voided",
      entityType: "study",
      entityId: ev.studyId,
      summary: `${actor.name} struck out ${EVENT_LABELS[ev.kind as EventKind]} at ${formatDateTime(ev.at)} of ${loaded.equipment.code}`,
      before: { cycle: ev.cycle, kind: ev.kind, at: ev.at.toISOString() },
      reason,
      request,
    });
    await syncStudyStatus(tx, actor, loaded, request);
    await recheckIfData(tx, actor, loaded.study.id);
  });
}

// ---------------------------------------------------------------- pre-calibration

const precalSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1, "Scan or type the logger's ID or serial number.").max(100),
  masterId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  quantity: z.enum(["temperature", "humidity"]).default("temperature"),
  /** 'post': after the study (FT-02), when the loggers are back. */
  phase: z.enum(["pre", "post"]).default("pre"),
  reference: z.unknown(),
  reading: z.unknown(),
});

/** Post-calibration happens once the study is over: on site, or in the lab later. */
// Loggers often come back to the lab days later, while the report is being drafted;
// a failure then opens a deviation and takes the analysis approval back.
const POST_CAL_OK: readonly JobStatus[] = [
  "field_work",
  "data_issue",
  "data_received",
  "analysis",
  "report_draft",
  "rework",
];

export async function recordPrecal(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: unknown,
  request?: RequestInfo,
): Promise<{
  code: string;
  result: "pass" | "fail";
  deviation: string;
  tolerance: number;
  deviationNumber: string | null;
}> {
  const v = precalSchema.parse(input);
  const post = v.phase === "post";
  assertCan(actor, post ? "postcal.record" : "field.perform");
  return db.transaction(async (tx) => {
    const { study, job, equipment: e } = await loadStudy(tx, actor, studyId);
    assertJob(job, post ? POST_CAL_OK : ON_SITE, post ? "Post-calibration" : "Pre-calibration");
    const inst = await findInstrument(tx, actor, v.code);
    const [seen] = await tx.select().from(studyPrecal).where(eq(studyPrecal.id, v.id));
    if (seen) {
      const [dev] = await tx
        .select({ number: deviations.number })
        .from(deviations)
        .where(eq(deviations.precalId, seen.id));
      return {
        code: inst.code,
        result: seen.result as "pass" | "fail",
        deviation: seen.deviation,
        tolerance: Number(seen.tolerance),
        deviationNumber: dev?.number ?? null,
      };
    }
    if (inst.tier === "master")
      throw new FieldError(`${inst.code} is a master standard, not a logger.`);
    const [position] = await tx
      .select({ id: studyPositions.id, label: studyPositions.label })
      .from(studyPositions)
      .where(and(eq(studyPositions.studyId, study.id), eq(studyPositions.instrumentId, inst.id)));
    if (post && !position) {
      throw new FieldError(`${inst.code} wasn't used on the ${e.code} study.`);
    }
    if (post && study.status !== "completed") {
      throw new FieldError(`End the ${e.code} study (Times) before post-calibration.`);
    }
    if (v.masterId) {
      const [m] = await tx
        .select()
        .from(instruments)
        .where(
          and(eq(instruments.id, v.masterId), eq(instruments.organisationId, actor.organisationId)),
        );
      if (!m || m.tier !== "master") throw new FieldError("Pick a master standard.");
      const certs = await certificatesOf(tx, actor.organisationId, [m.id]);
      const today = todayInIndia();
      const ok = validThrough({ ...m, certificates: certs.get(m.id) ?? [] }, today, today);
      if (!ok.ok) throw new FieldError(`Master ${ok.reason}.`);
    }
    const r = evaluatePrecal({
      reference: v.reference,
      reading: v.reading,
      quantity: v.quantity,
      accuracy: inst.effectiveAccuracy,
    });
    if (!r.ok) throw new FieldError(r.message);
    await tx.insert(studyPrecal).values({
      id: v.id,
      organisationId: actor.organisationId,
      studyId: study.id,
      instrumentId: inst.id,
      masterInstrumentId: v.masterId,
      quantity: v.quantity,
      phase: v.phase,
      reference: r.reference,
      reading: r.reading,
      deviation: r.deviation,
      tolerance: String(r.tolerance),
      result: r.result,
      byUserId: actor.id,
    });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: post ? "study.postcal_recorded" : "study.precal_recorded",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} ${post ? "post" : "pre"}-calibrated ${inst.code} for ${e.code}: ${r.result} (deviation ${r.deviation}, ±${r.tolerance})`,
      after: {
        instrument: inst.code,
        phase: v.phase,
        reference: r.reference,
        reading: r.reading,
        deviation: r.deviation,
        result: r.result,
      },
      request,
    });
    // A logger that fails after the study puts its readings in doubt: a deviation opens by itself.
    let deviationNumber: string | null = null;
    if (post && r.result === "fail") {
      const unit = v.quantity === "humidity" ? "%RH" : "°C";
      const dev = await openDeviationTx(
        tx,
        actor,
        {
          studyId: study.id,
          source: "post_cal",
          title: `${inst.code}${position ? ` (${position.label})` : ""} failed post-calibration: ${r.deviation} ${unit} against ±${r.tolerance}`,
          description: `Read ${r.reading} ${unit} against the master's ${r.reference} ${unit} after the study. Its readings during the study may be off by as much.`,
          positionId: position?.id ?? null,
          instrumentId: inst.id,
          precalId: v.id,
          context: `${e.code} (job ${job.number})`,
        },
        request,
      );
      deviationNumber = dev.number;
    }
    return {
      code: inst.code,
      result: r.result,
      deviation: r.deviation,
      tolerance: r.tolerance,
      deviationNumber,
    };
  });
}

// ---------------------------------------------------------------- photos

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Stores the bytes, then attaches them (used where the bytes arrive directly). */
export async function addPhoto(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  studyId: string,
  input: {
    id: string;
    fileName: string;
    bytes: Uint8Array;
    positionLabel?: string;
    caption?: string;
  },
  request?: RequestInfo,
): Promise<{ id: string }> {
  assertCan(actor, "field.perform");
  if (!isUuid(input.id)) throw new FieldError("The phone sent a bad id. Reload the page.");
  // Check the study before storing anything.
  await db.transaction(async (tx) => {
    const { job } = await loadStudy(tx, actor, studyId);
    assertJob(job, ON_SITE, "Adding photos");
  });
  const [seen] = await db
    .select({ id: studyPhotos.id })
    .from(studyPhotos)
    .where(eq(studyPhotos.id, input.id));
  if (seen) return { id: seen.id };
  const stored = await storeFile(db, blobs, {
    organisationId: actor.organisationId,
    actor: user(actor),
    fileName: input.fileName,
    bytes: input.bytes,
    maxBytes: MAX_PHOTO_BYTES,
    request,
  });
  if (!stored.ok) throw new FieldError(stored.message);
  return attachPhoto(db, actor, studyId, { ...input, fileId: stored.file.id }, request);
}

/**
 * Attaches an uploaded photo (already stored through /api/files) to a study.
 * The same id twice attaches it once.
 */
export async function attachPhoto(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: { id: string; fileId: string; positionLabel?: string; caption?: string },
  request?: RequestInfo,
): Promise<{ id: string }> {
  assertCan(actor, "field.perform");
  if (!isUuid(input.id) || !isUuid(input.fileId))
    throw new FieldError("The phone sent a bad id. Reload the page.");
  return db.transaction(async (tx) => {
    const { study, job, equipment: e } = await loadStudy(tx, actor, studyId);
    assertJob(job, ON_SITE, "Adding photos");
    const [seen] = await tx
      .select({ id: studyPhotos.id })
      .from(studyPhotos)
      .where(eq(studyPhotos.id, input.id));
    if (seen) return { id: seen.id };
    const [file] = await tx
      .select({ id: storedFiles.id, fileType: storedFiles.fileType })
      .from(storedFiles)
      .where(
        and(eq(storedFiles.id, input.fileId), eq(storedFiles.organisationId, actor.organisationId)),
      );
    if (!file) throw new FieldError("That photo was not uploaded. Try again.");
    if (file.fileType !== "jpeg" && file.fileType !== "png") {
      throw new FieldError("Only photos (JPEG or PNG) can be added here.");
    }
    await tx.insert(studyPhotos).values({
      id: input.id,
      organisationId: actor.organisationId,
      studyId: study.id,
      fileId: file.id,
      positionLabel: (input.positionLabel ?? "").slice(0, 20),
      caption: (input.caption ?? "").slice(0, 200),
      byUserId: actor.id,
    });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.photo_added",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} added a photo to ${e.code}${input.positionLabel ? ` (${input.positionLabel})` : ""} on job ${job.number}`,
      after: { fileId: file.id },
      request,
    });
    return { id: input.id };
  });
}
