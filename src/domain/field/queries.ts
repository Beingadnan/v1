import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  clientDepartments,
  clientSites,
  equipment,
  instruments,
  jobInstruments,
  jobTeam,
  jobs,
  organisationSettings,
  storedFiles,
  studies,
  studyDataRequests,
  studyEvents,
  studyPhotos,
  studyPositions,
  studyPrecal,
  users,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { todayInIndia } from "@/domain/clients/requalification";
import type { StudyCycle } from "@/domain/clients/study-defaults";
import { certificatesOf } from "@/domain/instruments/certificate-service";
import { certificateCovering } from "@/domain/instruments/validity";
import type { JobStatus } from "@/domain/jobs/types";
import type { BlobStore } from "@/lib/storage/blob-store";

import { cycleProgress } from "./field-service";
import { renderFt12 } from "./ft12-pdf";
import { ROUTINE, type CycleKey, type StudyStatus } from "./types";

const FIELD_JOBS: JobStatus[] = ["ready", "field_work", "data_issue"];

export type MyStudy = {
  id: string;
  status: StudyStatus;
  jobId: string;
  jobNumber: string;
  jobStatus: JobStatus;
  companyName: string;
  siteName: string;
  equipmentCode: string;
  equipmentName: string;
  department: string | null;
  plannedStart: string;
  plannedEnd: string;
  positions: number;
  placed: number;
  loggerCount: number;
  today: boolean;
  dataStatus: string;
  /** The oldest open request for data, if the office is waiting on the site. */
  request: string | null;
};

/**
 * Studies to work on: jobs that are Ready or in Field Work, where I'm on the
 * team (or all, for those who plan). Today's visits first.
 */
export async function myStudies(
  db: Database,
  actor: SessionUser,
  options: { everyone?: boolean } = {},
): Promise<MyStudy[]> {
  // Engineers on site, and whoever sends the data in (often a preparer in the office).
  assertCan(actor, "data.import");
  const everyone = options.everyone && can(actor, "jobs.manage");
  const rows = await db
    .select({
      id: studies.id,
      status: studies.status,
      jobId: jobs.id,
      jobNumber: jobs.number,
      jobStatus: jobs.status,
      companyName: clientCompanies.name,
      siteName: clientSites.name,
      equipmentCode: equipment.code,
      equipmentName: equipment.name,
      department: clientDepartments.name,
      plannedStart: jobs.plannedStart,
      plannedEnd: jobs.plannedEnd,
      loggerCount: studies.loggerCount,
      positions: sql<number>`(select count(*)::int from ${studyPositions} p where p.study_id = ${studies.id})`,
      placed: sql<number>`(select count(*)::int from ${studyPositions} p where p.study_id = ${studies.id} and p.instrument_id is not null)`,
      dataStatus: studies.dataStatus,
      request: sql<
        string | null
      >`(select r.note from ${studyDataRequests} r where r.study_id = ${studies.id} and r.closed_at is null order by r.requested_at limit 1)`,
    })
    .from(studies)
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(
      and(
        eq(studies.organisationId, actor.organisationId),
        inArray(jobs.status, FIELD_JOBS),
        everyone
          ? undefined
          : sql`exists (select 1 from ${jobTeam} t where t.job_id = ${jobs.id} and t.user_id = ${actor.id})`,
      ),
    )
    .orderBy(asc(jobs.plannedStart), asc(jobs.number), asc(studies.position))
    .limit(300);
  const today = todayInIndia();
  const mapped = rows.map((r) => ({
    ...r,
    status: r.status as StudyStatus,
    jobStatus: r.jobStatus as JobStatus,
    today: r.plannedStart <= today && r.plannedEnd >= today,
  }));
  // Data asked for first, then today's, then by date; finished studies last.
  const rank = (s: MyStudy) => (s.request ? -1 : s.status === "completed" ? 2 : s.today ? 0 : 1);
  return mapped.sort((a, b) => rank(a) - rank(b));
}

export async function getFieldStudy(db: Database, actor: SessionUser, studyId: string) {
  assertCan(actor, "jobs.view");
  if (!/^[0-9a-f-]{36}$/i.test(studyId)) return null;
  const [row] = await db
    .select({
      study: studies,
      job: jobs,
      equipment,
      companyName: clientCompanies.name,
      siteName: clientSites.name,
      department: clientDepartments.name,
    })
    .from(studies)
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) return null;
  const { study, job } = row;

  const positions = await db
    .select({
      id: studyPositions.id,
      label: studyPositions.label,
      sort: studyPositions.sort,
      x: studyPositions.x,
      y: studyPositions.y,
      z: studyPositions.z,
      note: studyPositions.note,
      ambient: studyPositions.ambient,
      instrumentId: studyPositions.instrumentId,
      placedAt: studyPositions.placedAt,
      code: instruments.code,
      serialNo: instruments.serialNo,
      by: users.name,
    })
    .from(studyPositions)
    .leftJoin(instruments, eq(instruments.id, studyPositions.instrumentId))
    .leftJoin(users, eq(users.id, studyPositions.placedByUserId))
    .where(eq(studyPositions.studyId, study.id))
    .orderBy(asc(studyPositions.sort));
  const certs = await certificatesOf(
    db,
    actor.organisationId,
    positions.flatMap((p) => (p.instrumentId ? [p.instrumentId] : [])),
  );

  const events = await db
    .select({
      id: studyEvents.id,
      cycle: studyEvents.cycle,
      kind: studyEvents.kind,
      at: studyEvents.at,
      note: studyEvents.note,
      voided: studyEvents.voided,
      by: users.name,
    })
    .from(studyEvents)
    .leftJoin(users, eq(users.id, studyEvents.byUserId))
    .where(eq(studyEvents.studyId, study.id))
    .orderBy(asc(studyEvents.at));
  const cycles: CycleKey[] = study.cycles.length > 0 ? (study.cycles as StudyCycle[]) : [ROUTINE];

  const precal = await db
    .select({
      id: studyPrecal.id,
      code: instruments.code,
      instrumentId: studyPrecal.instrumentId,
      reference: studyPrecal.reference,
      reading: studyPrecal.reading,
      deviation: studyPrecal.deviation,
      tolerance: studyPrecal.tolerance,
      result: studyPrecal.result,
      quantity: studyPrecal.quantity,
      at: studyPrecal.at,
    })
    .from(studyPrecal)
    .innerJoin(instruments, eq(instruments.id, studyPrecal.instrumentId))
    .where(eq(studyPrecal.studyId, study.id))
    .orderBy(asc(studyPrecal.at));

  const photos = await db
    .select({
      id: studyPhotos.id,
      fileId: studyPhotos.fileId,
      positionLabel: studyPhotos.positionLabel,
      caption: studyPhotos.caption,
      at: studyPhotos.at,
      by: users.name,
      name: storedFiles.firstFileName,
    })
    .from(studyPhotos)
    .innerJoin(storedFiles, eq(storedFiles.id, studyPhotos.fileId))
    .leftJoin(users, eq(users.id, studyPhotos.byUserId))
    .where(eq(studyPhotos.studyId, study.id))
    .orderBy(asc(studyPhotos.at));

  // Loggers booked for the job but not yet placed anywhere on it: a tap list.
  const booked = await db
    .select({
      id: instruments.id,
      code: instruments.code,
      serialNo: instruments.serialNo,
      tier: instruments.tier,
    })
    .from(jobInstruments)
    .innerJoin(instruments, eq(instruments.id, jobInstruments.instrumentId))
    .where(eq(jobInstruments.jobId, job.id))
    .orderBy(asc(instruments.code));
  const placedOnJob = new Set(
    (
      await db
        .select({ id: studyPositions.instrumentId })
        .from(studyPositions)
        .innerJoin(studies, eq(studies.id, studyPositions.studyId))
        .where(and(eq(studies.jobId, job.id), sql`${studyPositions.instrumentId} is not null`))
    ).map((r) => r.id),
  );

  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    study,
    status: study.status as StudyStatus,
    job: {
      id: job.id,
      number: job.number,
      status: job.status as JobStatus,
      plannedStart: job.plannedStart,
      plannedEnd: job.plannedEnd,
    },
    companyName: row.companyName,
    siteName: row.siteName,
    equipment: {
      id: row.equipment.id,
      code: row.equipment.code,
      name: row.equipment.name,
      type: row.equipment.type,
      department: row.department,
      location: row.equipment.location,
      make: row.equipment.make,
      dims: {
        lengthM: n(row.equipment.lengthM),
        widthM: n(row.equipment.widthM),
        heightM: n(row.equipment.heightM),
      },
    },
    positions: positions.map((p) => {
      const cover = p.instrumentId
        ? certificateCovering(certs.get(p.instrumentId) ?? [], job.plannedStart)
        : null;
      return { ...p, x: Number(p.x), y: Number(p.y), z: Number(p.z), certificate: cover };
    }),
    cycles: cycleProgress(cycles, events, study.workType === "thermal_validation"),
    events,
    precal,
    photos,
    spare: booked.filter((b) => b.tier !== "master" && !placedOnJob.has(b.id)),
    masters: booked.filter((b) => b.tier === "master"),
    precalNeeded: study.workType === "thermal_validation" || study.postCalRequired,
  };
}
export type FieldStudy = NonNullable<Awaited<ReturnType<typeof getFieldStudy>>>;

/** The FT-12 PDF for a study, with the organisation's letterhead and the job team. */
export async function ft12Pdf(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  studyId: string,
): Promise<{ bytes: Buffer; fileName: string } | null> {
  const s = await getFieldStudy(db, actor, studyId);
  if (!s) return null;
  const [settings] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
  if (!settings) return null;
  let letterhead: Buffer | null = null;
  if (settings.letterheadFileId) {
    const [file] = await db
      .select()
      .from(storedFiles)
      .where(
        and(
          eq(storedFiles.id, settings.letterheadFileId),
          eq(storedFiles.organisationId, actor.organisationId),
        ),
      );
    if (file) letterhead = Buffer.from(await blobs.get(file.storageKey));
  }
  const team = await db
    .select({ name: users.name })
    .from(jobTeam)
    .innerJoin(users, eq(users.id, jobTeam.userId))
    .where(
      and(eq(jobTeam.jobId, s.job.id), sql`${jobTeam.role} in ('team_leader', 'field_engineer')`),
    )
    .orderBy(asc(users.name));
  const bytes = await renderFt12(s, {
    organisation: settings,
    letterhead,
    team: [...new Set(team.map((t) => t.name))],
  });
  const fileName = `FT-12 ${s.equipment.code} ${s.job.number}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  return { bytes, fileName };
}
