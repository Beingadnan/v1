import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientDepartments,
  clientSites,
  equipment,
  type ClientCompany,
  type Equipment,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { recordAudit } from "@/lib/audit";

import { ClientsError } from "./errors";
import { equipmentSchema, type EquipmentInput, type EquipmentValues } from "./schemas";
import { diff, isUuid, lockCompany, rethrowUnique, toNumeric } from "./shared";

const EQUIPMENT_UNIQUE = {
  equipment_company_code_key: "This client already has equipment with that ID.",
};

export const EQUIPMENT_LABELS: Record<string, string> = {
  siteId: "site",
  departmentId: "department",
  code: "equipment ID",
  name: "name",
  type: "type",
  location: "location",
  make: "make",
  model: "model",
  serialNo: "serial number",
  lengthM: "length",
  widthM: "width",
  heightM: "height",
  setPointC: "set point",
  tempMinC: "lowest temperature",
  tempMaxC: "highest temperature",
  rhMinPct: "lowest RH",
  rhMaxPct: "highest RH",
  defaultChannels: "number of loggers",
  readingIntervalMinutes: "reading interval",
  studyDurationHours: "study duration",
  requalificationMonths: "requalification interval",
  lastStudyOn: "last study date",
  notes: "notes",
  active: "status",
};

/** Values in the shape of the equipment table (numbers as numeric strings). */
export function toRow(values: EquipmentValues) {
  return {
    ...values,
    lengthM: toNumeric(values.lengthM),
    widthM: toNumeric(values.widthM),
    heightM: toNumeric(values.heightM),
    setPointC: toNumeric(values.setPointC),
    tempMinC: toNumeric(values.tempMinC),
    tempMaxC: toNumeric(values.tempMaxC),
    rhMinPct: toNumeric(values.rhMinPct),
    rhMaxPct: toNumeric(values.rhMaxPct),
  };
}

/** The site must belong to the company, and the department to the site. */
export async function checkPlacement(
  tx: Transaction,
  company: ClientCompany,
  values: Pick<EquipmentValues, "siteId" | "departmentId">,
): Promise<void> {
  const [site] = await tx
    .select({ id: clientSites.id })
    .from(clientSites)
    .where(and(eq(clientSites.id, values.siteId), eq(clientSites.companyId, company.id)));
  if (!site) throw new ClientsError("Choose one of this client's sites.");
  if (values.departmentId) {
    const [department] = await tx
      .select({ id: clientDepartments.id })
      .from(clientDepartments)
      .where(
        and(
          eq(clientDepartments.id, values.departmentId),
          eq(clientDepartments.siteId, values.siteId),
        ),
      );
    if (!department) throw new ClientsError("Choose a department of the selected site.");
  }
}

export async function insertEquipment(
  tx: Transaction,
  actor: SessionUser,
  company: ClientCompany,
  values: EquipmentValues,
  request: RequestInfo,
): Promise<Equipment> {
  await checkPlacement(tx, company, values);
  const [row] = await tx
    .insert(equipment)
    .values({
      ...toRow(values),
      organisationId: actor.organisationId,
      companyId: company.id,
      createdByUserId: actor.id,
    })
    .returning();
  if (!row) throw new Error("Equipment insert returned no row");
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: { type: "user", userId: actor.id },
    action: "equipment.created",
    entityType: "equipment",
    entityId: row.id,
    summary: `${actor.name} added ${row.code} (${row.name}) for ${company.name}`,
    after: values,
    request,
  });
  return row;
}

export async function createEquipment(
  db: Database,
  actor: SessionUser,
  companyId: string,
  input: EquipmentInput,
  request: RequestInfo,
): Promise<Equipment> {
  assertCan(actor, "clients.manage");
  const values = equipmentSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const company = await lockCompany(tx, actor, companyId);
      return insertEquipment(tx, actor, company, values, request);
    });
  } catch (error) {
    rethrowUnique(error, EQUIPMENT_UNIQUE);
  }
}

export async function lockEquipment(
  tx: Transaction,
  actor: SessionUser,
  equipmentId: string,
): Promise<Equipment> {
  if (!isUuid(equipmentId)) throw new ClientsError("That equipment does not exist.");
  const [row] = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.organisationId, actor.organisationId)))
    .for("update");
  if (!row) throw new ClientsError("That equipment does not exist.");
  return row;
}

/** Applies changed fields only; returns which changed. Shared with the Excel import. */
export async function applyEquipmentChanges(
  tx: Transaction,
  actor: SessionUser,
  company: ClientCompany,
  current: Equipment,
  next: EquipmentValues & { active?: boolean },
  request: RequestInfo,
  extra?: { reason?: string },
): Promise<string[]> {
  await checkPlacement(tx, company, next);
  const { before, after, changed } = diff(current, next);
  if (changed.length === 0) return changed;
  const row: Record<string, unknown> = { ...next, ...toRow(next) };
  const set = Object.fromEntries(changed.map((key) => [key, row[key]]));
  await tx
    .update(equipment)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(equipment.id, current.id));
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: { type: "user", userId: actor.id },
    action: "equipment.updated",
    entityType: "equipment",
    entityId: current.id,
    summary: `${actor.name} changed ${changed.map((k) => EQUIPMENT_LABELS[k] ?? k).join(", ")} for ${next.code}`,
    before,
    after,
    reason: extra?.reason,
    request,
  });
  return changed;
}

export async function updateEquipment(
  db: Database,
  actor: SessionUser,
  equipmentId: string,
  input: EquipmentInput,
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "clients.manage");
  const values = equipmentSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const current = await lockEquipment(tx, actor, equipmentId);
      const company = await lockCompany(tx, actor, current.companyId);
      return { changed: await applyEquipmentChanges(tx, actor, company, current, values, request) };
    });
  } catch (error) {
    rethrowUnique(error, EQUIPMENT_UNIQUE);
  }
}

/**
 * Retire equipment the client no longer has (or bring it back). Equipment is
 * never deleted: studies and reports point at it.
 */
export async function setEquipmentActive(
  db: Database,
  actor: SessionUser,
  input: { equipmentId: string; active: boolean; reason: string },
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "clients.manage");
  const reason = z.string().trim().min(3, "Give a reason.").max(2000).parse(input.reason);
  await db.transaction(async (tx) => {
    const current = await lockEquipment(tx, actor, input.equipmentId);
    if (current.active === input.active) return;
    await tx
      .update(equipment)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(equipment.id, current.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "equipment.updated",
      entityType: "equipment",
      entityId: current.id,
      summary: `${actor.name} ${input.active ? "brought back" : "retired"} ${current.code}`,
      before: { active: current.active },
      after: { active: input.active },
      reason,
      request,
    });
  });
}
