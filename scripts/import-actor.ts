import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { users } from "@/db/schema";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";

/**
 * Who the import scripts act as (and audit): the user with this email, or, with
 * no email, the one active admin. Several admins: say which with --email.
 */
export async function importActor(db: Database, email?: string): Promise<SessionUser> {
  const rows = await db
    .select()
    .from(users)
    .where(
      email
        ? and(eq(users.email, email.trim().toLowerCase()), eq(users.status, "active"))
        : and(eq(users.role, "admin"), eq(users.status, "active")),
    );
  if (rows.length === 0) {
    throw new Error(
      email
        ? `No active user ${email}. Check the email you signed in with.`
        : "No active admin yet. Create one (npm run user:create-admin) and set its password.",
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `There are ${rows.length} admins; say which one this is with --email (${rows.map((r) => r.email).join(", ")}).`,
    );
  }
  const actor = toSessionUser(rows[0]!);
  if (!actor) throw new Error("That user's role is not one QTech knows.");
  return actor;
}
