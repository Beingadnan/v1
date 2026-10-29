import "server-only";

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  auditLog,
  clientCompanies,
  clientContacts,
  clientDepartments,
  clientSites,
  equipment,
  users,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";

import { isUuid } from "./shared";

/** Next due date in SQL; same rule as nextDueDate() (anniversary minus one day). */
const nextDueSql = sql<string | null>`(
  ${equipment.lastStudyOn}
  + make_interval(months => coalesce(${equipment.requalificationMonths}, ${clientCompanies.requalificationMonths}))
  - interval '1 day'
)::date::text`;

/** Escapes % and _ so a search for "50%" matches literally. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listCompanies(db: Database, actor: SessionUser, search?: string) {
  assertCan(actor, "clients.view");
  const conditions: SQL[] = [eq(clientCompanies.organisationId, actor.organisationId)];
  const term = search?.trim().slice(0, 100);
  if (term) {
    const pattern = likePattern(term);
    conditions.push(
      or(
        ilike(clientCompanies.name, pattern),
        ilike(clientCompanies.code, pattern),
        sql`exists (select 1 from ${equipment} where ${equipment.companyId} = ${clientCompanies.id} and ${equipment.code} ilike ${pattern})`,
        sql`exists (select 1 from ${clientSites} where ${clientSites.companyId} = ${clientCompanies.id} and ${clientSites.name} ilike ${pattern})`,
      )!,
    );
  }
  const siteCount = sql<number>`(select count(*)::int from ${clientSites} where ${clientSites.companyId} = ${clientCompanies.id} and ${clientSites.active})`;
  const equipmentStats = db
    .select({
      companyId: equipment.companyId,
      count: sql<number>`count(*)::int`.as("count"),
      nextDue: sql<string | null>`min(${nextDueSql})`.as("next_due"),
    })
    .from(equipment)
    .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
    .where(and(eq(equipment.organisationId, actor.organisationId), eq(equipment.active, true)))
    .groupBy(equipment.companyId)
    .as("equipment_stats");

  return db
    .select({
      id: clientCompanies.id,
      name: clientCompanies.name,
      code: clientCompanies.code,
      active: clientCompanies.active,
      siteCount,
      equipmentCount: sql<number>`coalesce(${equipmentStats.count}, 0)`,
      nextDue: equipmentStats.nextDue,
    })
    .from(clientCompanies)
    .leftJoin(equipmentStats, eq(equipmentStats.companyId, clientCompanies.id))
    .where(and(...conditions))
    .orderBy(sql`${clientCompanies.active} desc`, asc(sql`lower(${clientCompanies.name})`));
}

export async function getCompany(db: Database, actor: SessionUser, companyId: string) {
  assertCan(actor, "clients.view");
  if (!isUuid(companyId)) return null;
  const [company] = await db
    .select()
    .from(clientCompanies)
    .where(
      and(
        eq(clientCompanies.id, companyId),
        eq(clientCompanies.organisationId, actor.organisationId),
      ),
    );
  if (!company) return null;

  const [sites, departments, contacts, equipmentRows, clientUsers] = await Promise.all([
    db
      .select()
      .from(clientSites)
      .where(eq(clientSites.companyId, company.id))
      .orderBy(sql`${clientSites.active} desc`, asc(sql`lower(${clientSites.name})`)),
    db
      .select()
      .from(clientDepartments)
      .where(eq(clientDepartments.companyId, company.id))
      .orderBy(asc(sql`lower(${clientDepartments.name})`)),
    db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.companyId, company.id))
      .orderBy(sql`${clientContacts.active} desc`, asc(sql`lower(${clientContacts.name})`)),
    db
      .select({
        id: equipment.id,
        code: equipment.code,
        name: equipment.name,
        type: equipment.type,
        siteId: equipment.siteId,
        departmentId: equipment.departmentId,
        location: equipment.location,
        setPointC: equipment.setPointC,
        tempMinC: equipment.tempMinC,
        tempMaxC: equipment.tempMaxC,
        rhMinPct: equipment.rhMinPct,
        rhMaxPct: equipment.rhMaxPct,
        defaultChannels: equipment.defaultChannels,
        lastStudyOn: equipment.lastStudyOn,
        nextDue: nextDueSql,
        active: equipment.active,
      })
      .from(equipment)
      .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
      .where(eq(equipment.companyId, company.id))
      .orderBy(sql`${equipment.active} desc`, asc(sql`lower(${equipment.code})`)),
    // Client user accounts are only shown to people who can see users.
    can(actor, "users.view")
      ? db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            status: users.status,
            lastLoginAt: users.lastLoginAt,
          })
          .from(users)
          .where(
            and(
              eq(users.clientCompanyId, company.id),
              eq(users.organisationId, actor.organisationId),
            ),
          )
          .orderBy(asc(users.name))
      : Promise.resolve([]),
  ]);

  return { company, sites, departments, contacts, equipment: equipmentRows, clientUsers };
}

export async function getEquipment(db: Database, actor: SessionUser, equipmentId: string) {
  assertCan(actor, "clients.view");
  if (!isUuid(equipmentId)) return null;
  const [row] = await db
    .select({ equipment, company: clientCompanies, nextDue: nextDueSql })
    .from(equipment)
    .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
    .where(and(eq(equipment.id, equipmentId), eq(equipment.organisationId, actor.organisationId)));
  return row ?? null;
}

/** Who changed this equipment and when, newest first (from the audit trail). */
export async function getEquipmentHistory(db: Database, actor: SessionUser, equipmentId: string) {
  assertCan(actor, "clients.view");
  if (!isUuid(equipmentId)) return [];
  return db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      summary: auditLog.summary,
      reason: auditLog.reason,
      actorName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.organisationId, actor.organisationId),
        eq(auditLog.entityType, "equipment"),
        eq(auditLog.entityId, equipmentId),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(50);
}
