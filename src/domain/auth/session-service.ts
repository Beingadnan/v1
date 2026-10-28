import "server-only";

import { and, eq, isNull, ne, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client-factory";
import { organisationSettings, sessions, users, type User } from "@/db/schema";

import { AUTH_POLICY, type RequestInfo } from "./policy";
import { isRole, type Role } from "./roles";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

export type SessionUser = Pick<
  User,
  "id" | "organisationId" | "email" | "name" | "status" | "clientCompanyId"
> & { role: Role };

/** Narrow a database user row to a SessionUser; null if its role is not one the app knows. */
export function toSessionUser(
  user: Pick<User, keyof Omit<SessionUser, "role">> & { role: string },
): SessionUser | null {
  if (!isRole(user.role)) return null;
  return {
    id: user.id,
    organisationId: user.organisationId,
    email: user.email,
    name: user.name,
    status: user.status,
    clientCompanyId: user.clientCompanyId,
    role: user.role,
  };
}

export async function createSession(
  db: DbExecutor,
  userId: string,
  request: RequestInfo,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + AUTH_POLICY.sessionAbsoluteHours * 3_600_000);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ipAddress: request.ipAddress ?? null,
    userAgent: request.userAgent?.slice(0, 500) ?? null,
  });
  return { token, expiresAt };
}

/**
 * Returns the signed-in user for a session token, or null when the session is
 * missing, revoked, past its absolute limit, idle too long, or the user is no
 * longer active. This is the authoritative check behind every page and action.
 */
export async function validateSession(
  db: DbExecutor,
  token: unknown,
  now = new Date(),
): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!isWellFormedToken(token)) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      idleMinutes: organisationSettings.sessionIdleMinutes,
      user: {
        id: users.id,
        organisationId: users.organisationId,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        clientCompanyId: users.clientCompanyId,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(organisationSettings, eq(organisationSettings.organisationId, users.organisationId))
    .where(eq(sessions.tokenHash, hashToken(token)));

  if (!row || row.revokedAt || row.user.status !== "active") return null;
  if (row.expiresAt <= now) return null;
  const idleMs = (row.idleMinutes ?? AUTH_POLICY.defaultIdleMinutes) * 60_000;
  if (now.getTime() - row.lastSeenAt.getTime() > idleMs) return null;

  const user = toSessionUser(row.user);
  if (!user) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > AUTH_POLICY.touchIntervalSeconds * 1000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return { user, sessionId: row.sessionId };
}

export async function revokeSessionByToken(db: DbExecutor, token: unknown): Promise<void> {
  if (!isWellFormedToken(token)) return;
  await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Sign a user out everywhere (optionally keeping the session making the change). */
export async function revokeAllSessions(
  db: DbExecutor,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(...conditions))
    .returning({ id: sessions.id });
  return revoked.length;
}
