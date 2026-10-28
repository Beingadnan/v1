import "server-only";

import { eq } from "drizzle-orm";

import type { Transaction } from "@/db/client-factory";
import { users, type User } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import { hashPassword, needsRehash, verifyPassword } from "./password";
import { AUTH_POLICY, type RequestInfo } from "./policy";

export type CredentialCheck =
  | { outcome: "ok" }
  | { outcome: "bad_password"; attemptsLeft: number }
  | { outcome: "locked"; lockedUntil: Date };

let dummyHashPromise: Promise<string> | null = null;

/**
 * Spend the same time as a real check when there is no account, so response
 * timing does not reveal which email addresses exist.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword("dummy password used only for timing");
  await verifyPassword(password, await dummyHashPromise);
}

/**
 * Check a password for a user row that the caller has locked FOR UPDATE in
 * `tx`, and maintain the lockout counter. Used by sign-in and by electronic
 * signatures, so guessing through either path counts toward the same lockout.
 */
export async function checkCredentials(
  tx: Transaction,
  user: User,
  password: string,
  context: { request: RequestInfo; via: "login" | "signature" },
  now = new Date(),
): Promise<CredentialCheck> {
  if (user.lockedUntil && user.lockedUntil > now) {
    await verifyAgainstDummy(password);
    return { outcome: "locked", lockedUntil: user.lockedUntil };
  }
  if (!user.passwordHash) {
    await verifyAgainstDummy(password);
    return { outcome: "bad_password", attemptsLeft: AUTH_POLICY.lockoutThreshold };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (valid) {
    const update: Partial<User> = { failedLoginCount: 0, lockedUntil: null };
    if (needsRehash(user.passwordHash)) update.passwordHash = await hashPassword(password);
    await tx.update(users).set(update).where(eq(users.id, user.id));
    return { outcome: "ok" };
  }

  const failures = user.failedLoginCount + 1;
  if (failures >= AUTH_POLICY.lockoutThreshold) {
    const lockedUntil = new Date(now.getTime() + AUTH_POLICY.lockoutMinutes * 60_000);
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil }).where(eq(users.id, user.id));
    await recordAudit(tx, {
      organisationId: user.organisationId,
      actor: { type: "system" },
      action: "user.locked_out",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name}'s account locked for ${AUTH_POLICY.lockoutMinutes} minutes after ${failures} wrong passwords (${context.via})`,
      request: context.request,
    });
    return { outcome: "locked", lockedUntil };
  }

  await tx.update(users).set({ failedLoginCount: failures }).where(eq(users.id, user.id));
  return { outcome: "bad_password", attemptsLeft: AUTH_POLICY.lockoutThreshold - failures };
}
