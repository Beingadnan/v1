import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientCompanies,
  clientDepartments,
  clientSites,
  equipment,
  instrumentModels,
  instruments,
  jobInstruments,
  jobReadiness,
  jobStatusHistory,
  jobTeam,
  jobs,
  organisationSettings,
  rateCards,
  sites,
  studies,
  users,
  type Job,
  type RateCard,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import { isClientRole, isRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { formatReportNumber } from "@/domain/clients/report-number";
import { isUuid, rethrowUnique, toNumeric } from "@/domain/clients/shared";
import { certificatesOf } from "@/domain/instruments/certificate-service";
import { TYPE_MEASURES, type InstrumentType } from "@/domain/instruments/types";
import { allocateNumber } from "@/domain/numbering/allocate";
import { recordAudit } from "@/lib/audit";
import { shortList } from "@/lib/text";

import { INSTRUMENT_FOR, parseCodes, pickInstruments, sparesFor, type Candidate } from "./booking";
import { JobsError } from "./errors";
import { priceStudy, volumeOf, type RateLine } from "./pricing";
import { computeReadiness, needsMasters, validThrough, type ReadinessInput } from "./readiness";
import {
  jobHeaderSchema,
  jobSchema,
  rateLineSchema,
  readinessSchema,
  studyEditSchema,
  teamInputSchema,
  type JobHeaderInput,
  type JobInput,
  type RateLineInput,
  type StudyEditInput,
} from "./schemas";
import { defaultLoggerCount, defaultWorkType, seasonFor, uniqueReportNumber } from "./studies";
import {
  FINISHED,
  HOLDS_INSTRUMENTS,
  JOB_STATUS_LABELS,
  PLANNING,
  TRANSITIONS,
  canTransition,
  isJobStatus,
  type JobStatus,
  type Transition,
} from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

async function guarded<T>(messages: Record<string, string>, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    rethrowUnique(error, messages);
  }
}

const JOB_UNIQUE = {
  studies_org_report_number_key:
    "Two people reserved the same report number at once. Save again to get the next one.",
  jobs_org_number_key: "Two jobs were given the same number at once. Save again.",
};

// ---------------------------------------------------------------- loading

export async function lockJob(tx: Transaction, actor: SessionUser, jobId: string): Promise<Job> {
  if (!isUuid(jobId)) throw new JobsError("That job does not exist.");
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, actor.organisationId)))
    .for("update");
  if (!job) throw new JobsError("That job does not exist.");
  return job;
}

function status(job: Job): JobStatus {
  if (!isJobStatus(job.status)) throw new Error(`Unknown job status ${job.status}`);
  return job.status;
}

/** Studies can be changed while the job is being planned (or on hold from planning). */
function assertPlanning(job: Job, what: string) {
  const s = status(job);
  const planning =
    PLANNING.includes(s) ||
    (s === "on_hold" && job.heldFrom !== null && PLANNING.includes(job.heldFrom as JobStatus));
  if (!planning) {
    throw new JobsError(
      `${what} can only be changed before field work starts. This job is ${JOB_STATUS_LABELS[s]}.`,
    );
  }
}

function assertOpen(job: Job) {
  const s = status(job);
  if (FINISHED.includes(s)) throw new JobsError(`This job is ${JOB_STATUS_LABELS[s]}.`);
}

/** Everything the readiness check needs, read inside the transaction. */
export async function readinessInputFor(
  tx: Transaction | Database,
  organisationId: string,
  job: Pick<Job, "id" | "poNumber" | "plannedStart" | "plannedEnd">,
): Promise<ReadinessInput & { bookedIds: string[] }> {
  const studyRows = await tx
    .select({
      workType: studies.workType,
      loggerCount: studies.loggerCount,
      postCalRequired: studies.postCalRequired,
      durationHours: studies.durationHours,
      cycles: studies.cycles,
      label: equipment.code,
      lastStudyOn: equipment.lastStudyOn,
    })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(eq(studies.jobId, job.id));
  const booked = await tx
    .select({
      id: instruments.id,
      code: instruments.code,
      type: instruments.type,
      tier: instruments.tier,
      status: instruments.status,
    })
    .from(jobInstruments)
    .innerJoin(instruments, eq(instruments.id, jobInstruments.instrumentId))
    .where(eq(jobInstruments.jobId, job.id));
  const certs = await certificatesOf(
    tx,
    organisationId,
    booked.map((b) => b.id),
  );
  const manualRows = await tx.select().from(jobReadiness).where(eq(jobReadiness.jobId, job.id));
  return {
    poNumber: job.poNumber,
    plannedStart: job.plannedStart,
    plannedEnd: job.plannedEnd,
    studies: studyRows.map((s) => ({
      workType: s.workType as ReadinessInput["studies"][number]["workType"],
      loggerCount: s.loggerCount,
      postCalRequired: s.postCalRequired,
      durationHours: s.durationHours,
      cycleCount: s.cycles.length,
      label: s.label,
    })),
    booked: booked.map((b) => ({ ...b, certificates: certs.get(b.id) ?? [] })),
    bookedIds: booked.map((b) => b.id),
    isRequalification: studyRows.some((s) => s.lastStudyOn !== null),
    manual: Object.fromEntries(
      manualRows.map((r) => [
        r.key,
        { state: r.state as "ready" | "pending" | "na", note: r.note },
      ]),
    ),
  };
}

export async function setStatus(
  tx: Transaction,
  actor: SessionUser,
  job: Job,
  to: JobStatus,
  reason: string,
  request?: RequestInfo,
  extra: Partial<Pick<Job, "heldFrom" | "holdReason" | "cancelledReason">> = {},
) {
  const from = status(job);
  await tx
    .update(jobs)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(eq(jobs.id, job.id));
  await tx.insert(jobStatusHistory).values({
    organisationId: actor.organisationId,
    jobId: job.id,
    fromStatus: from,
    toStatus: to,
    reason,
    byUserId: actor.id,
  });
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "job.status_changed",
    entityType: "job",
    entityId: job.id,
    summary: `${job.number}: ${JOB_STATUS_LABELS[from]} → ${JOB_STATUS_LABELS[to]}`,
    before: { status: from },
    after: { status: to },
    reason: reason || undefined,
    request,
  });
  Object.assign(job, { status: to, ...extra });
}

/**
 * Moves a planning job between Created and Ready to match its checklist, so
 * nobody has to remember to. Returns the readiness worked out.
 */
async function syncReadiness(tx: Transaction, actor: SessionUser, job: Job, request?: RequestInfo) {
  const input = await readinessInputFor(tx, actor.organisationId, job);
  const result = computeReadiness(input);
  const s = status(job);
  if (s === "created" && result.ready) {
    await setStatus(tx, actor, job, "ready", "Readiness checklist complete", request);
  } else if (s === "ready" && !result.ready) {
    const pending = result.items.filter((i) => i.state === "pending").map((i) => i.label);
    await setStatus(tx, actor, job, "created", `Pending: ${pending.join(", ")}`, request);
  }
  return result;
}

// ---------------------------------------------------------------- studies

type EquipmentRow = typeof equipment.$inferSelect & { department: string | null };

async function loadEquipment(
  tx: Transaction,
  actor: SessionUser,
  clientSiteId: string,
  ids: string[],
): Promise<EquipmentRow[]> {
  const rows = await tx
    .select({ e: equipment, department: clientDepartments.name })
    .from(equipment)
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(and(eq(equipment.organisationId, actor.organisationId), inArray(equipment.id, ids)));
  const byId = new Map(rows.map((r) => [r.e.id, { ...r.e, department: r.department }]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new JobsError("An equipment item does not exist.");
    if (row.siteId !== clientSiteId) {
      throw new JobsError(`${row.code} is at another site of this client. A job covers one site.`);
    }
    if (!row.active) throw new JobsError(`${row.code} is marked as no longer in use.`);
    return row;
  });
}

async function activeRates(tx: Transaction, organisationId: string): Promise<RateLine[]> {
  return tx
    .select()
    .from(rateCards)
    .where(and(eq(rateCards.organisationId, organisationId), eq(rateCards.active, true)));
}

function priceFor(
  rates: RateLine[],
  e: EquipmentRow,
  s: { workType: string; durationHours: number | null; cycles: string[]; loggerCount: number },
) {
  return priceStudy(rates, {
    workType: s.workType as never,
    equipmentType: e.type,
    durationHours: s.durationHours,
    cycles: s.cycles,
    loggerCount: s.loggerCount,
    volumeM3: volumeOf(e.lengthM, e.widthM, e.heightM),
  });
}

async function insertStudies(
  tx: Transaction,
  actor: SessionUser,
  job: Job,
  items: {
    equipmentId: string;
    workType?: string;
    loggerCount?: number | null;
    cycles?: string[];
    season?: string;
  }[],
): Promise<string[]> {
  const ids = items.map((i) => i.equipmentId);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  const existing = await tx
    .select({ equipmentId: studies.equipmentId, position: studies.position })
    .from(studies)
    .where(eq(studies.jobId, job.id));
  const list = await loadEquipment(tx, actor, job.clientSiteId, ids);
  const onJob = new Set(existing.map((s) => s.equipmentId));
  const twice = list.find((e) => e.id === dup || onJob.has(e.id));
  if (twice) throw new JobsError(`${twice.code} is already on this job.`);

  const [company] = await tx
    .select({
      code: clientCompanies.code,
      format: clientCompanies.reportNumberFormat,
      postCal: clientCompanies.postCalRequired,
    })
    .from(clientCompanies)
    .where(eq(clientCompanies.id, job.companyId));
  const [site] = await tx
    .select({ code: clientSites.code })
    .from(clientSites)
    .where(eq(clientSites.id, job.clientSiteId));
  if (!company || !site) throw new JobsError("That client or site does not exist.");
  const rates = await activeRates(tx, actor.organisationId);
  const [year, month] = job.plannedStart.split("-").map(Number) as [number, number];
  let position = existing.reduce((m, s) => Math.max(m, s.position), 0);
  const reserved = new Set<string>();
  const labels: string[] = [];

  for (const [i, e] of list.entries()) {
    const opt = items[i]!;
    const workType = (opt.workType ?? defaultWorkType(e)) as string;
    const base = formatReportNumber(company.format, {
      clientCode: company.code,
      siteCode: site.code,
      department: e.department ?? "",
      equipmentName: e.name,
      equipmentCode: e.code,
      month,
      year,
    });
    const taken = await tx
      .select({ n: sql<string>`lower(${studies.reportNumber})` })
      .from(studies)
      .where(
        and(
          eq(studies.organisationId, actor.organisationId),
          sql`starts_with(lower(${studies.reportNumber}), lower(${base}))`,
        ),
      );
    const reportNumber = uniqueReportNumber(base, new Set([...taken.map((t) => t.n), ...reserved]));
    reserved.add(reportNumber.toLowerCase());
    const cycles = opt.cycles ?? e.cycles;
    const loggerCount =
      opt.loggerCount ?? (workType === "onsite_calibration" ? 0 : defaultLoggerCount(e));
    const price = priceFor(rates, e, {
      workType,
      durationHours: e.studyDurationHours,
      cycles,
      loggerCount,
    });
    await tx.insert(studies).values({
      organisationId: actor.organisationId,
      jobId: job.id,
      equipmentId: e.id,
      position: ++position,
      workType,
      reportNumber,
      cycles,
      season: opt.season ?? seasonFor(e.seasonalMapping, job.plannedStart),
      setPointC: e.setPointC,
      tempMinC: e.tempMinC,
      tempMaxC: e.tempMaxC,
      rhMinPct: e.rhMinPct,
      rhMaxPct: e.rhMaxPct,
      loggerCount,
      intervalMinutes: e.readingIntervalMinutes,
      durationHours: e.studyDurationHours,
      postCalRequired: company.postCal || workType === "thermal_validation",
      price: toNumeric(price.price),
      priceNote: price.note,
    });
    labels.push(e.code);
  }
  return labels;
}

// ---------------------------------------------------------------- team

async function checkTeam(
  tx: Transaction,
  actor: SessionUser,
  team: { userId: string; role: string }[],
) {
  const ids = [...new Set(team.map((t) => t.userId))];
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: users.id, name: users.name, role: users.role, status: users.status })
    .from(users)
    .where(and(eq(users.organisationId, actor.organisationId), inArray(users.id, ids)));
  for (const id of ids) {
    const u = rows.find((r) => r.id === id);
    if (!u) throw new JobsError("A team member does not exist.");
    if (!isRole(u.role) || isClientRole(u.role)) throw new JobsError(`${u.name} is a client user.`);
    if (u.status !== "active") throw new JobsError(`${u.name}'s account is not active.`);
  }
}

async function writeTeam(
  tx: Transaction,
  actor: SessionUser,
  jobId: string,
  team: { userId: string; role: string }[],
) {
  await tx.delete(jobTeam).where(eq(jobTeam.jobId, jobId));
  const unique = [...new Map(team.map((t) => [`${t.userId}|${t.role}`, t])).values()];
  if (unique.length > 0) {
    await tx
      .insert(jobTeam)
      .values(unique.map((t) => ({ organisationId: actor.organisationId, jobId, ...t })));
  }
}

// ---------------------------------------------------------------- jobs

/**
 * Creates a job with its studies (report numbers reserved, defaults copied
 * from the equipment, priced from the rate card) and its team.
 */
export async function createJob(
  db: Database,
  actor: SessionUser,
  input: JobInput,
  request?: RequestInfo,
): Promise<{ id: string; number: string }> {
  assertCan(actor, "jobs.manage");
  const v = jobSchema.parse(input);
  return guarded(JOB_UNIQUE, () =>
    db.transaction(async (tx) => {
      const [company] = await tx
        .select({
          id: clientCompanies.id,
          name: clientCompanies.name,
          active: clientCompanies.active,
        })
        .from(clientCompanies)
        .where(
          and(
            eq(clientCompanies.id, v.companyId),
            eq(clientCompanies.organisationId, actor.organisationId),
          ),
        );
      if (!company) throw new JobsError("That client does not exist.");
      if (!company.active) throw new JobsError(`${company.name} is marked inactive.`);
      const [clientSite] = await tx
        .select({ id: clientSites.id })
        .from(clientSites)
        .where(and(eq(clientSites.id, v.clientSiteId), eq(clientSites.companyId, company.id)));
      if (!clientSite) throw new JobsError("That site does not belong to this client.");

      const [settings] = await tx
        .select({ format: organisationSettings.jobNumberFormat })
        .from(organisationSettings)
        .where(eq(organisationSettings.organisationId, actor.organisationId));
      if (!settings) throw new JobsError("Settings are missing. Run the seed command.");

      const ourSites = await tx
        .select({ id: sites.id, code: sites.code, name: sites.name })
        .from(sites)
        .where(and(eq(sites.organisationId, actor.organisationId), eq(sites.active, true)));
      // One branch only: it's the obvious one.
      const siteId = v.siteId ?? (ourSites.length === 1 ? ourSites[0]!.id : null);
      const site = ourSites.find((s) => s.id === siteId) ?? null;
      if (siteId && !site) throw new JobsError("That QA Tech site does not exist.");
      const perSite = /\{SITE/.test(settings.format);
      if (perSite && !site) {
        throw new JobsError("Pick the QA Tech site: job numbers include it.");
      }

      await checkTeam(tx, actor, v.team);

      // Skip numbers already taken (entered by hand before QTech), so none repeats.
      let number = "";
      for (let attempt = 0; attempt < 100; attempt++) {
        ({ number } = await allocateNumber(tx, {
          organisationId: actor.organisationId,
          kind: "job",
          format: settings.format,
          date: new Date(),
          siteCode: perSite ? site!.code : undefined,
          siteName: site?.name,
        }));
        const [taken] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.organisationId, actor.organisationId), eq(jobs.number, number)));
        if (!taken) break;
      }

      const [job] = await tx
        .insert(jobs)
        .values({
          organisationId: actor.organisationId,
          number,
          companyId: company.id,
          clientSiteId: clientSite.id,
          siteId,
          title: v.title,
          poNumber: v.poNumber,
          poDate: v.poDate,
          poValue: toNumeric(v.poValue),
          quotedValue: toNumeric(v.quotedValue),
          plannedStart: v.plannedStart,
          plannedEnd: v.plannedEnd,
          notes: v.notes,
          createdByUserId: actor.id,
        })
        .returning();
      await tx.insert(jobStatusHistory).values({
        organisationId: actor.organisationId,
        jobId: job!.id,
        fromStatus: null,
        toStatus: "created",
        byUserId: actor.id,
      });
      const codes = await insertStudies(tx, actor, job!, v.items);
      await writeTeam(tx, actor, job!.id, v.team);
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "job.created",
        entityType: "job",
        entityId: job!.id,
        summary: `${actor.name} created job ${number} for ${company.name}: ${shortList(codes)}`,
        after: { number, ...v },
        request,
      });
      await syncReadiness(tx, actor, job!, request);
      return { id: job!.id, number };
    }),
  );
}

export async function updateJob(
  db: Database,
  actor: SessionUser,
  jobId: string,
  input: JobHeaderInput,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  const v = jobHeaderSchema.parse(input);
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    assertOpen(job);
    if (v.siteId) {
      const [site] = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, v.siteId), eq(sites.organisationId, actor.organisationId)));
      if (!site) throw new JobsError("That QA Tech site does not exist.");
    }
    const after = {
      siteId: v.siteId,
      title: v.title,
      poNumber: v.poNumber,
      poDate: v.poDate,
      poValue: toNumeric(v.poValue),
      quotedValue: toNumeric(v.quotedValue),
      plannedStart: v.plannedStart,
      plannedEnd: v.plannedEnd,
      notes: v.notes,
    };
    const before = Object.fromEntries(
      Object.keys(after).map((k) => [k, job[k as keyof typeof after]]),
    );
    const changed = Object.keys(after).filter(
      (k) => String(before[k] ?? "") !== String(after[k as keyof typeof after] ?? ""),
    );
    if (changed.length === 0) return;
    await tx
      .update(jobs)
      .set({ ...after, updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.updated",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} changed ${changed.join(", ")} of job ${job.number}`,
      before,
      after,
      request,
    });
    Object.assign(job, after);
    await syncReadiness(tx, actor, job, request);
  });
}

export async function addStudies(
  db: Database,
  actor: SessionUser,
  jobId: string,
  equipmentIds: string[],
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  if (equipmentIds.length === 0) throw new JobsError("Pick at least one equipment item.");
  if (equipmentIds.some((id) => !isUuid(id)))
    throw new JobsError("An equipment item does not exist.");
  await guarded(JOB_UNIQUE, () =>
    db.transaction(async (tx) => {
      const job = await lockJob(tx, actor, jobId);
      assertPlanning(job, "Equipment on the job");
      const codes = await insertStudies(
        tx,
        actor,
        job,
        equipmentIds.map((equipmentId) => ({ equipmentId })),
      );
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "job.study_added",
        entityType: "job",
        entityId: job.id,
        summary: `${actor.name} added ${shortList(codes)} to job ${job.number}`,
        request,
      });
      await syncReadiness(tx, actor, job, request);
    }),
  );
}

async function lockStudy(tx: Transaction, actor: SessionUser, studyId: string) {
  if (!isUuid(studyId)) throw new JobsError("That study does not exist.");
  const [row] = await tx
    .select({ study: studies, code: equipment.code })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) throw new JobsError("That study does not exist.");
  const job = await lockJob(tx, actor, row.study.jobId);
  return { ...row, job };
}

export async function updateStudy(
  db: Database,
  actor: SessionUser,
  studyId: string,
  input: StudyEditInput,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  const v = studyEditSchema.parse(input);
  await db.transaction(async (tx) => {
    const { study, code, job } = await lockStudy(tx, actor, studyId);
    assertPlanning(job, "Studies");
    const [e] = await tx
      .select({ e: equipment, department: sql<string | null>`null` })
      .from(equipment)
      .where(eq(equipment.id, study.equipmentId));
    const price = priceFor(
      await activeRates(tx, actor.organisationId),
      { ...e!.e, department: null },
      v,
    );
    const after = { ...v, price: toNumeric(price.price), priceNote: price.note };
    await tx.update(studies).set(after).where(eq(studies.id, study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.updated",
      entityType: "study",
      entityId: study.id,
      summary: `${actor.name} changed the ${code} study on job ${job.number}`,
      before: {
        workType: study.workType,
        loggerCount: study.loggerCount,
        cycles: study.cycles,
        season: study.season,
        durationHours: study.durationHours,
        intervalMinutes: study.intervalMinutes,
      },
      after,
      request,
    });
    await syncReadiness(tx, actor, job, request);
  });
}

/**
 * Prices every study again from today's rate card, for a job still being
 * planned (a rate added or changed after the job was made). Returns how many
 * prices changed and how many studies still have no rate.
 */
export async function repriceJob(
  db: Database,
  actor: SessionUser,
  jobId: string,
  request?: RequestInfo,
): Promise<{ changed: number; unpriced: number }> {
  assertCan(actor, "jobs.manage");
  assertCan(actor, "jobs.money");
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    assertPlanning(job, "Prices");
    const rates = await activeRates(tx, actor.organisationId);
    const rows = await tx
      .select({ study: studies, e: equipment })
      .from(studies)
      .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
      .where(eq(studies.jobId, job.id));
    const before: Record<string, string | null> = {};
    const after: Record<string, string | null> = {};
    let unpriced = 0;
    for (const { study, e } of rows) {
      const p = priceFor(rates, { ...e, department: null }, study);
      const price = toNumeric(p.price);
      if (p.price === null) unpriced++;
      if (Number(study.price ?? NaN) === Number(price ?? NaN) && study.priceNote === p.note)
        continue;
      before[e.code] = study.price;
      after[e.code] = price;
      await tx.update(studies).set({ price, priceNote: p.note }).where(eq(studies.id, study.id));
    }
    const changed = Object.keys(after).length;
    if (changed > 0) {
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "job.updated",
        entityType: "job",
        entityId: job.id,
        summary: `${actor.name} priced job ${job.number} from the rate card (${changed} changed)`,
        before,
        after,
        request,
      });
    }
    return { changed, unpriced };
  });
}

export async function removeStudy(
  db: Database,
  actor: SessionUser,
  studyId: string,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  await db.transaction(async (tx) => {
    const { study, code, job } = await lockStudy(tx, actor, studyId);
    assertPlanning(job, "Equipment on the job");
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(studies)
      .where(eq(studies.jobId, job.id));
    if (n <= 1) throw new JobsError("A job needs at least one study. Cancel the job instead.");
    await tx.delete(studies).where(eq(studies.id, study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.study_removed",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} removed ${code} (${study.reportNumber}) from job ${job.number}`,
      before: study,
      request,
    });
    await syncReadiness(tx, actor, job, request);
  });
}

export async function setTeam(
  db: Database,
  actor: SessionUser,
  jobId: string,
  input: unknown,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  const team = teamInputSchema.parse(input);
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    assertOpen(job);
    await checkTeam(tx, actor, team);
    const before = await tx.select().from(jobTeam).where(eq(jobTeam.jobId, job.id));
    await writeTeam(tx, actor, job.id, team);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.team_changed",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} changed the team of job ${job.number}`,
      before: before.map(({ userId, role }) => ({ userId, role })),
      after: team,
      request,
    });
  });
}

export async function setReadiness(
  db: Database,
  actor: SessionUser,
  jobId: string,
  input: unknown,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  const v = readinessSchema.parse(input);
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    assertOpen(job);
    await tx
      .insert(jobReadiness)
      .values({
        organisationId: actor.organisationId,
        jobId: job.id,
        key: v.key,
        state: v.state,
        note: v.note,
        updatedByUserId: actor.id,
      })
      .onConflictDoUpdate({
        target: [jobReadiness.jobId, jobReadiness.key],
        set: { state: v.state, note: v.note, updatedByUserId: actor.id, updatedAt: new Date() },
      });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.readiness_updated",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} marked ${v.key.replace(/_/g, " ")} ${v.state} on job ${job.number}`,
      after: v,
      request,
    });
    await syncReadiness(tx, actor, job, request);
  });
}

/**
 * Start field work, hold, resume or cancel. Field work starts only when the
 * checklist is complete, rechecked now (a certificate may have been cancelled
 * since the job became Ready).
 */
export async function changeStatus(
  db: Database,
  actor: SessionUser,
  jobId: string,
  transition: Transition,
  reasonInput: unknown,
  request?: RequestInfo,
): Promise<JobStatus> {
  assertCan(actor, "jobs.manage");
  if (!(transition in TRANSITIONS)) throw new JobsError("Unknown action.");
  const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 500) : "";
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    const from = status(job);
    if (!canTransition(from, transition)) {
      throw new JobsError(
        `${TRANSITIONS[transition].label} isn't possible while the job is ${JOB_STATUS_LABELS[from]}.`,
      );
    }
    switch (transition) {
      case "start_field_work": {
        const result = computeReadiness(await readinessInputFor(tx, actor.organisationId, job));
        if (!result.ready) {
          const pending = result.items.filter((i) => i.state === "pending");
          await setStatus(
            tx,
            actor,
            job,
            "created",
            `Pending: ${pending.map((p) => p.label).join(", ")}`,
            request,
          );
          throw new JobsError(
            `Not ready for field work: ${pending.map((p) => `${p.label} (${p.detail})`).join("; ")}`,
          );
        }
        await setStatus(tx, actor, job, "field_work", reason, request);
        break;
      }
      case "hold":
        if (!reason) throw new JobsError("Say why the job is on hold.");
        await setStatus(tx, actor, job, "on_hold", reason, request, {
          heldFrom: from,
          holdReason: reason,
        });
        break;
      case "resume": {
        const back = (isJobStatus(job.heldFrom) ? job.heldFrom : "created") as JobStatus;
        await setStatus(tx, actor, job, back, reason, request, {
          heldFrom: null,
          holdReason: null,
        });
        if (PLANNING.includes(back)) await syncReadiness(tx, actor, job, request);
        break;
      }
      case "cancel":
        if (!reason) throw new JobsError("Say why the job is cancelled.");
        await setStatus(tx, actor, job, "cancelled", reason, request, { cancelledReason: reason });
        break;
    }
    return status(job);
  });
}

// ---------------------------------------------------------------- bookings

/** Other open jobs holding these instruments on dates that overlap. */
export async function busyInstruments(
  tx: Transaction | Database,
  organisationId: string,
  job: Pick<Job, "id" | "plannedStart" | "plannedEnd">,
  instrumentIds?: string[],
): Promise<Map<string, string[]>> {
  if (instrumentIds && instrumentIds.length === 0) return new Map();
  const rows = await tx
    .select({ instrumentId: jobInstruments.instrumentId, number: jobs.number })
    .from(jobInstruments)
    .innerJoin(jobs, eq(jobs.id, jobInstruments.jobId))
    .where(
      and(
        eq(jobInstruments.organisationId, organisationId),
        ne(jobs.id, job.id),
        inArray(jobs.status, [...HOLDS_INSTRUMENTS]),
        sql`${jobs.plannedStart} <= ${job.plannedEnd} and ${jobs.plannedEnd} >= ${job.plannedStart}`,
        instrumentIds ? inArray(jobInstruments.instrumentId, instrumentIds) : undefined,
      ),
    );
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.instrumentId, [...(map.get(r.instrumentId) ?? []), r.number]);
  return map;
}

async function candidates(
  tx: Transaction,
  actor: SessionUser,
  job: Job,
  where: { types?: string[]; ids?: string[] },
): Promise<Candidate[]> {
  const rows = await tx
    .select({
      id: instruments.id,
      code: instruments.code,
      type: instruments.type,
      tier: instruments.tier,
      status: instruments.status,
      modelId: instruments.modelId,
      make: instruments.make,
      model: instruments.model,
      modelMake: instrumentModels.make,
      modelName: instrumentModels.model,
      homeSiteId: instruments.homeSiteId,
    })
    .from(instruments)
    .leftJoin(instrumentModels, eq(instrumentModels.id, instruments.modelId))
    .where(
      and(
        eq(instruments.organisationId, actor.organisationId),
        where.types ? inArray(instruments.type, where.types) : undefined,
        where.ids ? inArray(instruments.id, where.ids) : undefined,
      ),
    )
    .orderBy(asc(instruments.code));
  const ids = rows.map((r) => r.id);
  const certs = await certificatesOf(tx, actor.organisationId, ids);
  const busy = await busyInstruments(tx, actor.organisationId, job, ids);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    type: r.type,
    tier: r.tier,
    status: r.status,
    modelId: r.modelId,
    modelLabel: r.modelMake ? `${r.modelMake} ${r.modelName}` : `${r.make} ${r.model}`.trim(),
    homeSiteId: r.homeSiteId,
    certificates: certs.get(r.id) ?? [],
    busyOn: busy.get(r.id) ?? [],
  }));
}

async function insertBookings(tx: Transaction, actor: SessionUser, jobId: string, ids: string[]) {
  if (ids.length === 0) return;
  await tx
    .insert(jobInstruments)
    .values(
      ids.map((instrumentId) => ({
        organisationId: actor.organisationId,
        jobId,
        instrumentId,
        bookedByUserId: actor.id,
      })),
    )
    .onConflictDoNothing();
}

/**
 * One booking at a time per organisation: two people booking for overlapping
 * jobs at the same moment would otherwise both see a logger as free.
 */
export async function lockBookings(tx: Transaction, organisationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`job-bookings:${organisationId}`}))`,
  );
}

function assertCanBook(job: Job) {
  const s = status(job);
  if (!(HOLDS_INSTRUMENTS as readonly string[]).includes(s)) {
    throw new JobsError(`Instruments can't be booked while the job is ${JOB_STATUS_LABELS[s]}.`);
  }
}

export type AutoBookResult = {
  booked: string[];
  short: { type: string; count: number }[];
  skipped: { reason: string; count: number }[];
  masters: string[];
};

/**
 * Books what the studies still need, plus spares, and a master when pre/post-
 * calibration is needed. Run it again after adding studies: it tops up.
 */
export async function autoBook(
  db: Database,
  actor: SessionUser,
  jobId: string,
  request?: RequestInfo,
): Promise<AutoBookResult> {
  assertCan(actor, "jobs.manage");
  return db.transaction(async (tx) => {
    await lockBookings(tx, actor.organisationId);
    const job = await lockJob(tx, actor, jobId);
    assertCanBook(job);
    const input = await readinessInputFor(tx, actor.organisationId, job);
    const already = new Set(input.bookedIds);

    // How many of each instrument type the studies need.
    const need = new Map<string, number>();
    for (const s of input.studies) {
      const type = INSTRUMENT_FOR[s.workType];
      if (type) need.set(type, (need.get(type) ?? 0) + s.loggerCount);
    }
    const result: AutoBookResult = { booked: [], short: [], skipped: [], masters: [] };
    for (const [type, count] of need) {
      const have = input.booked.filter((b) => b.type === type && b.tier !== "master").length;
      const want = count + sparesFor(count) - have;
      if (want <= 0) continue;
      const pool = await candidates(tx, actor, job, { types: [type] });
      const pick = pickInstruments({
        candidates: pool,
        count: want,
        type,
        siteId: job.siteId,
        start: job.plannedStart,
        end: job.plannedEnd,
        exclude: already,
      });
      await insertBookings(
        tx,
        actor,
        job.id,
        pick.picked.map((p) => p.id),
      );
      result.booked.push(...pick.picked.map((p) => p.code));
      // Spares that couldn't be found aren't a shortage.
      const missing = Math.max(0, count - have - pick.picked.length);
      if (missing > 0) result.short.push({ type, count: missing });
      result.skipped.push(...pick.skipped);
    }

    // A temperature master (and a humidity one for RH studies) for pre/post-cal.
    if (needsMasters(input.studies)) {
      const quantities = ["temperature"];
      if (input.studies.some((s) => s.workType === "temperature_rh_mapping" && s.postCalRequired)) {
        quantities.push("humidity");
      }
      const pool = (await candidates(tx, actor, job, {})).filter((c) => c.tier === "master");
      const bookedNow: { type: string }[] = [];
      const breadth = (c: { type: string }) =>
        (TYPE_MEASURES[c.type as InstrumentType] ?? []).length;
      for (const q of quantities) {
        const measures = (c: { type: string }) =>
          (TYPE_MEASURES[c.type as InstrumentType] ?? []).includes(q as never);
        if (input.booked.some((b) => b.tier === "master" && measures(b))) continue;
        if (bookedNow.some(measures)) continue;
        const usable = pool
          .filter(
            (c) =>
              measures(c) &&
              !already.has(c.id) &&
              !result.masters.includes(c.code) &&
              c.busyOn.length === 0 &&
              validThrough(c, job.plannedStart, job.plannedEnd).ok,
          )
          // A dedicated reference first (an SSPRT for °C, not the RH indicator), then the home site.
          .sort(
            (a, b) =>
              breadth(a) - breadth(b) ||
              Number(b.homeSiteId === job.siteId) - Number(a.homeSiteId === job.siteId),
          );
        const m = usable[0];
        if (m) {
          await insertBookings(tx, actor, job.id, [m.id]);
          result.masters.push(m.code);
          bookedNow.push(m);
        } else {
          result.short.push({ type: `${q} master`, count: 1 });
        }
      }
    }

    if (result.booked.length + result.masters.length > 0) {
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "job.instruments_booked",
        entityType: "job",
        entityId: job.id,
        summary: `${actor.name} booked ${shortList([...result.booked, ...result.masters])} for job ${job.number}`,
        after: result,
        request,
      });
    }
    await syncReadiness(tx, actor, job, request);
    return result;
  });
}

export type ManualBookResult = {
  booked: string[];
  notFound: string[];
  refused: { code: string; reason: string }[];
};

/**
 * Books instruments by pasted IDs or serial numbers. Ones that are retired,
 * out of date for the study or on another job are refused with the reason.
 */
export async function bookByCodes(
  db: Database,
  actor: SessionUser,
  jobId: string,
  text: unknown,
  request?: RequestInfo,
): Promise<ManualBookResult> {
  assertCan(actor, "jobs.manage");
  const codes = parseCodes(typeof text === "string" ? text : "").slice(0, 500);
  if (codes.length === 0) throw new JobsError("Paste or type at least one ID or serial number.");
  return db.transaction(async (tx) => {
    await lockBookings(tx, actor.organisationId);
    const job = await lockJob(tx, actor, jobId);
    assertCanBook(job);
    const lower = codes.map((c) => c.toLowerCase());
    const found = await tx
      .select({ id: instruments.id, code: instruments.code, serialNo: instruments.serialNo })
      .from(instruments)
      .where(
        and(
          eq(instruments.organisationId, actor.organisationId),
          sql`(lower(${instruments.code}) in ${lower} or lower(${instruments.serialNo}) in ${lower})`,
        ),
      );
    const result: ManualBookResult = { booked: [], notFound: [], refused: [] };
    const ids: string[] = [];
    for (const code of codes) {
      const l = code.toLowerCase();
      const hit =
        found.find((f) => f.code.toLowerCase() === l) ??
        found.find((f) => f.serialNo.toLowerCase() === l);
      if (!hit) result.notFound.push(code);
      else if (!ids.includes(hit.id)) ids.push(hit.id);
    }
    const existing = new Set(
      (
        await tx
          .select({ id: jobInstruments.instrumentId })
          .from(jobInstruments)
          .where(eq(jobInstruments.jobId, job.id))
      ).map((r) => r.id),
    );
    const pool = await candidates(tx, actor, job, { ids });
    const ok: string[] = [];
    for (const c of pool) {
      if (existing.has(c.id)) continue;
      if (c.busyOn.length > 0) {
        result.refused.push({ code: c.code, reason: `booked on ${c.busyOn.join(", ")}` });
        continue;
      }
      const valid = validThrough(c, job.plannedStart, job.plannedEnd);
      if (!valid.ok) {
        result.refused.push({ code: c.code, reason: valid.reason.replace(`${c.code} `, "") });
        continue;
      }
      ok.push(c.id);
      result.booked.push(c.code);
    }
    await insertBookings(tx, actor, job.id, ok);
    if (ok.length > 0) {
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "job.instruments_booked",
        entityType: "job",
        entityId: job.id,
        summary: `${actor.name} booked ${shortList(result.booked)} for job ${job.number}`,
        after: result,
        request,
      });
    }
    await syncReadiness(tx, actor, job, request);
    return result;
  });
}

export async function releaseInstruments(
  db: Database,
  actor: SessionUser,
  jobId: string,
  instrumentIds: string[],
  request?: RequestInfo,
): Promise<number> {
  assertCan(actor, "jobs.manage");
  if (instrumentIds.some((id) => !isUuid(id))) throw new JobsError("An instrument does not exist.");
  if (instrumentIds.length === 0) return 0;
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    assertCanBook(job);
    const removed = await tx
      .delete(jobInstruments)
      .where(
        and(eq(jobInstruments.jobId, job.id), inArray(jobInstruments.instrumentId, instrumentIds)),
      )
      .returning({ id: jobInstruments.instrumentId });
    if (removed.length > 0) {
      const codes = await tx
        .select({ code: instruments.code })
        .from(instruments)
        .where(
          inArray(
            instruments.id,
            removed.map((r) => r.id),
          ),
        );
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "job.instruments_released",
        entityType: "job",
        entityId: job.id,
        summary: `${actor.name} released ${shortList(codes.map((c) => c.code))} from job ${job.number}`,
        after: { released: codes.map((c) => c.code) },
        request,
      });
    }
    await syncReadiness(tx, actor, job, request);
    return removed.length;
  });
}

// ---------------------------------------------------------------- rate card

const RATE_UNIQUE = {
  rate_cards_org_line_key:
    "There is already a price for this work, equipment type, duration and basis. Change that line instead.",
};

export async function saveRateLine(
  db: Database,
  actor: SessionUser,
  input: RateLineInput,
  id: string | null,
  request?: RequestInfo,
): Promise<RateCard> {
  assertCan(actor, "ratecard.manage");
  const v = rateLineSchema.parse(input);
  const values = { ...v, price: String(v.price) };
  return guarded(RATE_UNIQUE, () =>
    db.transaction(async (tx) => {
      if (id === null) {
        const [row] = await tx
          .insert(rateCards)
          .values({ organisationId: actor.organisationId, ...values })
          .returning();
        await recordAudit(tx, {
          organisationId: actor.organisationId,
          actor: user(actor),
          action: "rate_card.created",
          entityType: "rate_card",
          entityId: row!.id,
          summary: `${actor.name} added a rate: ${v.workType} ${v.equipmentType || "any equipment"} ₹${v.price} ${v.basis}`,
          after: values,
          request,
        });
        return row!;
      }
      if (!isUuid(id)) throw new JobsError("That rate does not exist.");
      const [current] = await tx
        .select()
        .from(rateCards)
        .where(and(eq(rateCards.id, id), eq(rateCards.organisationId, actor.organisationId)))
        .for("update");
      if (!current) throw new JobsError("That rate does not exist.");
      const [row] = await tx
        .update(rateCards)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(rateCards.id, id))
        .returning();
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "rate_card.updated",
        entityType: "rate_card",
        entityId: id,
        summary: `${actor.name} changed a rate: ${v.workType} ${v.equipmentType || "any equipment"} ₹${v.price} ${v.basis}`,
        before: current,
        after: values,
        request,
      });
      return row!;
    }),
  );
}

export async function retireRateLine(
  db: Database,
  actor: SessionUser,
  id: string,
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "ratecard.manage");
  if (!isUuid(id)) throw new JobsError("That rate does not exist.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(rateCards)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(rateCards.id, id), eq(rateCards.organisationId, actor.organisationId)))
      .returning();
    if (!row) throw new JobsError("That rate does not exist.");
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "rate_card.updated",
      entityType: "rate_card",
      entityId: id,
      summary: `${actor.name} removed a rate: ${row.workType} ${row.equipmentType || "any equipment"}`,
      before: { active: true },
      after: { active: false },
      request,
    });
  });
}
