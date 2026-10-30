import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  equipment,
  jobs,
  storedFiles,
  studies,
  studyDataAcceptances,
  studyDataFiles,
  studyDataRequests,
  users,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import type { JobStatus } from "@/domain/jobs/types";

import { dataContext, type DataStatus } from "./data-service";

/** At most this many points per line on the preview chart. */
const CHART_POINTS = 400;

function thin(times: number[], values: (number | null)[], max = CHART_POINTS) {
  const step = Math.max(1, Math.ceil(times.length / max));
  const out: [number, number][] = [];
  for (let i = 0; i < times.length; i += step) {
    const v = values[i];
    if (v !== null && v !== undefined) out.push([times[i]!, v]);
  }
  return out;
}

function stats(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null && x !== undefined);
  if (v.length === 0) return null;
  return {
    min: Math.min(...v),
    max: Math.max(...v),
    avg: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100,
    count: v.length,
  };
}

/** Everything the Data tab shows, checked fresh. */
export async function getStudyData(db: Database, actor: SessionUser, studyId: string) {
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
  const ctx = await dataContext(db, actor.organisationId, study);

  const allFiles = await db
    .select({
      file: studyDataFiles,
      by: users.name,
      sha256: storedFiles.sha256,
      size: storedFiles.sizeBytes,
    })
    .from(studyDataFiles)
    .innerJoin(users, eq(users.id, studyDataFiles.uploadedByUserId))
    .innerJoin(storedFiles, eq(storedFiles.id, studyDataFiles.fileId))
    .where(eq(studyDataFiles.studyId, study.id))
    .orderBy(desc(studyDataFiles.uploadedAt));
  const acceptances = await db
    .select({ a: studyDataAcceptances, by: users.name })
    .from(studyDataAcceptances)
    .innerJoin(users, eq(users.id, studyDataAcceptances.acceptedByUserId))
    .where(eq(studyDataAcceptances.studyId, study.id))
    .orderBy(desc(studyDataAcceptances.acceptedAt));
  const requests = await db
    .select({ r: studyDataRequests, by: users.name })
    .from(studyDataRequests)
    .innerJoin(users, eq(users.id, studyDataRequests.requestedByUserId))
    .where(eq(studyDataRequests.studyId, study.id))
    .orderBy(desc(studyDataRequests.requestedAt));
  const receivedBy = study.dataReceivedByUserId
    ? ((
        await db
          .select({ name: users.name })
          .from(users)
          .where(inArray(users.id, [study.dataReceivedByUserId]))
      )[0]?.name ?? null)
    : null;

  const liveAcceptance = new Map(
    acceptances.filter((x) => !x.a.withdrawnAt).map((x) => [x.a.fingerprint, x]),
  );
  const fileById = new Map(ctx.files.map((f) => [f.id, f]));
  const matchOf = (id: string) => ctx.matches.get(id) ?? { positionId: null, how: "none" as const };

  const positions = ctx.positions.map((p) => {
    const mine = ctx.channels.filter((c) => matchOf(c.id).positionId === p.id);
    const view = (q: "temp" | "rh") => {
      const c = mine.find((x) => x.quantity === q);
      if (!c) return null;
      const f = fileById.get(c.fileId)!;
      return {
        id: c.id,
        file: c.fileName,
        header: c.header,
        how: matchOf(c.id).how,
        stats: stats(c.values),
        series: thin(f.times, c.values),
      };
    };
    return { ...p, temp: view("temp"), rh: view("rh") };
  });

  const others = ctx.channels
    .filter((c) => !matchOf(c.id).positionId)
    .map((c) => ({
      id: c.id,
      file: c.fileName,
      header: c.header,
      serial: c.serial,
      quantity: c.quantity,
      ignored: matchOf(c.id).how === "ignored",
      stats: stats(c.values),
    }));

  // A few rows of the first file as read, to check at a glance.
  const first = ctx.files[0];
  const preview = first
    ? {
        file: first.fileName,
        columns: ctx.channels.filter((c) => c.fileId === first.id).slice(0, 12),
        rows: first.times.slice(0, 8).map((t, i) => ({ t, i })),
      }
    : null;

  const issues = ctx.issues.map((i) => {
    const a = liveAcceptance.get(i.fingerprint);
    return {
      ...i,
      accepted: a ? { id: a.a.id, reason: a.a.reason, by: a.by, at: a.a.acceptedAt } : null,
    };
  });
  const open = issues.filter((i) => i.severity === "blocker" && !i.accepted);

  return {
    study: {
      id: study.id,
      code: row.code,
      jobNumber: row.jobNumber,
      jobStatus: row.jobStatus as JobStatus,
      status: study.status,
      dataStatus: study.dataStatus as DataStatus,
      receivedAt: study.dataReceivedAt,
      receivedBy,
      intervalMinutes: study.intervalMinutes,
      needsRh: study.workType === "temperature_rh_mapping",
    },
    can: {
      import: can(actor, "data.import"),
      accept: can(actor, "data.accept"),
    },
    windows: ctx.windows,
    files: allFiles.map(({ file, by, sha256, size }) => ({
      id: file.id,
      storedFileId: file.fileId,
      name: file.fileName,
      sheet: file.sheet,
      readings: file.times.length,
      first: file.times[0] ?? null,
      last: file.times[file.times.length - 1] ?? null,
      interval: file.intervalMinutes,
      notes: file.notes,
      by,
      at: file.uploadedAt,
      sha256,
      size,
      replaced: file.replacedAt ? { at: file.replacedAt, reason: file.replaceReason } : null,
    })),
    positions,
    others,
    preview,
    issues,
    open: open.length,
    acceptances: acceptances.map(({ a, by }) => ({
      id: a.id,
      message: a.message,
      reason: a.reason,
      by,
      at: a.acceptedAt,
      withdrawn: a.withdrawnAt,
    })),
    requests: requests.map(({ r, by }) => ({
      id: r.id,
      note: r.note,
      by,
      at: r.requestedAt,
      closedAt: r.closedAt,
      closedNote: r.closedNote,
    })),
  };
}
export type StudyData = NonNullable<Awaited<ReturnType<typeof getStudyData>>>;
