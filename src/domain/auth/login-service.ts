import "server-only";

import { and, count, eq, gt, ne, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { loginAttempts, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import { checkCredentials, verifyAgainstDummy } from "./credentials";
import { AUTH_POLICY, type RequestInfo } from "./policy";
import { createSession } from "./session-service";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; userId: string }
  | {
      ok: false;
      reason: "invalid" | "locked" | "deactivated" | "throttled";
      message: string;
    };

const INVALID = "Email or password is incorrect.";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export async function login(
  db: Database,
  input: { email: string; password: string; request: RequestInfo },
  now = new Date(),
): Promise<LoginResult> {
  const emailLower = input.email.trim().toLowerCase();
  const ip = input.request.ipAddress ?? null;

  // Throttle an address that keeps failing, before any expensive work.
  if (ip) {
    const since = new Date(now.getTime() - AUTH_POLICY.ipWindowMinutes * 60_000);
    const [recent] = await db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          sql`${loginAttempts.ipAddress} = ${ip}::inet`,
          gt(loginAttempts.attemptedAt, since),
          ne(loginAttempts.outcome, "success"),
        ),
      );
    if ((recent?.n ?? 0) >= AUTH_POLICY.ipFailureLimit) {
      await db.insert(loginAttempts).values({ emailLower, ipAddress: ip, outcome: "throttled" });
      return {
        ok: false,
        reason: "throttled",
        message: "Too many failed sign-ins from this network. Wait 15 minutes and try again.",
      };
    }
  }

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${emailLower}`)
      .for("update");

    if (!user) {
      await verifyAgainstDummy(input.password);
      await tx
        .insert(loginAttempts)
        .values({ emailLower, ipAddress: ip, outcome: "bad_credentials" });
      return { ok: false as const, reason: "invalid" as const, message: INVALID };
    }

    const check = await checkCredentials(
      tx,
      user,
      input.password,
      {
        request: input.request,
        via: "login",
      },
      now,
    );

    if (check.outcome === "locked") {
      await tx.insert(loginAttempts).values({ emailLower, ipAddress: ip, outcome: "locked" });
      return {
        ok: false as const,
        reason: "locked" as const,
        message: `Too many wrong passwords. Try again after ${formatTime(check.lockedUntil)}, or ask an admin to reset your password.`,
      };
    }

    if (check.outcome === "bad_password") {
      await tx
        .insert(loginAttempts)
        .values({ emailLower, ipAddress: ip, outcome: "bad_credentials" });
      await recordAudit(tx, {
        organisationId: user.organisationId,
        actor: { type: "system" },
        action: "user.login_failed",
        entityType: "user",
        entityId: user.id,
        summary: `Failed sign-in for ${user.email}`,
        request: input.request,
      });
      return { ok: false as const, reason: "invalid" as const, message: INVALID };
    }

    // Correct password from here on, so it is safe to say why access is refused.
    if (user.status !== "active") {
      await tx.insert(loginAttempts).values({ emailLower, ipAddress: ip, outcome: "inactive" });
      return {
        ok: false as const,
        reason: "deactivated" as const,
        message: "Your account is not active. Ask an admin to reactivate it.",
      };
    }

    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    const session = await createSession(tx, user.id, input.request, now);
    await tx.insert(loginAttempts).values({ emailLower, ipAddress: ip, outcome: "success" });
    await recordAudit(tx, {
      organisationId: user.organisationId,
      actor: { type: "user", userId: user.id },
      action: "user.login_succeeded",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} signed in`,
      request: input.request,
    });
    return {
      ok: true as const,
      token: session.token,
      expiresAt: session.expiresAt,
      userId: user.id,
    };
  });
}
