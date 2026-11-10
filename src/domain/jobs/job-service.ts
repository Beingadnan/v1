import "server-only";

import { reads } from "@/db/reads";

import { and, asc, eq, inArray, ne, sql, type SQLWrapper } from "drizzle-orm";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientCompanies,
  clientContracts,
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
  sites,
  storedFiles,
  studies,
  users,
  type Job,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
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
import { computeReadiness, needsMasters, validThrough, type ReadinessInput } from "./readiness";
import {
  jobHeaderSchema,
  jobSchema,
  orderSchema,
  readinessSchema,
  studyEditSchema,
  teamInputSchema,
  type JobHeaderInput,
  type JobInput,
  type OrderInput,
  type StudyEditInput,
} from "./schemas";
import { defaultLoggerCount, defaultWorkType, seasonFor, uniqueReportNumber } from "./studies";
import {
  FINISHED,
  HOLDS_INSTRUMENTS,
  JOB_STATUS_LABELS,
  ORDER_TYPE_SHORT,
  PLANNING,
  READINESS_ITEMS,
  TRANSITIONS,
  canTransition,
  isContractType,
  isJobStatus,
  type JobStatus,
  type OrderType,
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
  job: Pick<
    Job,
    | "id"
    | "poNumber"
    | "plannedStart"
    | "plannedEnd"
    | "orderType"
    | "contractId"
    | "gatePassNumber"
    | "gatePassNotNeeded"
  >,
): Promise<ReadinessInput & { bookedIds: string[] }> {
  const [studyRows, booked, manualRows, contractRows, certs] = await reads(tx, [
    () =>
      tx
        .select({
          workType: studies.workType,
          loggerCount: studies.loggerCount,
          preCalRequired: studies.preCalRequired,
          postCalRequired: studies.postCalRequired,
          durationHours: studies.durationHours,
          cycles: studies.cycles,
          label: equipment.code,
          lastStudyOn: equipment.lastStudyOn,
          // The last report of this equipment signed in QTech, on another job.
          previousReport: sql<string | null>`(
            select p.report_number from studies p
            where p.equipment_id = ${studies.equipmentId}
              and p.job_id <> ${studies.jobId}
              and p.archived_at is not null
            order by p.archived_at desc limit 1)`,
        })
        .from(studies)
        .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
        .where(eq(studies.jobId, job.id)),
    () =>
      tx
        .select({
          id: instruments.id,
          code: instruments.code,
          type: instruments.type,
          tier: instruments.tier,
          status: instruments.status,
        })
        .from(jobInstruments)
        .innerJoin(instruments, eq(instruments.id, jobInstruments.instrumentId))
        .where(eq(jobInstruments.jobId, job.id)),
    () => tx.select().from(jobReadiness).where(eq(jobReadiness.jobId, job.id)),
    () =>
      job.contractId
        ? tx
            .select({
              kind: clientContracts.kind,
              number: clientContracts.number,
              validFrom: clientContracts.validFrom,
              validTo: clientContracts.validTo,
            })
            .from(clientContracts)
            .where(
              and(
                eq(clientContracts.id, job.contractId),
                eq(clientContracts.organisationId, organisationId),
              ),
            )
        : Promise.resolve([]),
    // Their certificates in the same round: the instruments by subquery, not by the ids above.
    () => certificatesOf(tx, organisationId, bookedOn(tx, job.id)),
  ]);
  return {
    orderType: job.orderType as OrderType,
    gatePass: { number: job.gatePassNumber, notNeeded: job.gatePassNotNeeded },
    poNumber: job.poNumber,
    contract: contractRows[0] ?? null,
    plannedStart: job.plannedStart,
    plannedEnd: job.plannedEnd,
    studies: studyRows.map((s) => ({
      workType: s.workType as ReadinessInput["studies"][number]["workType"],
      loggerCount: s.loggerCount,
      preCalRequired: s.preCalRequired,
      postCalRequired: s.postCalRequired,
      durationHours: s.durationHours,
      cycleCount: s.cycles.length,
      label: s.label,
    })),
    booked: booked.map((b) => ({ ...b, certificates: certs.get(b.id) ?? [] })),
    bookedIds: booked.map((b) => b.id),
    previousReports: studyRows
      .filter((s) => s.lastStudyOn !== null || s.previousReport !== null)
      .map((s) => ({ label: s.label, lastStudyOn: s.lastStudyOn, report: s.previousReport })),
    // Rows for items no longer shown ("dates_fit", "protocol") stay stored and are left out.
    manual: Object.fromEntries(
      manualRows
        .filter((r) => (READINESS_ITEMS as readonly string[]).includes(r.key))
        .map((r) => [r.key, { state: r.state as "ready" | "pending" | "na", note: r.note }]),
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
    const pending = result.items
      .filter((i) => i.state === "pending" && i.blocking)
      .map((i) => i.label);
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
    preCal?: boolean;
    postCal?: boolean;
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
      // Yes/no per study, from the job form; else the client's SOP. Thermal validation always has both.
      preCalRequired: workType === "thermal_validation" || (opt.preCal ?? company.postCal),
      postCalRequired: workType === "thermal_validation" || (opt.postCal ?? company.postCal),
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

// ---------------------------------------------------------------- the client's order

/**
 * Checks the order fields: a contract (ARC/AMC) must be this client's and of
 * the kind picked. A PO or SRF carries no contract. Returns the contract id to
 * store.
 */
async function checkOrder(
  tx: Transaction,
  organisationId: string,
  companyId: string,
  v: { orderType: OrderType; contractId: string | null },
): Promise<string | null> {
  if (!isContractType(v.orderType) || v.contractId === null) return null;
  const [c] = await tx
    .select({ kind: clientContracts.kind, companyId: clientContracts.companyId })
    .from(clientContracts)
    .where(
      and(eq(clientContracts.id, v.contractId), eq(clientContracts.organisationId, organisationId)),
    );
  if (!c || c.companyId !== companyId) throw new JobsError("That contract isn't this client's.");
  if (c.kind !== v.orderType) {
    throw new JobsError(
      `That contract is an ${ORDER_TYPE_SHORT[c.kind as OrderType]}, not an ${ORDER_TYPE_SHORT[v.orderType]}.`,
    );
  }
  return v.contractId;
}

/**
 * Records the client's order when it comes (after the job was made, at any
 * stage until the job is closed): the PO or SRF number with its copy, or the
 * ARC/AMC that covers the job. Managers and accounts can do it.
 */
export async function recordOrder(
  db: Database,
  actor: SessionUser,
  jobId: string,
  input: OrderInput,
  request?: RequestInfo,
): Promise<void> {
  if (!can(actor, "jobs.manage") && !can(actor, "billing.record")) assertCan(actor, "jobs.manage");
  const v = orderSchema.parse(input);
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    if (status(job) === "cancelled" || status(job) === "closed") {
      throw new JobsError(`This job is ${JOB_STATUS_LABELS[status(job)]}.`);
    }
    const contractId = await checkOrder(tx, actor.organisationId, job.companyId, v);
    if (v.fileId) {
      const [file] = await tx
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(
          and(eq(storedFiles.id, v.fileId), eq(storedFiles.organisationId, actor.organisationId)),
        );
      if (!file) throw new JobsError("Upload the copy again.");
    }
    const after = {
      orderType: v.orderType,
      poNumber: v.poNumber,
      poDate: v.poDate,
      poValue: toNumeric(v.poValue),
      contractId,
      // A new copy replaces the old one; leaving it out keeps what is there.
      orderFileId: v.fileId ?? job.orderFileId,
    };
    const before = Object.fromEntries(
      Object.keys(after).map((k) => [k, job[k as keyof typeof after]]),
    );
    await tx
      .update(jobs)
      .set({ ...after, updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
    const label = isContractType(v.orderType)
      ? `${ORDER_TYPE_SHORT[v.orderType]}${contractId ? "" : " (contract not picked yet)"}`
      : `${ORDER_TYPE_SHORT[v.orderType]} ${v.poNumber || "(number to come)"}`;
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.order_recorded",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} recorded the client's order on job ${job.number}: ${label}${v.fileId ? ", copy attached" : ""}`,
      before,
      after,
      request,
    });
    Object.assign(job, after);
    await syncReadiness(tx, actor, job, request);
  });
}

// ---------------------------------------------------------------- the client's gate pass

/**
 * The client's entry gate pass for QA Tech's instruments (QA Tech, Nov
 * 2026): its number and scan, or "not needed" for a site without one. The
 * job page asks for it before the booking, and prints the list of booked
 * instruments for the client's security.
 */
export async function recordGatePass(
  db: Database,
  actor: SessionUser,
  jobId: string,
  input: { number?: unknown; notNeeded?: unknown; fileId?: unknown },
  request?: RequestInfo,
): Promise<void> {
  assertCan(actor, "jobs.manage");
  const number = typeof input.number === "string" ? input.number.trim().slice(0, 60) : "";
  const notNeeded =
    input.notNeeded === true || input.notNeeded === "on" || input.notNeeded === "yes";
  const fileId = typeof input.fileId === "string" && input.fileId ? input.fileId : null;
  if (!number && !notNeeded) {
    throw new JobsError("Enter the gate pass number, or mark it not needed.");
  }
  if (fileId && !isUuid(fileId)) throw new JobsError("Upload the scan again.");
  await db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    if (status(job) === "cancelled" || status(job) === "closed") {
      throw new JobsError(`This job is ${JOB_STATUS_LABELS[status(job)]}.`);
    }
    if (fileId) {
      const [file] = await tx
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(
          and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, actor.organisationId)),
        );
      if (!file) throw new JobsError("Upload the scan again.");
    }
    const after = {
      gatePassNumber: notNeeded ? "" : number,
      gatePassNotNeeded: notNeeded,
      gatePassFileId: notNeeded ? null : (fileId ?? job.gatePassFileId),
    };
    await tx
      .update(jobs)
      .set({ ...after, updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.gate_pass_recorded",
      entityType: "job",
      entityId: job.id,
      summary: notNeeded
        ? `${actor.name} marked job ${job.number} as needing no gate pass`
        : `${actor.name} recorded gate pass ${number} on job ${job.number}${fileId ? " with its scan" : ""}`,
      before: {
        gatePassNumber: job.gatePassNumber,
        gatePassNotNeeded: job.gatePassNotNeeded,
        gatePassFileId: job.gatePassFileId,
      },
      after,
      request,
    });
    Object.assign(job, after);
    await syncReadiness(tx, actor, job, request);
  });
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
          orderType: v.orderType,
          contractId: await checkOrder(tx, actor.organisationId, company.id, v),
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
      orderType: v.orderType,
      contractId: await checkOrder(tx, actor.organisationId, job.companyId, v),
      poNumber: v.poNumber,
      poDate: v.poDate,
      // Without money rights the form has no value fields: keep what is there.
      poValue: can(actor, "jobs.money") ? toNumeric(v.poValue) : job.poValue,
      // The custom quote went with the rate card: old jobs keep theirs.
      quotedValue: job.quotedValue,
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
    // Thermal validation always has pre- and post-calibration.
    const thermal = v.workType === "thermal_validation";
    const after = {
      ...v,
      preCalRequired: thermal || v.preCalRequired,
      postCalRequired: thermal || v.postCalRequired,
    };
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
        preCalRequired: study.preCalRequired,
        postCalRequired: study.postCalRequired,
      },
      after,
      request,
    });
    await syncReadiness(tx, actor, job, request);
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
/** The instruments booked on a job, as a subquery for `inArray` (ADR 0018). */
export function bookedOn(tx: Transaction | Database, jobId: string) {
  return tx
    .select({ id: jobInstruments.instrumentId })
    .from(jobInstruments)
    .where(eq(jobInstruments.jobId, jobId));
}

export async function busyInstruments(
  tx: Transaction | Database,
  organisationId: string,
  job: Pick<Job, "id" | "plannedStart" | "plannedEnd">,
  /** Ids, or a subquery of ids such as bookedOn(job). */
  instrumentIds?: string[] | SQLWrapper,
): Promise<Map<string, string[]>> {
  if (Array.isArray(instrumentIds) && instrumentIds.length === 0) return new Map();
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
  tx: Transaction | Database,
  actor: SessionUser,
  job: Job,
  where: { types?: string[]; ids?: string[] },
): Promise<Candidate[]> {
  const filter = and(
    eq(instruments.organisationId, actor.organisationId),
    where.types ? inArray(instruments.type, where.types) : undefined,
    where.ids ? inArray(instruments.id, where.ids) : undefined,
  );
  // The instruments, their certificates and their other bookings in one round: the
  // last two take the same filter as a subquery (ADR 0018).
  const matching = tx.select({ id: instruments.id }).from(instruments).where(filter);
  const [rows, certs, busy] = await reads(tx, [
    () =>
      tx
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
        .where(filter)
        .orderBy(asc(instruments.code)),
    () => certificatesOf(tx, actor.organisationId, matching),
    () => busyInstruments(tx, actor.organisationId, job, matching),
  ]);
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
 * Books the masters pre/post-calibration needs. QA Tech chooses its loggers
 * by hand (Nov 2026), so the screens no longer pick loggers; `loggers: true`
 * still books what the studies need plus spares, for seeding demo data.
 */
export async function autoBook(
  db: Database,
  actor: SessionUser,
  jobId: string,
  request?: RequestInfo,
  options: { loggers?: boolean } = {},
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
      if (type && options.loggers) need.set(type, (need.get(type) ?? 0) + s.loggerCount);
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
      if (
        input.studies.some(
          (s) => s.workType === "temperature_rh_mapping" && (s.postCalRequired || s.preCalRequired),
        )
      ) {
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
  /** Only this model (its label, e.g. "Testo 174H"): QA Tech books one model at a time. */
  model?: string,
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
      if (model && c.tier !== "master" && c.modelLabel !== model) {
        result.refused.push({
          code: c.code,
          reason: `is a ${c.modelLabel || "logger of no model"}, not a ${model}`,
        });
        continue;
      }
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

/** Where a logger stands for this job's dates (QA Tech, Nov 2026). */
export type LoggerState = "free" | "booked" | "busy" | "out_of_date" | "not_in_use";

export type BookingLogger = {
  code: string;
  serialNo: string;
  validUntil: string | null;
  state: LoggerState;
  /** Why it isn't free, or where it is: "On QT/11/2026/0003 · Glenmark, Indore · 12.11–14.11". */
  where: string;
};

export type BookingChoices = {
  /** What the studies need, per instrument type. */
  needs: { type: string; needed: number; booked: number }[];
  /** Per model of those types: every logger and where it stands for this job. */
  models: {
    label: string;
    type: string;
    total: number;
    booked: number;
    busy: number;
    outOfDate: number;
    notInUse: number;
    free: { code: string; serialNo: string; validUntil: string | null }[];
    loggers: BookingLogger[];
  }[];
};

const dm = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7);
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const NOT_IN_USE: Record<string, string> = {
  out_of_service: "Out of service",
  retired: "Retired",
  lost: "Lost",
};

/**
 * What can be booked on a job, model by model (QA Tech, Nov 2026): the
 * person picks the model and sees every logger: free ones to pick, and for
 * the rest why not and where they are (the other job, its client and dates;
 * the calibration due date; out of service). Free means in use, calibrated
 * through the job's dates and on no other job on those dates.
 */
export async function bookingChoices(
  db: Database,
  actor: SessionUser,
  jobId: string,
  /** The job and its readiness when the caller already read them (the job page). */
  loaded?: { job: Job; input?: Awaited<ReturnType<typeof readinessInputFor>> },
): Promise<BookingChoices> {
  assertCan(actor, "jobs.view");
  if (!isUuid(jobId)) throw new JobsError("That job does not exist.");
  const [job] =
    loaded && loaded.job.id === jobId && loaded.job.organisationId === actor.organisationId
      ? [loaded.job]
      : await db
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, actor.organisationId)));
  if (!job) throw new JobsError("That job does not exist.");
  // The studies' needs and the loggers in one round: every logger type is read (there
  // are two) rather than waiting for the studies to say which one (ADR 0018).
  const loggerTypes = [
    ...new Set(Object.values(INSTRUMENT_FOR).filter((t): t is string => t !== null)),
  ];
  const [input, allPool, serials, holders, homes] = await Promise.all([
    loaded?.input ?? readinessInputFor(db, actor.organisationId, job),
    candidates(db, actor, job, { types: loggerTypes }),
    db
      .select({ id: instruments.id, serialNo: instruments.serialNo })
      .from(instruments)
      .where(
        and(
          eq(instruments.organisationId, actor.organisationId),
          inArray(instruments.type, loggerTypes),
        ),
      ),
    // The other jobs holding loggers on these dates, with their client and dates.
    db
      .select({
        instrumentId: jobInstruments.instrumentId,
        number: jobs.number,
        start: jobs.plannedStart,
        end: jobs.plannedEnd,
        client: clientCompanies.code,
        site: clientSites.name,
      })
      .from(jobInstruments)
      .innerJoin(jobs, eq(jobs.id, jobInstruments.jobId))
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .leftJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
      .where(
        and(
          eq(jobInstruments.organisationId, actor.organisationId),
          ne(jobs.id, job.id),
          inArray(jobs.status, [...HOLDS_INSTRUMENTS]),
          sql`${jobs.plannedStart} <= ${job.plannedEnd} and ${jobs.plannedEnd} >= ${job.plannedStart}`,
        ),
      ),
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(eq(sites.organisationId, actor.organisationId)),
  ]);
  const needed = new Map<string, number>();
  for (const s of input.studies) {
    const type = INSTRUMENT_FOR[s.workType];
    if (type) needed.set(type, (needed.get(type) ?? 0) + s.loggerCount);
  }
  const types = [...needed.keys()];
  if (types.length === 0) return { needs: [], models: [] };
  const pool = allPool.filter((c) => types.includes(c.type));
  const serialOf = new Map(serials.map((r) => [r.id, r.serialNo]));
  const heldBy = new Map<string, string[]>();
  for (const h of holders) {
    const where = [
      `On ${h.number}`,
      [h.client, h.site].filter(Boolean).join(", "),
      `${dm(h.start)}–${dm(h.end)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    heldBy.set(h.instrumentId, [...(heldBy.get(h.instrumentId) ?? []), where]);
  }
  const homeOf = new Map(homes.map((h) => [h.id, h.name]));
  const booked = new Set(input.bookedIds);
  const models = new Map<string, BookingChoices["models"][number]>();
  for (const c of pool.filter((x) => x.tier !== "master")) {
    const key = `${c.type}|${c.modelLabel}`;
    const m = models.get(key) ?? {
      label: c.modelLabel || "No model",
      type: c.type,
      total: 0,
      booked: 0,
      busy: 0,
      outOfDate: 0,
      notInUse: 0,
      free: [],
      loggers: [],
    };
    const due =
      c.certificates
        .map((x) => x.validUntil)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null;
    const base = { code: c.code, serialNo: serialOf.get(c.id) ?? "", validUntil: due };
    const home = c.homeSiteId ? homeOf.get(c.homeSiteId) : null;
    m.total += 1;
    if (booked.has(c.id)) {
      m.booked += 1;
      m.loggers.push({ ...base, state: "booked", where: "Booked on this job" });
    } else if (c.status !== "active") {
      m.notInUse += 1;
      m.loggers.push({
        ...base,
        state: "not_in_use",
        where: NOT_IN_USE[c.status] ?? "Not in use",
      });
    } else if (c.busyOn.length > 0) {
      m.busy += 1;
      m.loggers.push({
        ...base,
        state: "busy",
        where: (heldBy.get(c.id) ?? c.busyOn.map((n) => `On ${n}`)).join("; "),
      });
    } else if (!validThrough(c, job.plannedStart, job.plannedEnd).ok) {
      m.outOfDate += 1;
      m.loggers.push({
        ...base,
        state: "out_of_date",
        where: due
          ? `Calibration due ${dmy(due)}, before the job ends ${dmy(job.plannedEnd)}`
          : "No calibration certificate",
      });
    } else {
      m.free.push(base);
      m.loggers.push({ ...base, state: "free", where: home ? `Free · at ${home}` : "Free" });
    }
    models.set(key, m);
  }
  // IDs in the order people count them: T-TRH017, T-TRH018 … T-TRH0173 (QA Tech's IDs
  // have 3 and 4 digits), not as text, which put T-TRH0173 between 017 and 018.
  const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  for (const m of models.values()) {
    m.loggers.sort((a, b) => natural.compare(a.code, b.code));
    m.free.sort((a, b) => natural.compare(a.code, b.code));
  }
  return {
    needs: types.map((type) => ({
      type,
      needed: needed.get(type)!,
      booked: input.booked.filter((b) => b.type === type && b.tier !== "master").length,
    })),
    // Most free first: the model QA Tech can take a whole set of.
    models: [...models.values()].sort(
      (a, b) => b.free.length - a.free.length || a.label.localeCompare(b.label),
    ),
  };
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
