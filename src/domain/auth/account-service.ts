import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import { accountTokens, clientCompanies, users, type User } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { machine, move } from "@/lib/state-machine";

import { checkCredentials } from "./credentials";
import { checkPasswordStrength, hashPassword } from "./password";
import { assertCan, ForbiddenError } from "./permissions";
import { AUTH_POLICY, type RequestInfo } from "./policy";
import { CLIENT_ROLES, isClientRole, ROLE_LABELS, ROLES, type Role } from "./roles";
import { revokeAllSessions, type SessionUser } from "./session-service";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

/** A business rule refused the request; the message is safe to show to the person. */
export const USER_STATUSES = ["invited", "active", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
/**
 * An account's moves (ADR 0022): invited until the person sets a password;
 * deactivated and back, to active if they had a password, else invited for a
 * new link. Setting a new password keeps an active account active.
 */
export const USER_FLOW = machine<UserStatus>("user account", USER_STATUSES, {
  invited: ["active", "deactivated"],
  active: ["invited", "deactivated"],
  deactivated: ["active", "invited"],
});
const next = (from: string, to: UserStatus): UserStatus =>
  from === to ? to : move(USER_FLOW, from as UserStatus, to);

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const nameSchema = z.string().trim().min(2, "Enter the person's full name.").max(120);
const roleSchema = z.enum(ROLES);

async function findUserInOrg(tx: Transaction, actor: SessionUser, userId: string): Promise<User> {
  const [target] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, actor.organisationId)))
    .for("update");
  // Same message for "missing" and "other organisation": never confirm another tenant's ids.
  if (!target) throw new AccountError("That user does not exist.");
  return target;
}

/**
 * Locks all active admins of the organisation, in id order, and counts them.
 * Called FIRST in any transaction that can remove an admin, before the target
 * row is locked: every such transaction then takes the locks in the same order,
 * so two admins removing each other queue up instead of deadlocking, and the
 * second sees the first one's change.
 */
async function lockActiveAdmins(tx: Transaction, organisationId: string): Promise<number> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.role, "admin"),
        eq(users.status, "active"),
      ),
    )
    .orderBy(users.id)
    .for("update");
  return admins.length;
}

/**
 * The actor's role and status come from their session and may be seconds old.
 * Re-read them inside the transaction so a user who was just deactivated or
 * demoted can't complete an admin action already in flight.
 */
async function assertActorStillAllowed(tx: Transaction, actor: SessionUser): Promise<void> {
  const [fresh] = await tx
    .select({ role: users.role, status: users.status, organisationId: users.organisationId })
    .from(users)
    .where(eq(users.id, actor.id));
  if (!fresh || fresh.organisationId !== actor.organisationId) {
    throw new ForbiddenError("users.manage");
  }
  assertCan({ role: fresh.role as Role, status: fresh.status }, "users.manage");
}

async function issueToken(
  tx: Transaction,
  user: User,
  purpose: "setup" | "reset",
  createdByUserId: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  // Only the newest link works: retire any earlier unused ones.
  await tx
    .update(accountTokens)
    .set({ usedAt: sql`now()` })
    .where(and(eq(accountTokens.userId, user.id), isNull(accountTokens.usedAt)));

  const token = generateToken();
  const hours = purpose === "setup" ? AUTH_POLICY.setupLinkHours : AUTH_POLICY.resetLinkHours;
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  await tx.insert(accountTokens).values({
    userId: user.id,
    purpose,
    tokenHash: hashToken(token),
    expiresAt,
    createdByUserId,
  });
  return { token, expiresAt };
}

export async function inviteUser(
  db: Database,
  actor: SessionUser,
  input: { name: string; email: string; role: string },
  request: RequestInfo,
): Promise<{ user: User; token: string; expiresAt: Date }> {
  assertCan(actor, "users.manage");
  const name = nameSchema.parse(input.name);
  const email = emailSchema.parse(input.email);
  const role = roleSchema.parse(input.role);
  if (isClientRole(role)) {
    throw new AccountError("Client users are added from the client's page.");
  }

  return db.transaction(async (tx) => {
    await assertActorStillAllowed(tx, actor);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (existing) throw new AccountError(`${email} already has an account.`);

    const [user] = await tx
      .insert(users)
      .values({
        organisationId: actor.organisationId,
        email,
        name,
        role,
        status: "invited",
        createdByUserId: actor.id,
      })
      .returning();
    if (!user) throw new Error("User insert returned no row");

    const link = await issueToken(tx, user, "setup", actor.id);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "user.invited",
      entityType: "user",
      entityId: user.id,
      summary: `${actor.name} invited ${name} (${email}) as ${ROLE_LABELS[role]}`,
      after: { name, email, role },
      request,
    });
    return { user, ...link };
  });
}

/**
 * Invite a client QA user. They belong to exactly one client company and,
 * from phase 9, see and sign only that company's released reports.
 */
export async function inviteClientUser(
  db: Database,
  actor: SessionUser,
  input: { companyId: string; name: string; email: string; role: string },
  request: RequestInfo,
): Promise<{ user: User; token: string; expiresAt: Date }> {
  assertCan(actor, "users.manage");
  const name = nameSchema.parse(input.name);
  const email = emailSchema.parse(input.email);
  const role = z
    .enum(CLIENT_ROLES, { message: "Choose Client QA or Client QA head." })
    .parse(input.role);
  const companyId = z.string().uuid("Choose the client.").parse(input.companyId);

  return db.transaction(async (tx) => {
    await assertActorStillAllowed(tx, actor);
    const [company] = await tx
      .select({
        id: clientCompanies.id,
        name: clientCompanies.name,
        active: clientCompanies.active,
      })
      .from(clientCompanies)
      .where(
        and(
          eq(clientCompanies.id, companyId),
          eq(clientCompanies.organisationId, actor.organisationId),
        ),
      );
    if (!company) throw new AccountError("That client does not exist.");
    if (!company.active) throw new AccountError("This client is inactive. Reactivate it first.");
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (existing) throw new AccountError(`${email} already has an account.`);

    const [user] = await tx
      .insert(users)
      .values({
        organisationId: actor.organisationId,
        clientCompanyId: company.id,
        email,
        name,
        role,
        status: "invited",
        createdByUserId: actor.id,
      })
      .returning();
    if (!user) throw new Error("User insert returned no row");

    const link = await issueToken(tx, user, "setup", actor.id);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "user.invited",
      entityType: "user",
      entityId: user.id,
      summary: `${actor.name} invited ${name} (${email}) as ${ROLE_LABELS[role]} for ${company.name}`,
      after: { name, email, role, clientCompanyId: company.id },
      request,
    });
    return { user, ...link };
  });
}

/** A fresh one-time link for a user who has not finished setup or forgot their password. */
export async function issuePasswordLink(
  db: Database,
  actor: SessionUser,
  userId: string,
  request: RequestInfo,
): Promise<{ token: string; expiresAt: Date; purpose: "setup" | "reset" }> {
  assertCan(actor, "users.manage");
  return db.transaction(async (tx) => {
    await assertActorStillAllowed(tx, actor);
    const target = await findUserInOrg(tx, actor, userId);
    if (target.status === "deactivated") {
      throw new AccountError("Reactivate this user before sending a password link.");
    }
    const purpose = target.passwordHash ? "reset" : "setup";
    const link = await issueToken(tx, target, purpose, actor.id);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "user.setup_link_issued",
      entityType: "user",
      entityId: target.id,
      summary: `${actor.name} created a ${purpose === "setup" ? "set-up" : "password reset"} link for ${target.name}`,
      request,
    });
    return { ...link, purpose };
  });
}

export type TokenLookup =
  | { ok: true; purpose: "setup" | "reset"; name: string; email: string }
  | { ok: false; message: string };

const LINK_INVALID =
  "This link is not valid. It may have expired or been used already. Ask an admin for a new one.";

/** Read-only check used to render the set-password page. */
export async function lookupAccountToken(db: Database, token: unknown): Promise<TokenLookup> {
  if (!isWellFormedToken(token)) return { ok: false, message: LINK_INVALID };
  const [row] = await db
    .select({
      purpose: accountTokens.purpose,
      expiresAt: accountTokens.expiresAt,
      usedAt: accountTokens.usedAt,
      name: users.name,
      email: users.email,
      status: users.status,
    })
    .from(accountTokens)
    .innerJoin(users, eq(users.id, accountTokens.userId))
    .where(eq(accountTokens.tokenHash, hashToken(token)));
  if (!row || row.usedAt || row.expiresAt <= new Date() || row.status === "deactivated") {
    return { ok: false, message: LINK_INVALID };
  }
  return { ok: true, purpose: row.purpose as "setup" | "reset", name: row.name, email: row.email };
}

/** Set a password from a one-time link. Activates invited users and signs out old sessions. */
export async function setPasswordWithToken(
  db: Database,
  input: { token: unknown; password: string },
  request: RequestInfo,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  if (!isWellFormedToken(input.token)) return { ok: false, message: LINK_INVALID };
  const tokenHash = hashToken(input.token);

  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.tokenHash, tokenHash))
      .for("update");
    if (!link || link.usedAt || link.expiresAt <= new Date()) {
      return { ok: false as const, message: LINK_INVALID };
    }
    const [user] = await tx.select().from(users).where(eq(users.id, link.userId)).for("update");
    if (!user || user.status === "deactivated")
      return { ok: false as const, message: LINK_INVALID };

    const problem = checkPasswordStrength(input.password, user);
    if (problem) return { ok: false as const, message: problem };

    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(input.password),
        status: next(user.status, "active"),
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));
    await tx
      .update(accountTokens)
      .set({ usedAt: sql`now()` })
      .where(eq(accountTokens.id, link.id));
    await revokeAllSessions(tx, user.id);
    await recordAudit(tx, {
      organisationId: user.organisationId,
      actor: { type: "user", userId: user.id },
      action: "user.password_set",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} set a password using a ${link.purpose === "setup" ? "set-up" : "reset"} link`,
      request,
    });
    return { ok: true as const, userId: user.id };
  });
}

export async function changeRole(
  db: Database,
  actor: SessionUser,
  input: { userId: string; role: string; reason: string },
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "users.manage");
  const role: Role = roleSchema.parse(input.role);
  const reason = z.string().trim().min(3, "Give a reason for the change.").parse(input.reason);
  if (input.userId === actor.id) throw new AccountError("You can't change your own role.");
  if (isClientRole(role)) throw new AccountError("Staff users can't be given a client role.");

  await db.transaction(async (tx) => {
    const adminCount = await lockActiveAdmins(tx, actor.organisationId);
    await assertActorStillAllowed(tx, actor);
    const target = await findUserInOrg(tx, actor, input.userId);
    if (isClientRole(target.role as Role)) {
      throw new AccountError("Client users can't be given a staff role.");
    }
    if (target.role === role) return;
    if (target.role === "admin" && target.status === "active" && adminCount <= 1) {
      throw new AccountError("Keep at least one active admin.");
    }
    await tx.update(users).set({ role }).where(eq(users.id, target.id));
    // A changed role takes effect immediately: end existing sessions.
    await revokeAllSessions(tx, target.id);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "user.role_changed",
      entityType: "user",
      entityId: target.id,
      summary: `${actor.name} changed ${target.name} from ${ROLE_LABELS[target.role as Role]} to ${ROLE_LABELS[role]}`,
      before: { role: target.role },
      after: { role },
      reason,
      request,
    });
  });
}

export async function setUserActive(
  db: Database,
  actor: SessionUser,
  input: { userId: string; active: boolean; reason: string },
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "users.manage");
  const reason = z.string().trim().min(3, "Give a reason for the change.").parse(input.reason);
  if (input.userId === actor.id) throw new AccountError("You can't deactivate your own account.");

  await db.transaction(async (tx) => {
    const adminCount = await lockActiveAdmins(tx, actor.organisationId);
    await assertActorStillAllowed(tx, actor);
    const target = await findUserInOrg(tx, actor, input.userId);
    if (input.active) {
      if (target.status !== "deactivated") return;
      // Someone who never set a password goes back to "invited" and needs a new link.
      const status = target.passwordHash ? "active" : "invited";
      await tx
        .update(users)
        .set({ status: next(target.status, status) })
        .where(eq(users.id, target.id));
    } else {
      if (target.status === "deactivated") return;
      if (target.role === "admin" && target.status === "active" && adminCount <= 1) {
        throw new AccountError("Keep at least one active admin.");
      }
      await tx
        .update(users)
        .set({ status: next(target.status, "deactivated") })
        .where(eq(users.id, target.id));
      await revokeAllSessions(tx, target.id);
      await tx
        .update(accountTokens)
        .set({ usedAt: sql`now()` })
        .where(and(eq(accountTokens.userId, target.id), isNull(accountTokens.usedAt)));
    }
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: input.active ? "user.reactivated" : "user.deactivated",
      entityType: "user",
      entityId: target.id,
      summary: `${actor.name} ${input.active ? "reactivated" : "deactivated"} ${target.name}`,
      before: { status: target.status },
      reason,
      request,
    });
  });
}

/** A signed-in user changes their own password (current password required). */
export async function changeOwnPassword(
  db: Database,
  actor: SessionUser & { sessionId: string },
  input: { currentPassword: string; newPassword: string },
  request: RequestInfo,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, actor.id)).for("update");
    if (!user || user.status !== "active") return { ok: false as const, message: "Sign in again." };

    const check = await checkCredentials(tx, user, input.currentPassword, {
      request,
      via: "login",
    });
    if (check.outcome !== "ok") {
      return {
        ok: false as const,
        message:
          check.outcome === "locked"
            ? "Too many wrong passwords. Your account is locked for 15 minutes."
            : "Your current password is incorrect.",
      };
    }
    const problem = checkPasswordStrength(input.newPassword, user);
    if (problem) return { ok: false as const, message: problem };

    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword), passwordChangedAt: sql`now()` })
      .where(eq(users.id, user.id));
    const ended = await revokeAllSessions(tx, user.id, actor.sessionId);
    await recordAudit(tx, {
      organisationId: user.organisationId,
      actor: { type: "user", userId: user.id },
      action: "user.password_changed",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} changed their password${ended ? ` (signed out ${ended} other session${ended === 1 ? "" : "s"})` : ""}`,
      request,
    });
    return { ok: true as const };
  });
}

/**
 * Command-line only (scripts/create-admin.ts): create the first admin, or give
 * an existing admin a fresh password link when nobody can sign in. It refuses
 * to create a second admin this way; further users are invited from the app.
 */
export async function bootstrapAdmin(
  db: Database,
  input: { organisationId: string; name: string; email: string },
): Promise<{ token: string; expiresAt: Date; created: boolean }> {
  const name = nameSchema.parse(input.name);
  const email = emailSchema.parse(input.email);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update");

    if (existing) {
      if (existing.organisationId !== input.organisationId || existing.role !== "admin") {
        throw new AccountError(`${email} exists but is not an admin of this organisation.`);
      }
      const status = existing.passwordHash ? existing.status : "invited";
      await tx
        .update(users)
        .set({
          status: next(
            existing.status,
            status === "deactivated" ? "invited" : (status as UserStatus),
          ),
          lockedUntil: null,
          failedLoginCount: 0,
        })
        .where(eq(users.id, existing.id));
      const link = await issueToken(tx, existing, existing.passwordHash ? "reset" : "setup", null);
      await recordAudit(tx, {
        organisationId: input.organisationId,
        actor: { type: "system" },
        action: "user.setup_link_issued",
        entityType: "user",
        entityId: existing.id,
        summary: `Password link for admin ${existing.name} created from the server command line`,
      });
      return { ...link, created: false };
    }

    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organisationId, input.organisationId), eq(users.role, "admin")));
    if (admins.length > 0) {
      throw new AccountError("An admin already exists. Invite further users from the app.");
    }

    const [user] = await tx
      .insert(users)
      .values({
        organisationId: input.organisationId,
        email,
        name,
        role: "admin",
        status: "invited",
      })
      .returning();
    if (!user) throw new Error("User insert returned no row");
    const link = await issueToken(tx, user, "setup", null);
    await recordAudit(tx, {
      organisationId: input.organisationId,
      actor: { type: "system" },
      action: "user.invited",
      entityType: "user",
      entityId: user.id,
      summary: `First admin ${name} (${email}) created from the server command line`,
      after: { name, email, role: "admin" },
    });
    return { ...link, created: true };
  });
}
