import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db/client";
import { can, type Action } from "@/domain/auth/permissions";
import { validateSession, type SessionUser } from "@/domain/auth/session-service";

import { readSessionCookie } from "./session-cookie";

/**
 * Data access layer for authentication. Every page, server action and route
 * handler that needs a user calls these; the proxy's cookie check is only an
 * early redirect, never the real check.
 *
 * `cache` makes repeated calls within one request share one database lookup.
 */
export const getCurrentSession = cache(
  async (): Promise<{ user: SessionUser; sessionId: string } | null> =>
    validateSession(db, await readSessionCookie()),
);

export async function requireUser(): Promise<SessionUser & { sessionId: string }> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return { ...session.user, sessionId: session.sessionId };
}

/** For pages: signed in and allowed, or sent to a plain "no access" page. */
export async function requirePermission(
  action: Action,
): Promise<SessionUser & { sessionId: string }> {
  const user = await requireUser();
  if (!can(user, action)) redirect("/no-access");
  return user;
}

/** Only what the browser needs to render the user menu. */
export type UserSummary = { name: string; email: string; role: SessionUser["role"] };

export function toUserSummary(user: SessionUser): UserSummary {
  return { name: user.name, email: user.email, role: user.role };
}
