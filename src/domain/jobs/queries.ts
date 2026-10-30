import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  clientDepartments,
  clientSites,
  equipment,
  instrumentModels,
  instruments,
  jobInstruments,
  jobStatusHistory,
  jobTeam,
  jobs,
  rateCards,
  sites,
  studies,
  users,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import { isClientRole, isRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { dueStatus, nextDueDate, todayInIndia } from "@/domain/clients/requalification";
import { certificatesOf } from "@/domain/instruments/certificate-service";
import { certificateCovering } from "@/domain/instruments/validity";

import { busyInstruments, readinessInputFor } from "./job-service";
import { jobValue } from "./pricing";
import { computeReadiness, validThrough } from "./readiness";
import { HOLDS_INSTRUMENTS, isJobStatus, JOB_STATUSES, type JobStatus } from "./types";

export type JobFilter = {
  q?: string;
  status?: string;
  /** "open" (default), "all", or "finished". */
  scope?: string;
  mine?: boolean;
};

export type JobListRow = {
  id: string;
  number: string;
  status: JobStatus;
  /** For a job on hold: the status it was held from. */
  heldFrom: string | null;
  title: string;
  companyId: string;
  companyName: string;
  companyCode: string;
  siteName: string;
  qaSiteCode: string | null;
  poNumber: string;
  plannedStart: string;
  plannedEnd: string;
  studyCount: number;
  /** Studies whose field work is done. */
  studiesDone: number;
  equipmentCodes: string[];
  team: string[];
  /** Null when the viewer may not see money. */
  poValue: string | null;
};

/** Jobs matching a search by job number, PO, client, equipment or report number. */
export async function listJobs(
  db: Database,
  actor: SessionUser,
  filter: JobFilter = {},
): Promise<JobListRow[]> {
  assertCan(actor, "jobs.view");
  const q = filter.q?.trim().toLowerCase().slice(0, 100) ?? "";
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const scope = filter.scope ?? "open";
  const statusFilter = isJobStatus(filter.status) ? filter.status : null;
  const rows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      status: jobs.status,
      heldFrom: jobs.heldFrom,
      title: jobs.title,
      companyId: clientCompanies.id,
      companyName: clientCompanies.name,
      companyCode: clientCompanies.code,
      siteName: clientSites.name,
      qaSiteCode: sites.code,
      poNumber: jobs.poNumber,
      poValue: jobs.poValue,
      plannedStart: jobs.plannedStart,
      plannedEnd: jobs.plannedEnd,
      studyCount: sql<number>`(select count(*)::int from ${studies} s where s.job_id = ${jobs.id})`,
      studiesDone: sql<number>`(select count(*)::int from ${studies} s where s.job_id = ${jobs.id} and s.status = 'completed')`,
      equipmentCodes: sql<
        string[]
      >`coalesce((select array_agg(e.code order by s.position) from ${studies} s join ${equipment} e on e.id = s.equipment_id where s.job_id = ${jobs.id}), '{}')`,
      team: sql<
        string[]
      >`coalesce((select array_agg(distinct u.name) from ${jobTeam} t join ${users} u on u.id = t.user_id where t.job_id = ${jobs.id}), '{}')`,
    })
    .from(jobs)
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
    .leftJoin(sites, eq(sites.id, jobs.siteId))
    .where(
      and(
        eq(jobs.organisationId, actor.organisationId),
        statusFilter ? eq(jobs.status, statusFilter) : undefined,
        !statusFilter && scope === "open"
          ? sql`${jobs.status} not in ('closed', 'cancelled')`
          : undefined,
        !statusFilter && scope === "finished"
          ? sql`${jobs.status} in ('closed', 'cancelled')`
          : undefined,
        filter.mine
          ? sql`exists (select 1 from ${jobTeam} t where t.job_id = ${jobs.id} and t.user_id = ${actor.id})`
          : undefined,
        q
          ? sql`(lower(${jobs.number}) like ${like} or lower(${jobs.poNumber}) like ${like}
              or lower(${jobs.title}) like ${like}
              or lower(${clientCompanies.name}) like ${like} or lower(${clientCompanies.code}) like ${like}
              or lower(${clientSites.name}) like ${like}
              or exists (select 1 from ${studies} s join ${equipment} e on e.id = s.equipment_id
                where s.job_id = ${jobs.id} and (lower(s.report_number) like ${like}
                  or lower(e.code) like ${like} or lower(e.name) like ${like})))`
          : undefined,
      ),
    )
    .orderBy(asc(jobs.plannedStart), desc(jobs.number))
    .limit(500);
  const money = can(actor, "jobs.money");
  return rows.map((r) => ({
    ...r,
    status: r.status as JobStatus,
    poValue: money ? r.poValue : null,
  }));
}

/** Counts per status for the board's headings and the dashboard. */
export async function jobCounts(db: Database, actor: SessionUser) {
  assertCan(actor, "jobs.view");
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.organisationId, actor.organisationId))
    .groupBy(jobs.status);
  return Object.fromEntries(JOB_STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.n ?? 0]));
}

export async function getJob(db: Database, actor: SessionUser, jobId: string) {
  assertCan(actor, "jobs.view");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [row] = await db
    .select({
      job: jobs,
      companyName: clientCompanies.name,
      companyCode: clientCompanies.code,
      siteName: clientSites.name,
      siteCode: clientSites.code,
      qaSiteName: sites.name,
      qaSiteCode: sites.code,
      createdBy: users.name,
    })
    .from(jobs)
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
    .leftJoin(sites, eq(sites.id, jobs.siteId))
    .leftJoin(users, eq(users.id, jobs.createdByUserId))
    .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, actor.organisationId)));
  if (!row) return null;
  const { job } = row;

  const studyRows = await db
    .select({
      study: studies,
      code: equipment.code,
      name: equipment.name,
      type: equipment.type,
      lastStudyOn: equipment.lastStudyOn,
      department: clientDepartments.name,
    })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(eq(studies.jobId, job.id))
    .orderBy(asc(studies.position));

  const team = await db
    .select({ userId: jobTeam.userId, role: jobTeam.role, name: users.name, email: users.email })
    .from(jobTeam)
    .innerJoin(users, eq(users.id, jobTeam.userId))
    .where(eq(jobTeam.jobId, job.id))
    .orderBy(asc(users.name));

  const bookedRows = await db
    .select({
      id: instruments.id,
      code: instruments.code,
      serialNo: instruments.serialNo,
      type: instruments.type,
      tier: instruments.tier,
      status: instruments.status,
      model: sql<string>`coalesce(${instrumentModels.make} || ' ' || ${instrumentModels.model}, trim(${instruments.make} || ' ' || ${instruments.model}))`,
      bookedAt: jobInstruments.bookedAt,
    })
    .from(jobInstruments)
    .innerJoin(instruments, eq(instruments.id, jobInstruments.instrumentId))
    .leftJoin(instrumentModels, eq(instrumentModels.id, instruments.modelId))
    .where(eq(jobInstruments.jobId, job.id))
    .orderBy(asc(instruments.tier), asc(instruments.code));
  const certs = await certificatesOf(
    db,
    actor.organisationId,
    bookedRows.map((b) => b.id),
  );
  const busy = HOLDS_INSTRUMENTS.includes(job.status as JobStatus)
    ? await busyInstruments(
        db,
        actor.organisationId,
        job,
        bookedRows.map((b) => b.id),
      )
    : new Map<string, string[]>();
  const booked = bookedRows.map((b) => {
    const list = certs.get(b.id) ?? [];
    const valid = validThrough({ ...b, certificates: list }, job.plannedStart, job.plannedEnd);
    return {
      ...b,
      certificate: certificateCovering(list, job.plannedStart),
      problem: valid.ok ? null : valid.reason,
      alsoOn: busy.get(b.id) ?? [],
    };
  });

  const readiness = computeReadiness(await readinessInputFor(db, actor.organisationId, job));

  const history = await db
    .select({
      id: jobStatusHistory.id,
      fromStatus: jobStatusHistory.fromStatus,
      toStatus: jobStatusHistory.toStatus,
      reason: jobStatusHistory.reason,
      at: jobStatusHistory.at,
      by: users.name,
    })
    .from(jobStatusHistory)
    .leftJoin(users, eq(users.id, jobStatusHistory.byUserId))
    .where(eq(jobStatusHistory.jobId, job.id))
    .orderBy(asc(jobStatusHistory.at));

  const teamClashes = await peopleClashes(
    db,
    actor.organisationId,
    job,
    team.map((t) => t.userId),
  );

  const money = can(actor, "jobs.money");
  const value = money
    ? jobValue({
        studyPrices: studyRows.map((s) => (s.study.price === null ? null : Number(s.study.price))),
        quotedValue: job.quotedValue === null ? null : Number(job.quotedValue),
        poValue: job.poValue === null ? null : Number(job.poValue),
      })
    : null;

  return {
    job: money ? job : { ...job, poValue: null, quotedValue: null },
    status: job.status as JobStatus,
    company: { id: job.companyId, name: row.companyName, code: row.companyCode },
    site: { id: job.clientSiteId, name: row.siteName, code: row.siteCode },
    qaSite: row.qaSiteCode ? { name: row.qaSiteName!, code: row.qaSiteCode } : null,
    createdBy: row.createdBy,
    studies: studyRows.map((s) => ({
      ...s.study,
      price: money ? s.study.price : null,
      priceNote: money ? s.study.priceNote : "",
      equipment: {
        id: s.study.equipmentId,
        code: s.code,
        name: s.name,
        type: s.type,
        department: s.department,
        lastStudyOn: s.lastStudyOn,
      },
    })),
    team,
    teamClashes,
    booked,
    readiness,
    history,
    value,
    canManage: can(actor, "jobs.manage"),
    canSeeMoney: money,
  };
}
export type JobDetail = NonNullable<Awaited<ReturnType<typeof getJob>>>;

/** People on this job who are also on another open job with overlapping dates. */
export async function peopleClashes(
  db: Database,
  organisationId: string,
  job: { id: string; plannedStart: string; plannedEnd: string },
  userIds: string[],
): Promise<{ userId: string; name: string; jobs: { id: string; number: string }[] }[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: jobTeam.userId, name: users.name, id: jobs.id, number: jobs.number })
    .from(jobTeam)
    .innerJoin(jobs, eq(jobs.id, jobTeam.jobId))
    .innerJoin(users, eq(users.id, jobTeam.userId))
    .where(
      and(
        eq(jobTeam.organisationId, organisationId),
        inArray(jobTeam.userId, userIds),
        ne(jobs.id, job.id),
        inArray(jobs.status, ["created", "ready", "field_work"]),
        sql`${jobs.plannedStart} <= ${job.plannedEnd} and ${jobs.plannedEnd} >= ${job.plannedStart}`,
      ),
    );
  const map = new Map<
    string,
    { userId: string; name: string; jobs: { id: string; number: string }[] }
  >();
  for (const r of rows) {
    const entry = map.get(r.userId) ?? { userId: r.userId, name: r.name, jobs: [] };
    if (!entry.jobs.some((j) => j.id === r.id)) entry.jobs.push({ id: r.id, number: r.number });
    map.set(r.userId, entry);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- wizard

/** Staff who can be put on a job, for the team picker. */
export async function staffOptions(db: Database, actor: SessionUser) {
  assertCan(actor, "jobs.view");
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.organisationId, actor.organisationId), eq(users.status, "active")))
    .orderBy(asc(users.name));
  return rows.filter((r) => isRole(r.role) && !isClientRole(r.role));
}

export async function qaSiteOptions(db: Database, actor: SessionUser) {
  return db
    .select({ id: sites.id, code: sites.code, name: sites.name })
    .from(sites)
    .where(and(eq(sites.organisationId, actor.organisationId), eq(sites.active, true)))
    .orderBy(asc(sites.code));
}

export type WizardClient = {
  id: string;
  name: string;
  code: string;
  sites: { id: string; name: string; code: string }[];
};

export async function clientOptions(db: Database, actor: SessionUser): Promise<WizardClient[]> {
  assertCan(actor, "jobs.view");
  const rows = await db
    .select({
      id: clientCompanies.id,
      name: clientCompanies.name,
      code: clientCompanies.code,
      siteId: clientSites.id,
      siteName: clientSites.name,
      siteCode: clientSites.code,
    })
    .from(clientCompanies)
    .leftJoin(clientSites, eq(clientSites.companyId, clientCompanies.id))
    .where(
      and(
        eq(clientCompanies.organisationId, actor.organisationId),
        eq(clientCompanies.active, true),
      ),
    )
    .orderBy(asc(clientCompanies.name), asc(clientSites.name));
  const map = new Map<string, WizardClient>();
  for (const r of rows) {
    const c = map.get(r.id) ?? { id: r.id, name: r.name, code: r.code, sites: [] };
    if (r.siteId) c.sites.push({ id: r.siteId, name: r.siteName!, code: r.siteCode! });
    map.set(r.id, c);
  }
  return [...map.values()];
}

export type SiteEquipment = {
  id: string;
  code: string;
  name: string;
  type: string;
  department: string | null;
  lastStudyOn: string | null;
  nextDue: string | null;
  due: ReturnType<typeof dueStatus>;
  /** Already on another open job. */
  onJob: { id: string; number: string } | null;
};

/**
 * The equipment at a client site, with what's due: the wizard ticks the
 * overdue and due-soon items that aren't already on an open job.
 */
export async function siteEquipment(
  db: Database,
  actor: SessionUser,
  clientSiteId: string,
): Promise<SiteEquipment[]> {
  assertCan(actor, "jobs.view");
  if (!/^[0-9a-f-]{36}$/i.test(clientSiteId)) return [];
  const rows = await db
    .select({
      id: equipment.id,
      code: equipment.code,
      name: equipment.name,
      type: equipment.type,
      department: clientDepartments.name,
      lastStudyOn: equipment.lastStudyOn,
      months: sql<
        number | null
      >`coalesce(${equipment.requalificationMonths}, ${clientCompanies.requalificationMonths})`,
      onJobId: sql<string | null>`(select j.id from ${studies} s join ${jobs} j on j.id = s.job_id
        where s.equipment_id = ${equipment.id} and j.status not in ('closed', 'cancelled', 'paid', 'invoiced')
        order by j.planned_start desc limit 1)`,
      onJobNumber: sql<
        string | null
      >`(select j.number from ${studies} s join ${jobs} j on j.id = s.job_id
        where s.equipment_id = ${equipment.id} and j.status not in ('closed', 'cancelled', 'paid', 'invoiced')
        order by j.planned_start desc limit 1)`,
    })
    .from(equipment)
    .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(
      and(
        eq(equipment.organisationId, actor.organisationId),
        eq(equipment.siteId, clientSiteId),
        eq(equipment.active, true),
      ),
    )
    .orderBy(asc(clientDepartments.name), asc(equipment.code));
  const today = todayInIndia();
  return rows.map((r) => {
    const nextDue = r.lastStudyOn && r.months ? nextDueDate(r.lastStudyOn, r.months) : null;
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      department: r.department,
      lastStudyOn: r.lastStudyOn,
      nextDue,
      due: dueStatus(nextDue, today),
      onJob: r.onJobId ? { id: r.onJobId, number: r.onJobNumber! } : null,
    };
  });
}

// ---------------------------------------------------------------- rate card

export async function listRateCard(db: Database, actor: SessionUser) {
  assertCan(actor, "jobs.money");
  return db
    .select()
    .from(rateCards)
    .where(and(eq(rateCards.organisationId, actor.organisationId), eq(rateCards.active, true)))
    .orderBy(asc(rateCards.workType), asc(rateCards.equipmentType), asc(rateCards.durationHours));
}
