"use server";

import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { revokeSessionByToken } from "@/domain/auth/session-service";
import { recordAudit } from "@/lib/audit";
import { getCurrentSession } from "@/lib/auth/dal";
import { forgetSessions } from "@/lib/auth/session-cache";
import { clearSessionCookie, readSessionCookie } from "@/lib/auth/session-cookie";
import { getRequestInfo } from "@/lib/request-info";

export async function signOutAction(): Promise<void> {
  const session = await getCurrentSession();
  const token = await readSessionCookie();
  if (session) {
    await db.transaction(async (tx) => {
      await revokeSessionByToken(tx, token);
      await recordAudit(tx, {
        organisationId: session.user.organisationId,
        actor: { type: "user", userId: session.user.id },
        action: "user.logged_out",
        entityType: "user",
        entityId: session.user.id,
        summary: `${session.user.name} signed out`,
        request: await getRequestInfo(),
      });
    });
  }
  forgetSessions();
  await clearSessionCookie();
  redirect("/login");
}
