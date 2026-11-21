import "server-only";

import { reads } from "@/db/reads";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Database, Transaction } from "@/db/client-factory";
import {
  equipment,
  instruments,
  storedFiles,
  studies,
  studyDataAcceptances,
  studyDataChannels,
  studyDataFiles,
  studyDataIssues,
  studyDataRequests,
  studyEvents,
  studyPositions,
  users,
  type Job,
  type Study,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { cycleProgress, cyclesOf, studyStatusFrom } from "@/domain/field/field-service";
import { STUDY_FLOW, type StudyStatus } from "@/domain/field/types";
import { lockJob, readinessInputFor, setStatus } from "@/domain/jobs/job-service";
import { computeReadiness } from "@/domain/jobs/readiness";
import { JOB_STATUS_LABELS, type JobStatus } from "@/domain/jobs/types";
import { recordAudit } from "@/lib/audit";
import { machine, move } from "@/lib/state-machine";
import { formatDateTime } from "@/lib/format";
import type { BlobStore } from "@/lib/storage/blob-store";
import { shortList } from "@/lib/text";

import { checkData, intervalOf, type ChannelInfo, type PositionInfo } from "./checks";
import { DataError } from "./errors";
import { readGrid } from "./grid";
import { parseWorkbook } from "./parse";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

/** Job statuses in which data can be uploaded and checked. */
const DATA_OPEN: readonly JobStatus[] = ["field_work", "data_issue", "data_received", "analysis"];

export const DATA_STATUSES = ["none", "issues", "checked", "received"] as const;
export type DataStatus = (typeof DATA_STATUSES)[number];
/**
 * A study's data (ADR 0022): every upload or acceptance rechecks it to none,
 * issues or checked; only checked data is confirmed received; any change after
 * that takes the confirmation back.
 */
export const DATA_FLOW = machine<DataStatus>("study's data", DATA_STATUSES, {
  none: ["issues", "checked"],
  issues: ["none", "checked"],
  checked: ["none", "issues", "received"],
  received: ["none", "issues", "checked"],
});

type Loaded = { study: Study; job: Job; code: string };

async function load(tx: Transaction, actor: SessionUser, studyId: string): Promise<Loaded> {
  if (!isUuid(studyId)) throw new DataError("That study does not exist.");
  const [row] = await tx
    .select({ study: studies, code: equipment.code })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) throw new DataError("That study does not exist.");
  const job = await lockJob(tx, actor, row.study.jobId);
  await tx.select({ id: studies.id }).from(studies).where(eq(studies.id, studyId)).for("update");
  return { study: row.study, job, code: row.code };
}

/**
 * Data can be worked on while the job is in the field or after. Uploading the
 * data and setting the study period also work on a Ready job (QA Tech, Nov
 * 2026: the data comes first, and the period is chosen from it), and move the
 * job into field work; nobody has to have tapped Start on site.
 */
function assertOpen(l: Loaded, what: string, opensFieldWork = false) {
  const s = l.job.status as JobStatus;
  if (!DATA_OPEN.includes(s) && !(opensFieldWork && s === "ready")) {
    throw new DataError(
      `${what} isn't possible while job ${l.job.number} is ${JOB_STATUS_LABELS[s]?.toLowerCase() ?? s}.`,
    );
  }
}

/** A Ready job goes into field work when its first data or period comes in. */
async function openFieldWork(
  tx: Transaction,
  actor: SessionUser,
  l: Loaded,
  why: string,
  request?: RequestInfo,
) {
  if (l.job.status !== "ready") return;
  const readiness = computeReadiness(await readinessInputFor(tx, actor.organisationId, l.job));
  if (!readiness.ready) {
    throw new DataError(
      `Job ${l.job.number} isn't ready for field work: ${readiness.items
        .filter((i) => i.state === "pending" && i.blocking)
        .map((i) => i.label)
        .join(", ")}.`,
    );
  }
  await setStatus(tx, actor, l.job, "field_work", why, request);
}

// ---------------------------------------------------------------- the check

/** Everything the checks need about a study, from the database. */
export async function dataContext(
  tx: Transaction | Database,
  organisationId: string,
  study: Study,
) {
  // Independent reads go out together: on a distant database each round trip costs ~250 ms.
  // A transaction's single connection still runs them one after another, which is fine.
  // The channels come in the same round, by a subquery of the study's current files.
  const current = tx
    .select({ id: studyDataFiles.id })
    .from(studyDataFiles)
    .where(and(eq(studyDataFiles.studyId, study.id), isNull(studyDataFiles.replacedAt)));
  const [positions, files, events, channels] = await reads(tx, [
    () =>
      tx
        .select({
          id: studyPositions.id,
          label: studyPositions.label,
          ambient: studyPositions.ambient,
          code: instruments.code,
          serialNo: instruments.serialNo,
        })
        .from(studyPositions)
        .leftJoin(instruments, eq(instruments.id, studyPositions.instrumentId))
        .where(
          and(
            eq(studyPositions.studyId, study.id),
            eq(studyPositions.organisationId, organisationId),
          ),
        )
        .orderBy(asc(studyPositions.sort)),
    () =>
      tx
        .select()
        .from(studyDataFiles)
        .where(and(eq(studyDataFiles.studyId, study.id), isNull(studyDataFiles.replacedAt)))
        .orderBy(asc(studyDataFiles.uploadedAt)),
    () => tx.select().from(studyEvents).where(eq(studyEvents.studyId, study.id)),
    () =>
      tx
        .select()
        .from(studyDataChannels)
        .where(inArray(studyDataChannels.dataFileId, current))
        .orderBy(asc(studyDataChannels.column)),
  ]);
  const thermal = study.workType === "thermal_validation";
  const cycles = cycleProgress(cyclesOf(study), events, thermal);

  const positionInfo: PositionInfo[] = positions.map((p) => ({
    id: p.id,
    label: p.label,
    ambient: p.ambient,
    logger: p.code ? { code: p.code, serialNo: p.serialNo ?? "" } : null,
  }));
  const fileName = new Map(files.map((f) => [f.id, f.fileName]));
  const channelInfo: ChannelInfo[] = channels.map((c) => ({
    id: c.id,
    fileId: c.dataFileId,
    fileName: fileName.get(c.dataFileId) ?? "",
    header: c.header,
    serial: c.serial,
    quantity: c.quantity as "temp" | "rh",
    manual:
      c.ignored || c.manualPositionId
        ? { positionId: c.manualPositionId, ignored: c.ignored }
        : null,
    values: c.values as (number | null)[],
    unreadable: c.unreadable,
  }));
  const result = checkData({
    positions: positionInfo,
    files: files.map((f) => ({
      id: f.id,
      name: f.fileName,
      times: f.times,
      badTimeRows: f.badTimeRows,
    })),
    channels: channelInfo,
    windows: cycles.map((c) => ({
      cycle: c.cycle,
      label: c.label,
      start: c.startedAt?.getTime() ?? null,
      end: c.endedAt?.getTime() ?? null,
    })),
    intervalMinutes: study.intervalMinutes,
    needsRh: study.workType === "temperature_rh_mapping",
  });
  // No file yet: nothing to check (every logger would show as "missing").
  if (files.length === 0) result.issues = [];
  return { positions: positionInfo, files, channels: channelInfo, cycles, ...result };
}

/**
 * Rechecks a study's data after any change, stores the issues, and moves
 * the study's data status and the job's status to match.
 */
async function recheck(tx: Transaction, actor: SessionUser, l: Loaded, request?: RequestInfo) {
  const ctx = await dataContext(tx, actor.organisationId, l.study);
  await tx.delete(studyDataIssues).where(eq(studyDataIssues.studyId, l.study.id));
  if (ctx.issues.length > 0) {
    await tx.insert(studyDataIssues).values(
      ctx.issues.map((i) => ({
        organisationId: actor.organisationId,
        studyId: l.study.id,
        fingerprint: i.fingerprint,
        kind: i.kind,
        severity: i.severity,
        message: i.message,
        cycle: i.cycle,
        positionId: i.positionId,
      })),
    );
  }
  const accepted = new Set(
    (
      await tx
        .select({ fingerprint: studyDataAcceptances.fingerprint })
        .from(studyDataAcceptances)
        .where(
          and(
            eq(studyDataAcceptances.studyId, l.study.id),
            isNull(studyDataAcceptances.withdrawnAt),
          ),
        )
    ).map((a) => a.fingerprint),
  );
  const open = ctx.issues.filter((i) => i.severity === "blocker" && !accepted.has(i.fingerprint));
  const status: DataStatus =
    ctx.files.length === 0 ? "none" : open.length > 0 ? "issues" : "checked";
  await tx
    .update(studies)
    .set({
      dataStatus:
        status === l.study.dataStatus
          ? status
          : move(DATA_FLOW, l.study.dataStatus as DataStatus, status),
      dataReceivedAt: null,
      dataReceivedByUserId: null,
    })
    .where(eq(studies.id, l.study.id));
  l.study = { ...l.study, dataStatus: status, dataReceivedAt: null, dataReceivedByUserId: null };
  await syncJob(tx, actor, l.job, request);
  return { ...ctx, open, status };
}

/**
 * The job follows its studies' data: any study with an open problem or an
 * open request → Data issue; every study received → Data received; else
 * back to Field work.
 */
async function syncJob(tx: Transaction, actor: SessionUser, job: Job, request?: RequestInfo) {
  const from = job.status as JobStatus;
  if (!DATA_OPEN.includes(from)) return;
  const all = await tx
    .select({ id: studies.id, dataStatus: studies.dataStatus, status: studies.status })
    .from(studies)
    .where(eq(studies.jobId, job.id));
  const requests = await tx
    .select({ id: studyDataRequests.id })
    .from(studyDataRequests)
    .where(
      and(
        inArray(
          studyDataRequests.studyId,
          all.map((s) => s.id),
        ),
        isNull(studyDataRequests.closedAt),
      ),
    );
  const to: JobStatus =
    all.some((s) => s.dataStatus === "issues") || requests.length > 0
      ? "data_issue"
      : all.length > 0 && all.every((s) => s.dataStatus === "received")
        ? "data_received"
        : "field_work";
  if (to === from) return;
  // Analysis has started: it stays there while the data is complete (a rerun will follow).
  if (from === "analysis" && to === "data_received") return;
  const why =
    to === "data_issue"
      ? "Data has problems to resolve"
      : to === "data_received"
        ? "Every study's data received and checked"
        : "Data problems resolved; waiting for the rest";
  await setStatus(tx, actor, job, to, why, request);
  job.status = to;
}

/**
 * After a change on site that moves the windows or the loggers (a time
 * struck out, a logger moved), data already uploaded is checked again.
 */
export async function recheckIfData(tx: Transaction, actor: SessionUser, studyId: string) {
  const [has] = await tx
    .select({ id: studyDataFiles.id })
    .from(studyDataFiles)
    .where(and(eq(studyDataFiles.studyId, studyId), isNull(studyDataFiles.replacedAt)))
    .limit(1);
  if (!has) return;
  const l = await load(tx, actor, studyId);
  await recheck(tx, actor, l);
}

/** The name of a current file with exactly these readings, if any. */
async function sameReadings(
  tx: Transaction,
  studyId: string,
  times: number[],
  channels: { serial: string | null; quantity: string; values: (number | null)[] }[],
): Promise<string | null> {
  const key = (c: { serial: string | null; quantity: string; values: (number | null)[] }) =>
    `${c.serial}|${c.quantity}|${c.values.join(",")}`;
  const mine = channels.map(key).sort().join("\n");
  const files = await tx
    .select({ id: studyDataFiles.id, name: studyDataFiles.fileName, times: studyDataFiles.times })
    .from(studyDataFiles)
    .where(and(eq(studyDataFiles.studyId, studyId), isNull(studyDataFiles.replacedAt)));
  for (const f of files) {
    if (f.times.length !== times.length || f.times.some((t, i) => t !== times[i])) continue;
    const cols = await tx
      .select({
        serial: studyDataChannels.serial,
        quantity: studyDataChannels.quantity,
        values: studyDataChannels.values,
      })
      .from(studyDataChannels)
      .where(eq(studyDataChannels.dataFileId, f.id));
    if (
      cols
        .map((c) => key(c as never))
        .sort()
        .join("\n") === mine
    )
      return f.name;
  }
  return null;
}

// ---------------------------------------------------------------- upload

export type AddResult = {
  dataFileId: string;
  sheet: string;
  readings: number;
  channels: number;
  matched: number;
  notes: string[];
  status: DataStatus;
  blockers: number;
};

/**
 * Reads an uploaded logger export (already stored with its hash) into the
 * study. With `replaces`, the old file is kept in the history, marked
 * replaced with the reason.
 */
export async function addDataFile(
  db: Database,
  store: BlobStore,
  actor: SessionUser,
  studyId: string,
  input: { fileId: string; fileName?: string; replaces?: string; reason?: string },
  request?: RequestInfo,
): Promise<AddResult> {
  assertCan(actor, "data.import");
  if (!isUuid(input.fileId)) throw new DataError("That file was not uploaded. Try again.");
  if (input.replaces && !isUuid(input.replaces)) throw new DataError("Pick the file to replace.");
  const reason = (input.reason ?? "").trim();
  if (input.replaces && reason.length < 5) {
    throw new DataError("Say why the file is being replaced (at least 5 characters).");
  }
  const [file] = await db
    .select()
    .from(storedFiles)
    .where(
      and(eq(storedFiles.id, input.fileId), eq(storedFiles.organisationId, actor.organisationId)),
    );
  if (!file) throw new DataError("That file was not uploaded. Try again.");
  if (file.fileType !== "xlsx" && file.fileType !== "csv") {
    throw new DataError("Upload the logger data as an Excel (.xlsx) or CSV file.");
  }
  const name = (input.fileName ?? file.firstFileName).slice(0, 200);
  // Read the file outside the transaction: it can take a moment.
  const grid = await readGrid(await store.get(file.storageKey), name);
  if (!grid.ok) throw new DataError(grid.error);
  const parsed = parseWorkbook(grid.sheets);
  if (!parsed.ok) throw new DataError(`${name}: ${parsed.error}`);
  const p = parsed.best;

  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Uploading data", true);
    await openFieldWork(tx, actor, l, `Logger data uploaded for ${l.code}`, request);
    let replaced: { id: string; fileName: string } | null = null;
    if (input.replaces) {
      const [old] = await tx
        .select({ id: studyDataFiles.id, fileName: studyDataFiles.fileName })
        .from(studyDataFiles)
        .where(
          and(
            eq(studyDataFiles.id, input.replaces),
            eq(studyDataFiles.studyId, l.study.id),
            isNull(studyDataFiles.replacedAt),
          ),
        );
      if (!old) throw new DataError("That file isn't on this study any more. Reload the page.");
      replaced = old;
      await tx
        .update(studyDataFiles)
        .set({ replacedAt: new Date(), replacedByUserId: actor.id, replaceReason: reason })
        .where(eq(studyDataFiles.id, old.id));
    } else {
      // The same file twice is almost always a slip: say so instead of doubling the data.
      const [same] = await tx
        .select({ fileName: studyDataFiles.fileName })
        .from(studyDataFiles)
        .where(
          and(
            eq(studyDataFiles.studyId, l.study.id),
            eq(studyDataFiles.fileId, file.id),
            isNull(studyDataFiles.replacedAt),
          ),
        );
      if (same) throw new DataError(`${same.fileName} is already on this study.`);
      // The same readings saved again (re-exported, re-saved by Excel, sent twice).
      const twin = await sameReadings(tx, l.study.id, p.times, p.channels);
      if (twin) {
        throw new DataError(
          `${name} has the same readings as ${twin}, already on this study. To use it instead, replace ${twin}.`,
        );
      }
    }

    const [row] = await tx
      .insert(studyDataFiles)
      .values({
        organisationId: actor.organisationId,
        studyId: l.study.id,
        fileId: file.id,
        fileName: name,
        sheet: p.sheet,
        times: p.times,
        firstDataRow: p.firstDataRow,
        lastDataRow: p.lastDataRow,
        intervalMinutes: intervalOf(p.times),
        notes: p.notes,
        badTimeRows: p.badTimeRows,
        uploadedByUserId: actor.id,
      })
      .returning({ id: studyDataFiles.id });
    const unreadableBy = new Map<number, number[]>();
    for (const u of p.unreadable) {
      const idx = p.sourceRows.indexOf(u.row);
      if (idx < 0) continue;
      unreadableBy.set(u.column, [...(unreadableBy.get(u.column) ?? []), idx]);
    }
    await tx.insert(studyDataChannels).values(
      p.channels.map((c) => ({
        organisationId: actor.organisationId,
        dataFileId: row!.id,
        column: c.column,
        header: c.header.slice(0, 200),
        serial: c.serial,
        quantity: c.quantity,
        ambient: c.ambient,
        values: c.values as number[],
        unreadable: unreadableBy.get(c.column) ?? [],
      })),
    );

    // New data answers any open request for it.
    const openRequests = await tx
      .update(studyDataRequests)
      .set({ closedAt: new Date(), closedByUserId: actor.id, closedNote: `${name} uploaded` })
      .where(and(eq(studyDataRequests.studyId, l.study.id), isNull(studyDataRequests.closedAt)))
      .returning({ id: studyDataRequests.id });

    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: replaced ? "study.data_replaced" : "study.data_uploaded",
      entityType: "study",
      entityId: l.study.id,
      summary: replaced
        ? `${actor.name} replaced ${replaced.fileName} with ${name} for ${l.code} (job ${l.job.number}): ${reason}`
        : `${actor.name} uploaded ${name} for ${l.code} (job ${l.job.number}): ${p.channels.length} columns × ${p.times.length} readings`,
      after: {
        fileId: file.id,
        sha256: file.sha256,
        sheet: p.sheet,
        readings: p.times.length,
        channels: p.channels.length,
        closedRequests: openRequests.length,
      },
      request,
    });

    const r = await recheck(tx, actor, l, request);
    const matched = r.channels.filter(
      (c) => c.fileId === row!.id && r.matches.get(c.id)?.positionId,
    ).length;
    return {
      dataFileId: row!.id,
      sheet: p.sheet,
      readings: p.times.length,
      channels: p.channels.length,
      matched,
      notes: p.notes,
      status: r.status,
      blockers: r.open.length,
    };
  });
}

/**
 * Takes a file off the study (uploaded by mistake, wrong study). It stays in
 * the history with the reason, like a replaced file; nothing is deleted.
 */
export async function removeDataFile(
  db: Database,
  actor: SessionUser,
  studyId: string,
  dataFileId: string,
  reasonIn: string,
  request?: RequestInfo,
) {
  assertCan(actor, "data.import");
  if (!isUuid(dataFileId)) throw new DataError("That file does not exist.");
  const reason = (reasonIn ?? "").trim();
  if (reason.length < 5) throw new DataError("Say why it's being removed (at least 5 characters).");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Removing a file");
    const [f] = await tx
      .update(studyDataFiles)
      .set({
        replacedAt: new Date(),
        replacedByUserId: actor.id,
        replaceReason: `Removed: ${reason}`,
      })
      .where(
        and(
          eq(studyDataFiles.id, dataFileId),
          eq(studyDataFiles.studyId, l.study.id),
          isNull(studyDataFiles.replacedAt),
        ),
      )
      .returning({ fileName: studyDataFiles.fileName });
    if (!f) throw new DataError("That file isn't on this study any more. Reload the page.");
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_removed",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} removed ${f.fileName} from ${l.code} (job ${l.job.number}): ${reason}`,
      after: { dataFileId, reason },
      request,
    });
    const r = await recheck(tx, actor, l, request);
    return { status: r.status, blockers: r.open.length };
  });
}

// ---------------------------------------------------------------- matching

/** A person assigns a column to a position, or ignores it (or undoes either). */
export async function setChannelMatch(
  db: Database,
  actor: SessionUser,
  studyId: string,
  channelId: string,
  input: { positionId: string | null; ignored: boolean },
  request?: RequestInfo,
) {
  assertCan(actor, "data.import");
  if (!isUuid(channelId)) throw new DataError("That column does not exist.");
  if (input.positionId && !isUuid(input.positionId)) throw new DataError("Pick a position.");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Matching columns");
    const [ch] = await tx
      .select({
        id: studyDataChannels.id,
        header: studyDataChannels.header,
        file: studyDataFiles.fileName,
      })
      .from(studyDataChannels)
      .innerJoin(studyDataFiles, eq(studyDataFiles.id, studyDataChannels.dataFileId))
      .where(
        and(
          eq(studyDataChannels.id, channelId),
          eq(studyDataFiles.studyId, l.study.id),
          isNull(studyDataFiles.replacedAt),
        ),
      );
    if (!ch) throw new DataError("That column isn't on this study. Reload the page.");
    let label = "";
    if (input.positionId) {
      const [pos] = await tx
        .select({ label: studyPositions.label })
        .from(studyPositions)
        .where(
          and(eq(studyPositions.id, input.positionId), eq(studyPositions.studyId, l.study.id)),
        );
      if (!pos) throw new DataError("That position isn't on this study.");
      label = pos.label;
    }
    const auto = !input.positionId && !input.ignored;
    await tx
      .update(studyDataChannels)
      .set({
        manualPositionId: input.ignored ? null : input.positionId,
        ignored: input.ignored,
        manualByUserId: auto ? null : actor.id,
        manualAt: auto ? null : new Date(),
      })
      .where(eq(studyDataChannels.id, ch.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_matched",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} ${
        input.ignored
          ? `ignored “${ch.header}”`
          : auto
            ? `reset the match of “${ch.header}”`
            : `matched “${ch.header}” to ${label}`
      } in ${ch.file} (${l.code}, job ${l.job.number})`,
      after: input,
      request,
    });
    const r = await recheck(tx, actor, l, request);
    return { status: r.status, blockers: r.open.length };
  });
}

// ---------------------------------------------------------------- study period

/** "2026-08-01T11:30" in India time → the instant. */
const fromIst = (text: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const d = new Date(`${text}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Sets when a cycle ran, typed after the data is in (QA Tech, Nov 2026): "read
 * the study from 01.08.2026 11:30 to 02.08.2026 11:30". The cycle's recorded
 * start and end are struck out with the reason and the typed ones recorded,
 * so the readings between them are what the checks and the analysis use.
 * Door and power marks inside stay. Team leader or manager.
 */
export async function setStudyPeriod(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: { cycle: string; start: string; end: string; reason: string },
  request?: RequestInfo,
) {
  assertCan(actor, "data.accept");
  const start = fromIst(input.start);
  const end = fromIst(input.end);
  if (!start || !end) throw new DataError("Enter the start and the end as a date and a time.");
  if (end <= start) throw new DataError("The end must be after the start.");
  if (end.getTime() - start.getTime() > 60 * 86_400_000) {
    throw new DataError("That is more than 60 days: check the dates.");
  }
  const reason = input.reason.trim().slice(0, 300);
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Setting the study period", true);
    await openFieldWork(tx, actor, l, `Study period of ${l.code} set from the data`, request);
    const thermal = l.study.workType === "thermal_validation";
    const cycles = cyclesOf(l.study);
    if (!cycles.includes(input.cycle as (typeof cycles)[number])) {
      throw new DataError("That cycle isn't part of this study.");
    }
    const events = await tx
      .select()
      .from(studyEvents)
      .where(and(eq(studyEvents.studyId, l.study.id), eq(studyEvents.voided, false)));
    // Another cycle's period can't overlap this one: one condition at a time.
    const others = cycleProgress(cycles, events, thermal).filter(
      (c) => c.cycle !== input.cycle && c.startedAt,
    );
    const clash = others.find(
      (c) => start < (c.endedAt ?? new Date(8.64e15)) && end > (c.startedAt as Date),
    );
    if (clash) {
      throw new DataError(
        `${clash.label} ran ${formatDateTime(clash.startedAt!)}${clash.endedAt ? ` to ${formatDateTime(clash.endedAt)}` : ""}; the periods can't overlap.`,
      );
    }
    const old = events.filter(
      (e) => e.cycle === input.cycle && (e.kind === "start" || e.kind === "end"),
    );
    const was = cycleProgress(cycles, events, thermal).find((c) => c.cycle === input.cycle)!;
    if (old.length > 0 && !reason) {
      throw new DataError("Say why the times change, e.g. “logger clocks started at 11:30”.");
    }
    if (old.length > 0) {
      await tx
        .update(studyEvents)
        .set({ voided: true })
        .where(
          inArray(
            studyEvents.id,
            old.map((e) => e.id),
          ),
        );
    }
    const note = reason
      ? `Study period set from the data: ${reason}`
      : "Study period set from the data";
    await tx.insert(studyEvents).values([
      {
        id: crypto.randomUUID(),
        organisationId: actor.organisationId,
        studyId: l.study.id,
        cycle: input.cycle,
        kind: "start",
        at: start,
        note,
        byUserId: actor.id,
      },
      {
        id: crypto.randomUUID(),
        organisationId: actor.organisationId,
        studyId: l.study.id,
        cycle: input.cycle,
        kind: "end",
        at: end,
        note,
        byUserId: actor.id,
      },
    ]);
    // The status follows the events, as on site: done only when every cycle has ended.
    const now = studyStatusFrom(
      l.study,
      await tx.select().from(studyEvents).where(eq(studyEvents.studyId, l.study.id)),
    );
    if (now !== l.study.status) {
      await tx
        .update(studies)
        .set({ status: move(STUDY_FLOW, l.study.status as StudyStatus, now) })
        .where(eq(studies.id, l.study.id));
      l.study = { ...l.study, status: now };
    }
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.period_set",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} set ${was.label.toLowerCase()} of ${l.code} (job ${l.job.number}) to ${formatDateTime(start)} – ${formatDateTime(end)}${was.startedAt ? `, was ${formatDateTime(was.startedAt)} – ${was.endedAt ? formatDateTime(was.endedAt) : "not ended"}` : ""}${reason ? `: ${reason}` : ""}`,
      before: { start: was.startedAt, end: was.endedAt },
      after: { start, end, reason },
      request,
    });
    const r = await recheck(tx, actor, l, request);
    return { status: r.status, blockers: r.open.length };
  });
}

// ---------------------------------------------------------------- decisions

/** Go on despite a problem, with a reason (team leader or manager). */
export async function acceptIssue(
  db: Database,
  actor: SessionUser,
  studyId: string,
  fingerprint: string,
  reasonIn: string,
  request?: RequestInfo,
) {
  assertCan(actor, "data.accept");
  const reason = (reasonIn ?? "").trim();
  if (reason.length < 5) throw new DataError("Give the reason (at least 5 characters).");
  if (reason.length > 500) throw new DataError("Keep the reason under 500 characters.");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Accepting a problem");
    const [issue] = await tx
      .select()
      .from(studyDataIssues)
      .where(
        and(eq(studyDataIssues.studyId, l.study.id), eq(studyDataIssues.fingerprint, fingerprint)),
      );
    if (!issue) throw new DataError("That problem is no longer there. Reload the page.");
    if (issue.severity === "info") throw new DataError("That is information only.");
    const [already] = await tx
      .select({ id: studyDataAcceptances.id })
      .from(studyDataAcceptances)
      .where(
        and(
          eq(studyDataAcceptances.studyId, l.study.id),
          eq(studyDataAcceptances.fingerprint, fingerprint),
          isNull(studyDataAcceptances.withdrawnAt),
        ),
      );
    if (already) throw new DataError("That problem is already accepted.");
    await tx.insert(studyDataAcceptances).values({
      organisationId: actor.organisationId,
      studyId: l.study.id,
      fingerprint,
      message: issue.message,
      reason,
      acceptedByUserId: actor.id,
    });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_issue_accepted",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} accepted on ${l.code} (job ${l.job.number}): ${issue.message} Reason: ${reason}`,
      after: { fingerprint, message: issue.message, reason },
      request,
    });
    const r = await recheck(tx, actor, l, request);
    return { status: r.status, blockers: r.open.length };
  });
}

export async function withdrawAcceptance(
  db: Database,
  actor: SessionUser,
  studyId: string,
  acceptanceId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "data.accept");
  if (!isUuid(acceptanceId)) throw new DataError("That decision does not exist.");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Withdrawing a decision");
    const [a] = await tx
      .update(studyDataAcceptances)
      .set({ withdrawnAt: new Date(), withdrawnByUserId: actor.id })
      .where(
        and(
          eq(studyDataAcceptances.id, acceptanceId),
          eq(studyDataAcceptances.studyId, l.study.id),
          isNull(studyDataAcceptances.withdrawnAt),
        ),
      )
      .returning();
    if (!a) throw new DataError("That decision is already withdrawn.");
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_issue_withdrawn",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} withdrew the acceptance on ${l.code} (job ${l.job.number}): ${a.message}`,
      before: { reason: a.reason },
      request,
    });
    const r = await recheck(tx, actor, l, request);
    return { status: r.status, blockers: r.open.length };
  });
}

/** Ask the site for missing or corrected data; the next upload closes it. */
export async function requestData(
  db: Database,
  actor: SessionUser,
  studyId: string,
  noteIn: string,
  request?: RequestInfo,
) {
  assertCan(actor, "data.accept");
  const note = (noteIn ?? "").trim();
  if (note.length < 3) throw new DataError("Say what is needed.");
  if (note.length > 1000) throw new DataError("Keep the request under 1000 characters.");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Asking for data");
    await tx.insert(studyDataRequests).values({
      organisationId: actor.organisationId,
      studyId: l.study.id,
      note,
      requestedByUserId: actor.id,
    });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_requested",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} asked for data for ${l.code} (job ${l.job.number}): ${note}`,
      after: { note },
      request,
    });
    await syncJob(tx, actor, l.job, request);
    return { ok: true as const };
  });
}

/** Closes a request without new data (it was sorted out another way). */
export async function closeRequest(
  db: Database,
  actor: SessionUser,
  studyId: string,
  requestId: string,
  noteIn: string,
  request?: RequestInfo,
) {
  assertCan(actor, "data.accept");
  if (!isUuid(requestId)) throw new DataError("That request does not exist.");
  const note = (noteIn ?? "").trim();
  if (note.length < 3) throw new DataError("Say how it was sorted out.");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    const [r] = await tx
      .update(studyDataRequests)
      .set({ closedAt: new Date(), closedByUserId: actor.id, closedNote: note.slice(0, 500) })
      .where(
        and(
          eq(studyDataRequests.id, requestId),
          eq(studyDataRequests.studyId, l.study.id),
          isNull(studyDataRequests.closedAt),
        ),
      )
      .returning();
    if (!r) throw new DataError("That request is already closed.");
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_request_closed",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} closed the data request for ${l.code} (job ${l.job.number}): ${note}`,
      before: { note: r.note },
      request,
    });
    await syncJob(tx, actor, l.job, request);
    return { ok: true as const };
  });
}

/**
 * A person confirms the study's data is complete and right. Offered only
 * when nothing is open; when every study on the job is received, the job
 * moves to Data received.
 */
export async function markReceived(
  db: Database,
  actor: SessionUser,
  studyId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "data.accept");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    assertOpen(l, "Confirming data");
    if (l.study.status !== "completed") {
      throw new DataError(
        `Set the start and end of the ${l.code} study (Start & end) before confirming its data.`,
      );
    }
    if (l.study.dataStatus === "received") {
      // Two people (or two tabs) confirming at once: the second is told, not recorded twice.
      const [by] = l.study.dataReceivedByUserId
        ? await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, l.study.dataReceivedByUserId))
        : [];
      throw new DataError(
        `${l.code}'s data was already confirmed${by ? ` by ${by.name}` : ""}${l.study.dataReceivedAt ? ` at ${formatDateTime(l.study.dataReceivedAt)}` : ""}.`,
      );
    }
    const r = await recheck(tx, actor, l, request);
    if (r.status === "none") throw new DataError("No data has been uploaded for this study.");
    if (r.open.length > 0) {
      throw new DataError(
        `${r.open.length} problem${r.open.length === 1 ? "" : "s"} still open: ${shortList(r.open.map((i) => i.message))}`,
      );
    }
    const [req] = await tx
      .select({ id: studyDataRequests.id })
      .from(studyDataRequests)
      .where(and(eq(studyDataRequests.studyId, l.study.id), isNull(studyDataRequests.closedAt)));
    if (req) throw new DataError("A request for data is still open. Close it first.");
    await tx
      .update(studies)
      .set({
        dataStatus: move(DATA_FLOW, r.status, "received"),
        dataReceivedAt: new Date(),
        dataReceivedByUserId: actor.id,
      })
      .where(eq(studies.id, l.study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "study.data_received",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} confirmed the data of ${l.code} (job ${l.job.number}): ${r.files.length} file${r.files.length === 1 ? "" : "s"}, ${r.positions.filter((p) => p.logger).length} positions`,
      after: {
        files: r.files.map((f) => f.fileName),
        accepted: r.issues.filter((i) => i.severity === "blocker").length,
      },
      request,
    });
    await syncJob(tx, actor, l.job, request);
    return { jobStatus: l.job.status as JobStatus };
  });
}
