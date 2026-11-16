import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  capas,
  clientCompanies,
  deviations,
  equipment,
  jobs,
  studies,
  users,
  type Capa,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { notify } from "@/domain/notifications/notify";
import {
  CAPA_FLOW,
  CAPA_KINDS,
  type CapaKind,
  type CapaStatus,
} from "@/domain/notifications/types";
import { recordAudit } from "@/lib/audit";
import { move } from "@/lib/state-machine";

import { AnalysisError } from "./errors";
import { DEVIATION_DECISION_LABELS, type DeviationDecision } from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });
const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  kind: z.enum(CAPA_KINDS, { message: "Corrective or preventive?" }),
  rootCause: z.string().trim().min(5, "Write the root cause this action answers.").max(2000),
  action: z.string().trim().min(5, "Write the action.").max(2000),
  ownerUserId: z.string().uuid("Pick who owns it."),
  dueOn: z.string().regex(ISO, "Enter the due date."),
});

async function loadDeviation(tx: Transaction, actor: SessionUser, deviationId: string) {
  if (!isUuid(deviationId)) throw new AnalysisError("That deviation does not exist.");
  const [d] = await tx
    .select()
    .from(deviations)
    .where(and(eq(deviations.id, deviationId), eq(deviations.organisationId, actor.organisationId)))
    .for("update");
  if (!d) throw new AnalysisError("That deviation does not exist.");
  return d;
}

/** Raises a CAPA on a deviation: root cause, action, owner and due date. The owner is told. */
export async function createCapa(
  db: Database,
  actor: SessionUser,
  deviationId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "deviation.manage");
  const v = createSchema.parse(input);
  if (v.dueOn < todayIst()) throw new AnalysisError("The due date is in the past.");
  return db.transaction(async (tx) => {
    const d = await loadDeviation(tx, actor, deviationId);
    const [owner] = await tx
      .select({ id: users.id, name: users.name, role: users.role, status: users.status })
      .from(users)
      .where(and(eq(users.id, v.ownerUserId), eq(users.organisationId, actor.organisationId)));
    if (!owner || owner.status !== "active" || owner.role.startsWith("client_")) {
      throw new AnalysisError("Pick an active QA Tech person as the owner.");
    }
    const [c] = await tx
      .insert(capas)
      .values({
        organisationId: actor.organisationId,
        deviationId: d.id,
        kind: v.kind,
        rootCause: v.rootCause,
        action: v.action,
        ownerUserId: owner.id,
        dueOn: v.dueOn,
        createdByUserId: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "capa.created",
      entityType: "deviation",
      entityId: d.id,
      summary: `${actor.name} raised a ${v.kind} action on ${d.number} for ${owner.name}, due ${v.dueOn}`,
      after: { capaId: c!.id, ...v },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: [owner.id],
      except: actor.id,
      kind: "capa_assigned",
      title: `CAPA on ${d.number} for you, due ${v.dueOn.split("-").reverse().join(".")}`,
      body: v.action,
      href: "/deviations",
    });
    return { id: c!.id };
  });
}

async function loadCapa(tx: Transaction, actor: SessionUser, capaId: string) {
  if (!isUuid(capaId)) throw new AnalysisError("That CAPA does not exist.");
  const [c] = await tx
    .select({ c: capas, number: deviations.number })
    .from(capas)
    .innerJoin(deviations, eq(deviations.id, capas.deviationId))
    .where(and(eq(capas.id, capaId), eq(capas.organisationId, actor.organisationId)))
    .for("update", { of: capas });
  if (!c) throw new AnalysisError("That CAPA does not exist.");
  return c;
}

/** The owner (or a deviation manager) says what was done. */
export async function completeCapa(
  db: Database,
  actor: SessionUser,
  capaId: string,
  note: string,
  request?: RequestInfo,
) {
  const text = z.string().trim().min(5, "Say what was done.").max(2000).parse(note);
  return db.transaction(async (tx) => {
    const { c, number } = await loadCapa(tx, actor, capaId);
    if (c.ownerUserId !== actor.id) assertCan(actor, "deviation.manage");
    if (c.status !== "open") throw new AnalysisError("That action is already done.");
    await tx
      .update(capas)
      .set({
        status: move(CAPA_FLOW, c.status as CapaStatus, "done"),
        doneNote: text,
        doneAt: new Date(),
      })
      .where(eq(capas.id, c.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "capa.done",
      entityType: "deviation",
      entityId: c.deviationId,
      summary: `${actor.name} completed a CAPA on ${number}: ${text.slice(0, 120)}`,
      after: { capaId: c.id, doneNote: text },
      request,
    });
  });
}

/** Someone other than the owner checks it worked, and closes it. */
export async function verifyCapa(
  db: Database,
  actor: SessionUser,
  capaId: string,
  note: string,
  request?: RequestInfo,
) {
  assertCan(actor, "deviation.manage");
  const text = z
    .string()
    .trim()
    .min(5, "Write the effectiveness check: how you know it worked.")
    .max(2000)
    .parse(note);
  return db.transaction(async (tx) => {
    const { c, number } = await loadCapa(tx, actor, capaId);
    if (c.status !== "done") throw new AnalysisError("Only a completed action can be verified.");
    if (c.ownerUserId === actor.id) {
      throw new AnalysisError("The owner can't verify their own action. Someone else checks it.");
    }
    await tx
      .update(capas)
      .set({
        status: move(CAPA_FLOW, c.status as CapaStatus, "verified"),
        effectivenessNote: text,
        verifiedByUserId: actor.id,
        verifiedAt: new Date(),
      })
      .where(eq(capas.id, c.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "capa.verified",
      entityType: "deviation",
      entityId: c.deviationId,
      summary: `${actor.name} verified a CAPA on ${number}`,
      after: { capaId: c.id, effectivenessNote: text },
      request,
    });
  });
}

/** Moves an open CAPA's due date, with a reason (kept in the audit trail). */
export async function moveCapaDue(
  db: Database,
  actor: SessionUser,
  capaId: string,
  input: { dueOn: string; reason: string },
  request?: RequestInfo,
) {
  assertCan(actor, "deviation.manage");
  const v = z
    .object({
      dueOn: z.string().regex(ISO, "Enter the new due date."),
      reason: z.string().trim().min(5, "Say why the date moves.").max(500),
    })
    .parse(input);
  if (v.dueOn < todayIst()) throw new AnalysisError("The new due date is in the past.");
  return db.transaction(async (tx) => {
    const { c, number } = await loadCapa(tx, actor, capaId);
    if (c.status !== "open") throw new AnalysisError("That action is already done.");
    await tx.update(capas).set({ dueOn: v.dueOn }).where(eq(capas.id, c.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "capa.due_moved",
      entityType: "deviation",
      entityId: c.deviationId,
      summary: `${actor.name} moved a CAPA on ${number} from ${c.dueOn} to ${v.dueOn}`,
      before: { dueOn: c.dueOn },
      after: { dueOn: v.dueOn },
      reason: v.reason,
      request,
    });
  });
}

/** The Deviations page: deviations open first, then CAPAs overdue first. */
export async function deviationRegister(
  db: Database,
  actor: SessionUser,
  filter: { show?: "open" | "all" } = {},
) {
  assertCan(actor, "jobs.view");
  const today = todayIst();
  // The register's own filter, shared with its CAPAs' subquery so both go out together.
  const inRegister = and(
    eq(deviations.organisationId, actor.organisationId),
    ne(jobs.status, "cancelled"),
    filter.show === "all" ? undefined : sql`${deviations.closedAt} is null`,
  );
  const [rows, openCapas, staff, list] = await Promise.all([
    db
      .select({
        d: deviations,
        code: equipment.code,
        studyId: studies.id,
        jobNumber: jobs.number,
        company: clientCompanies.name,
      })
      .from(deviations)
      .innerJoin(studies, eq(studies.id, deviations.studyId))
      .innerJoin(jobs, eq(jobs.id, studies.jobId))
      .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .where(inRegister)
      .orderBy(asc(deviations.openedAt))
      .limit(500),
    db
      .select({
        c: capas,
        owner: users.name,
        number: deviations.number,
        studyId: deviations.studyId,
      })
      .from(capas)
      .innerJoin(users, eq(users.id, capas.ownerUserId))
      .innerJoin(deviations, eq(deviations.id, capas.deviationId))
      .where(and(eq(capas.organisationId, actor.organisationId), ne(capas.status, "verified")))
      .orderBy(asc(capas.dueOn)),
    can(actor, "deviation.manage")
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(
            and(
              eq(users.organisationId, actor.organisationId),
              eq(users.status, "active"),
              sql`${users.role} not like 'client_%'`,
            ),
          )
          .orderBy(asc(users.name))
      : Promise.resolve([]),
    db
      .select({ c: capas, owner: users.name })
      .from(capas)
      .innerJoin(users, eq(users.id, capas.ownerUserId))
      .where(
        inArray(
          capas.deviationId,
          db
            .select({ id: deviations.id })
            .from(deviations)
            .innerJoin(studies, eq(studies.id, deviations.studyId))
            .innerJoin(jobs, eq(jobs.id, studies.jobId))
            .where(inRegister)
            .orderBy(asc(deviations.openedAt))
            .limit(500),
        ),
      )
      .orderBy(asc(capas.dueOn))
      .then((r): (Capa & { owner: string })[] => r.map((x) => ({ ...x.c, owner: x.owner }))),
  ]);
  return {
    today,
    deviations: rows.map(({ d, ...r }) => ({
      id: d.id,
      number: d.number,
      title: d.title,
      source: d.source,
      openedAt: d.openedAt,
      assessed: d.assessment !== "",
      decision: d.decision ? DEVIATION_DECISION_LABELS[d.decision as DeviationDecision] : null,
      decidedBy: d.decidedByName,
      closedAt: d.closedAt,
      ...r,
      capas: list
        .filter((c) => c.deviationId === d.id)
        .map((c) => ({
          id: c.id,
          kind: c.kind as CapaKind,
          rootCause: c.rootCause,
          action: c.action,
          owner: c.owner,
          ownerUserId: c.ownerUserId,
          dueOn: c.dueOn,
          status: c.status as CapaStatus,
          doneNote: c.doneNote,
          effectivenessNote: c.effectivenessNote,
          overdue: c.status === "open" && c.dueOn < today,
        })),
    })),
    capas: openCapas.map(({ c, owner, number, studyId }) => ({
      id: c.id,
      number,
      studyId,
      kind: c.kind as CapaKind,
      action: c.action,
      owner,
      ownerUserId: c.ownerUserId,
      dueOn: c.dueOn,
      status: c.status as CapaStatus,
      overdue: c.status === "open" && c.dueOn < today,
    })),
    staff,
    can: { manage: can(actor, "deviation.manage") },
    me: actor.id,
  };
}

export type DeviationRegister = Awaited<ReturnType<typeof deviationRegister>>;
