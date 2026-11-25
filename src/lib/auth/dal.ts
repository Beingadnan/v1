import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db/client";
import { can, type Action } from "@/domain/auth/permissions";
import { validateSession, type SessionUser } from "@/domain/auth/session-service";

import { rememberedSession } from "./session-cache";
import { readSessionCookie } from "./session-cookie";

/**
 * Data access layer for authentication. Every page, server action and route
 * handler that needs a user calls these; the proxy's cookie check is only an
 * early redirect, never the real check.
 *
 * `cache` makes repeated calls within one request share one database lookup.
 */
export const getCurrentSession = cache(
  async (): Promise<{ user: SessionUser; sessionId: string } | null> => {
    const token = await readSessionCookie();
    // A server action changes data, so it always checks the session in the database:
    // a sign-out, deactivation or role change elsewhere stops it at once on every
    // server. Page loads only read, and keep the few-second memory (ADR 0018).
    if ((await headers()).has("next-action")) return validateSession(db, token);
    return rememberedSession(token, () => validateSession(db, token));
  },
);

export async function requireUser(): Promise<SessionUser & { sessionId: string }> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return { ...session.user, sessionId: session.sessionId };
}

/**
 * For server actions behind long forms (a readings sheet): the user, or null
 * when the session has ended. Unlike requireUser it does not navigate away, so
 * the form can say so and keep everything the person typed.
 */
export async function userForAction(): Promise<(SessionUser & { sessionId: string }) | null> {
  const session = await getCurrentSession();
  return session ? { ...session.user, sessionId: session.sessionId } : null;
}

export const SESSION_ENDED =
  "You were signed out after 30 minutes without activity. Nothing you typed is lost: sign in again in a new tab, then come back here and press Save.";

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
