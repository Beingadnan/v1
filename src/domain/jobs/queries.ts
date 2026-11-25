import "server-only";

import { and, asc, desc, eq, inArray, ne, sql, type SQLWrapper } from "drizzle-orm";

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
  organisations,
  sites,
  storedFiles,
  studies,
  users,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import { isClientRole, isRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "@/domain/clients/equipment-types";
import { dueStatus, nextDueDate, todayInIndia } from "@/domain/clients/requalification";
import { INSTRUMENT_TYPE_INFO, type InstrumentType } from "@/domain/instruments/types";
import { certificateCovering } from "@/domain/instruments/validity";

import { contractOptions } from "./contract-service";
import { renderGatePassList } from "./gate-pass-pdf";
import { bookedOn, busyInstruments, readinessInputFor } from "./job-service";
import { jobValue } from "./pricing";
import { computeReadiness, datesShortfall, validThrough } from "./readiness";
import {
  HOLDS_INSTRUMENTS,
  isJobStatus,
  JOB_STATUSES,
  type JobStatus,
  type OrderType,
} from "./types";

/**
 * The client's order hasn't come: no PO/SRF number, or no ARC/AMC picked.
 * Used by the jobs list, the home page and the reminders.
 */
export const orderPendingSql = sql`(case when ${jobs.orderType} in ('arc', 'amc')
  then ${jobs.contractId} is null else btrim(${jobs.poNumber}) = '' end)`;

export type JobFilter = {
  q?: string;
  status?: string;
  /** "open" (default), "all", or "finished". */
  scope?: string;
  mine?: boolean;
  /** Only jobs whose client's order hasn't come. */
  orderPending?: boolean;
  /** "newest" (default): the job made last first. "start": by planned start date. */
  sort?: "newest" | "start";
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
  orderType: string;
  /** The client's order hasn't come yet. */
  orderPending: boolean;
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

/** The jobs list shows at most this many; the page says so when there are more. */
export const JOB_LIST_LIMIT = 500;

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
      orderType: jobs.orderType,
      orderPending: sql<boolean>`${orderPendingSql}`,
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
        filter.orderPending
          ? and(orderPendingSql, sql`${jobs.status} not in ('closed', 'cancelled')`)
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
    // Newest first by default (QA Tech, Nov 2026): the planned dates jumped around and the
    // job numbers looked shuffled. Job numbers can't be sorted as text (the format changed
    // from QT/J/2026/… to QT/11/2026/…), so the creation time decides.
    .orderBy(
      ...(filter.sort === "start"
        ? [asc(jobs.plannedStart), asc(jobs.createdAt)]
        : [desc(jobs.createdAt), desc(jobs.id)]),
    )
    .limit(JOB_LIST_LIMIT);
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

/** The job with its client and sites, checked against the organisation; null if not found. */
export async function findJob(db: Database, actor: SessionUser, jobId: string) {
  assertCan(actor, "jobs.view");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [row] = await db
    .select({
      job: jobs,
      companyName: clientCompanies.name,
      companyCode: clientCompanies.code,
      terms: clientCompanies.paymentTermsDays,
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
  return row ?? null;
}
export type JobRow = NonNullable<Awaited<ReturnType<typeof findJob>>>;

export async function getJob(db: Database, actor: SessionUser, jobId: string) {
  const row = await findJob(db, actor, jobId);
  return row ? jobDetail(db, actor, row) : null;
}

/**
 * Everything the job page shows about a job found by findJob, in one round
 * (ADR 0018). The page reads the job first, then this beside the money and
 * the booking choices.
 */
export async function jobDetail(db: Database, actor: SessionUser, row: JobRow) {
  assertCan(actor, "jobs.view");
  const { job } = row;

  // The job is checked against the organisation above; the rest goes out in one round:
  // reads that need the booked instruments or the team take them as subqueries.
  const holds = HOLDS_INSTRUMENTS.includes(job.status as JobStatus);
  const [
    studyRows,
    team,
    bookedRows,
    readinessInput,
    history,
    [orderFile],
    contracts,
    busy,
    teamClashes,
  ] = await Promise.all([
    db
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
      .orderBy(asc(studies.position)),
    db
      .select({
        userId: jobTeam.userId,
        role: jobTeam.role,
        name: users.name,
        email: users.email,
      })
      .from(jobTeam)
      .innerJoin(users, eq(users.id, jobTeam.userId))
      .where(eq(jobTeam.jobId, job.id))
      .orderBy(asc(users.name)),
    db
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
      .orderBy(asc(instruments.tier), asc(instruments.code)),
    readinessInputFor(db, actor.organisationId, job),
    db
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
      .orderBy(asc(jobStatusHistory.at)),
    job.orderFileId
      ? db
          .select({ name: storedFiles.firstFileName })
          .from(storedFiles)
          .where(
            and(
              eq(storedFiles.id, job.orderFileId),
              eq(storedFiles.organisationId, actor.organisationId),
            ),
          )
      : Promise.resolve([]),
    // The client's ARCs and AMCs, to pick on the job.
    contractOptions(db, actor, job.companyId),
    holds
      ? busyInstruments(db, actor.organisationId, job, bookedOn(db, job.id))
      : Promise.resolve(new Map<string, string[]>()),
    peopleClashes(
      db,
      actor.organisationId,
      job,
      db.select({ id: jobTeam.userId }).from(jobTeam).where(eq(jobTeam.jobId, job.id)),
    ),
  ]);

  // The readiness read already has each booked instrument's certificates.
  const certs = new Map(
    readinessInput.booked.map((b, i) => [readinessInput.bookedIds[i]!, b.certificates]),
  );
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

  const readiness = computeReadiness(readinessInput);
  const datesWarning = datesShortfall(readinessInput);

  const money = can(actor, "jobs.money");
  const value = money
    ? jobValue({
        quotedValue: job.quotedValue === null ? null : Number(job.quotedValue),
        poValue: job.poValue === null ? null : Number(job.poValue),
      })
    : null;

  return {
    job: money ? job : { ...job, poValue: null, quotedValue: null },
    /**
     * What the job page hands on to jobMoney and bookingChoices so they don't read it
     * again (ADR 0018). Server only: never pass it to a client component.
     */
    loaded: { job, terms: row.terms, input: readinessInput },
    status: job.status as JobStatus,
    company: { id: job.companyId, name: row.companyName, code: row.companyCode },
    site: { id: job.clientSiteId, name: row.siteName, code: row.siteCode },
    qaSite: row.qaSiteCode ? { name: row.qaSiteName!, code: row.qaSiteCode } : null,
    createdBy: row.createdBy,
    studies: studyRows.map((s) => ({
      ...s.study,
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
    datesWarning,
    order: {
      type: job.orderType as OrderType,
      contract: contracts.find((c) => c.id === job.contractId) ?? null,
      file: orderFile ? { name: orderFile.name } : null,
    },
    contracts,
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
  /** Ids, or a subquery of ids such as the job's own team (ADR 0018). */
  userIds: string[] | SQLWrapper,
): Promise<{ userId: string; name: string; jobs: { id: string; number: string }[] }[]> {
  if (Array.isArray(userIds) && userIds.length === 0) return [];
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
  /** The client's ARCs and AMCs, to pick as the order. */
  contracts: { id: string; kind: string; number: string; validFrom: string; validTo: string }[];
};

export async function clientOptions(db: Database, actor: SessionUser): Promise<WizardClient[]> {
  assertCan(actor, "jobs.view");
  const [rows, contracts] = await Promise.all([
    db
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
      .orderBy(asc(clientCompanies.name), asc(clientSites.name)),
    contractOptions(db, actor),
  ]);
  const map = new Map<string, WizardClient>();
  for (const r of rows) {
    const c = map.get(r.id) ?? {
      id: r.id,
      name: r.name,
      code: r.code,
      sites: [],
      contracts: contracts.filter((k) => k.companyId === r.id),
    };
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
  /** Pre/post-calibration ticked by default: the client's SOP asks, or thermal validation. */
  calibration: boolean;
  /** Thermal validation (autoclave, oven): always has pre- and post-calibration. */
  thermal: boolean;
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
      sop: clientCompanies.postCalRequired,
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
      thermal:
        isEquipmentType(r.type) && EQUIPMENT_TYPE_INFO[r.type].study === "thermal_validation",
      calibration:
        r.sop ||
        (isEquipmentType(r.type) && EQUIPMENT_TYPE_INFO[r.type].study === "thermal_validation"),
    };
  });
}

/** The gate pass list PDF: every booked instrument, for the client's security. */
export async function gatePassList(db: Database, actor: SessionUser, jobId: string) {
  const detail = await getJob(db, actor, jobId);
  if (!detail) return null;
  const [org] = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, actor.organisationId));
  const { job } = detail;
  const pdf = await renderGatePassList({
    organisation: org?.name ?? "QA Tech",
    jobNumber: job.number,
    gatePass: job.gatePassNumber,
    client: detail.company.name,
    site: detail.site.name,
    from: job.plannedStart,
    to: job.plannedEnd,
    team: detail.team.map((t) => t.name),
    instruments: detail.booked.map((b) => ({
      code: b.code,
      serialNo: b.serialNo,
      model: b.model,
      kind:
        b.tier === "master"
          ? "Master"
          : (INSTRUMENT_TYPE_INFO[b.type as InstrumentType]?.label ?? b.type.replace(/_/g, " ")),
      validUntil: b.certificate?.validUntil ?? null,
    })),
    printedOn: todayInIndia(),
  });
  return {
    pdf,
    fileName: `Gate pass list ${job.number.replace(/\//g, "-")}.pdf`,
  };
}
