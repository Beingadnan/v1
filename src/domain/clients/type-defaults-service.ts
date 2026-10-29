import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor } from "@/db/client-factory";
import { equipmentTypeDefaults } from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { recordAudit } from "@/lib/audit";

import { EQUIPMENT_TYPE_INFO, EQUIPMENT_TYPES, type EquipmentType } from "./equipment-types";
import { typeDefaultsSchema } from "./schemas";
import { diff, toNumeric } from "./shared";
import { BUILT_IN_TYPE_DEFAULTS, type StudyCycle, type TypeDefaults } from "./study-defaults";

const num = (v: string | null) => (v === null ? null : Number(v));

/** Settings values where saved, built-in values otherwise. */
export async function getEffectiveTypeDefaults(
  executor: DbExecutor,
  organisationId: string,
): Promise<Record<EquipmentType, TypeDefaults & { customised: boolean }>> {
  const rows = await executor
    .select()
    .from(equipmentTypeDefaults)
    .where(eq(equipmentTypeDefaults.organisationId, organisationId));
  const saved = new Map(rows.map((r) => [r.type, r]));
  return Object.fromEntries(
    EQUIPMENT_TYPES.map((type) => {
      const row = saved.get(type);
      const value: TypeDefaults & { customised: boolean } = row
        ? {
            setPointC: num(row.setPointC),
            tempMinC: num(row.tempMinC),
            tempMaxC: num(row.tempMaxC),
            rhMinPct: num(row.rhMinPct),
            rhMaxPct: num(row.rhMaxPct),
            defaultChannels: row.defaultChannels,
            readingIntervalMinutes: row.readingIntervalMinutes,
            studyDurationHours: row.studyDurationHours,
            requalificationMonths: row.requalificationMonths,
            cycles: row.cycles as StudyCycle[],
            seasonalMapping: row.seasonalMapping,
            customised: true,
          }
        : { ...BUILT_IN_TYPE_DEFAULTS[type], customised: false };
      return [type, value];
    }),
  ) as Record<EquipmentType, TypeDefaults & { customised: boolean }>;
}

export async function saveTypeDefaults(
  db: Database,
  actor: SessionUser,
  type: string,
  input: Record<string, unknown>,
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "settings.manage");
  const equipmentType = z.enum(EQUIPMENT_TYPES).parse(type);
  const values = typeDefaultsSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = (await getEffectiveTypeDefaults(tx, actor.organisationId))[equipmentType];
    const { before, after, changed } = diff(current, values);
    if (changed.length === 0) return { changed };
    const row = {
      ...values,
      setPointC: toNumeric(values.setPointC),
      tempMinC: toNumeric(values.tempMinC),
      tempMaxC: toNumeric(values.tempMaxC),
      rhMinPct: toNumeric(values.rhMinPct),
      rhMaxPct: toNumeric(values.rhMaxPct),
      updatedAt: new Date(),
      updatedByUserId: actor.id,
    };
    await tx
      .insert(equipmentTypeDefaults)
      .values({ ...row, organisationId: actor.organisationId, type: equipmentType })
      .onConflictDoUpdate({
        target: [equipmentTypeDefaults.organisationId, equipmentTypeDefaults.type],
        set: row,
      });
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "settings.updated",
      entityType: "equipment_type_defaults",
      entityId: equipmentType,
      summary: `${actor.name} changed the ${EQUIPMENT_TYPE_INFO[equipmentType].label} defaults (${changed.join(", ")})`,
      before,
      after,
      request,
    });
    return { changed };
  });
}
