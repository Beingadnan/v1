import "server-only";

import { and, asc, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Database } from "@/db/client-factory";
import { auditLog, organisationSettings, sites, users } from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { AUDIT_ACTIONS } from "@/lib/audit";

/** Users of the actor's organisation, newest first. Never includes password data. */
export async function listUsers(db: Database, actor: SessionUser) {
  assertCan(actor, "users.view");
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.organisationId, actor.organisationId))
    .orderBy(asc(users.status), asc(users.name));
}

export async function getSettings(db: Database, actor: SessionUser) {
  assertCan(actor, "settings.view");
  const [settings] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
  const siteRows = await db
    .select()
    .from(sites)
    .where(eq(sites.organisationId, actor.organisationId))
    .orderBy(asc(sites.code));
  return { settings: settings ?? null, sites: siteRows };
}

export const AUDIT_PAGE_SIZE = 50;

export const auditFilterSchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  userId: z.string().uuid().optional().catch(undefined),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  /** Show events older than this id (keyset pagination: stable while new events arrive). */
  before: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional()
    .catch(undefined),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;

/** Dates are entered in Indian time; the database stores UTC. */
function istStartOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

export async function listAuditEvents(db: Database, actor: SessionUser, filters: AuditFilters) {
  assertCan(actor, "audit.view");
  const actorUser = alias(users, "actor_user");
  const conditions: SQL[] = [eq(auditLog.organisationId, actor.organisationId)];
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.userId) conditions.push(eq(auditLog.actorUserId, filters.userId));
  if (filters.from) conditions.push(gte(auditLog.occurredAt, istStartOfDay(filters.from)));
  if (filters.to) {
    const end = istStartOfDay(filters.to);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(lte(auditLog.occurredAt, end));
  }
  if (filters.before) conditions.push(lt(auditLog.id, BigInt(filters.before)));

  const rows = await db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      summary: auditLog.summary,
      reason: auditLog.reason,
      before: auditLog.before,
      after: auditLog.after,
      ipAddress: auditLog.ipAddress,
      actorType: auditLog.actorType,
      actorName: actorUser.name,
    })
    .from(auditLog)
    .leftJoin(actorUser, eq(actorUser.id, auditLog.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE + 1);

  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  return {
    events: page.map((r) => ({ ...r, id: r.id.toString() })),
    nextBefore: hasMore ? page.at(-1)?.id.toString() : undefined,
  };
}

/** For the audit filter: everyone who has ever acted in this organisation. */
export async function listAuditActors(db: Database, actor: SessionUser) {
  assertCan(actor, "audit.view");
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.organisationId, actor.organisationId))
    .orderBy(asc(sql`lower(${users.name})`));
}
