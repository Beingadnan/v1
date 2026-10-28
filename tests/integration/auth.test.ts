import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, loginAttempts, sessions, signatures, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import {
  AccountError,
  bootstrapAdmin,
  changeOwnPassword,
  changeRole,
  inviteUser,
  issuePasswordLink,
  lookupAccountToken,
  setPasswordWithToken,
  setUserActive,
} from "@/domain/auth/account-service";
import { login } from "@/domain/auth/login-service";
import { ForbiddenError } from "@/domain/auth/permissions";
import {
  revokeSessionByToken,
  toSessionUser,
  validateSession,
  type SessionUser,
} from "@/domain/auth/session-service";
import { signRecord } from "@/domain/auth/signature-service";
import { allocateNumber } from "@/domain/numbering/allocate";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.10", userAgent: "vitest" };
const PASSWORD = "cold room mapping at -24";
let orgId: string;
let otherOrgId: string;
let admin: SessionUser;

/** Invite + set password: the real path a person takes. */
async function createActiveUser(
  actor: SessionUser,
  name: string,
  email: string,
  role: string,
): Promise<SessionUser> {
  const { user, token } = await inviteUser(db, actor, { name, email, role }, req);
  const result = await setPasswordWithToken(db, { token, password: PASSWORD }, req);
  expect(result.ok).toBe(true);
  return toSessionUser({ ...user, status: "active" })!;
}

beforeAll(async () => {
  orgId = (await ensureOrganisation(db, { slug: "auth-org", name: "Auth Org" })).organisation.id;
  otherOrgId = (await ensureOrganisation(db, { slug: "other-org", name: "Other Org" })).organisation
    .id;
  const boot = await bootstrapAdmin(db, {
    organisationId: orgId,
    name: "First Admin",
    email: "admin@auth.test",
  });
  expect(boot.created).toBe(true);
  expect((await setPasswordWithToken(db, { token: boot.token, password: PASSWORD }, req)).ok).toBe(
    true,
  );
  const [row] = await db.select().from(users).where(eq(users.email, "admin@auth.test"));
  admin = toSessionUser(row!)!;
});

afterAll(close);

describe("first admin", () => {
  it("cannot be used to create a second admin", async () => {
    await expect(
      bootstrapAdmin(db, { organisationId: orgId, name: "Another One", email: "two@auth.test" }),
    ).rejects.toThrow(AccountError);
  });
});

describe("invite → set password → sign in", () => {
  it("lets an invited user set a password once and then sign in", async () => {
    const { token } = await inviteUser(
      db,
      admin,
      { name: "Mangesh Phalskar", email: "Mangesh@Auth.test", role: "field_engineer" },
      req,
    );
    expect(await lookupAccountToken(db, token)).toMatchObject({ ok: true, purpose: "setup" });

    // Weak password is refused with a message, and the link stays usable.
    expect(await setPasswordWithToken(db, { token, password: "short" }, req)).toMatchObject({
      ok: false,
    });
    expect((await setPasswordWithToken(db, { token, password: PASSWORD }, req)).ok).toBe(true);
    // Single use.
    expect((await setPasswordWithToken(db, { token, password: PASSWORD }, req)).ok).toBe(false);

    const result = await login(db, {
      email: "  mangesh@AUTH.test ",
      password: PASSWORD,
      request: req,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = await validateSession(db, result.token);
    expect(session?.user.name).toBe("Mangesh Phalskar");
    expect(session?.user.role).toBe("field_engineer");
  });

  it("refuses duplicate emails regardless of case", async () => {
    await expect(
      inviteUser(db, admin, { name: "Dup", email: "MANGESH@auth.test", role: "lab" }, req),
    ).rejects.toThrow(/already has an account/);
  });

  it("only the newest link works", async () => {
    const { user, token: first } = await inviteUser(
      db,
      admin,
      { name: "Kashinath P", email: "kashinath@auth.test", role: "field_engineer" },
      req,
    );
    const second = await issuePasswordLink(db, admin, user.id, req);
    expect(second.purpose).toBe("setup");
    expect((await lookupAccountToken(db, first)).ok).toBe(false);
    expect((await lookupAccountToken(db, second.token)).ok).toBe(true);
  });

  it("refuses client roles until client companies exist", async () => {
    await expect(
      inviteUser(
        db,
        admin,
        { name: "Client Person", email: "c@client.test", role: "client_qa" },
        req,
      ),
    ).rejects.toThrow(/client/i);
  });
});

describe("sign-in protection", () => {
  it("gives the same message for an unknown email and a wrong password", async () => {
    const unknown = await login(db, {
      email: "nobody@auth.test",
      password: PASSWORD,
      request: req,
    });
    const wrong = await login(db, {
      email: "admin@auth.test",
      password: "wrong password here",
      request: req,
    });
    expect(unknown).toMatchObject({ ok: false, reason: "invalid" });
    expect(wrong).toMatchObject({ ok: false, reason: "invalid" });
    if (!unknown.ok && !wrong.ok) expect(unknown.message).toBe(wrong.message);
    // Reset the admin's counter for later tests.
    expect(
      (await login(db, { email: "admin@auth.test", password: PASSWORD, request: req })).ok,
    ).toBe(true);
  });

  it("locks the account after 5 wrong passwords, even for the right password", async () => {
    await createActiveUser(admin, "Rajesh Lock", "rajesh@auth.test", "lab");
    for (let i = 0; i < 4; i++) {
      expect(
        await login(db, { email: "rajesh@auth.test", password: "nope nope nope", request: req }),
      ).toMatchObject({ reason: "invalid" });
    }
    expect(
      await login(db, { email: "rajesh@auth.test", password: "nope nope nope", request: req }),
    ).toMatchObject({ reason: "locked" });
    expect(
      await login(db, { email: "rajesh@auth.test", password: PASSWORD, request: req }),
    ).toMatchObject({ reason: "locked" });

    const [locked] = await db.select().from(users).where(eq(users.email, "rajesh@auth.test"));
    expect(locked?.lockedUntil).not.toBeNull();
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, locked!.id), eq(auditLog.action, "user.locked_out")));
    expect(audits).toHaveLength(1);

    // An admin's new link unlocks it.
    const link = await issuePasswordLink(db, admin, locked!.id, req);
    expect(
      (await setPasswordWithToken(db, { token: link.token, password: PASSWORD + "!" }, req)).ok,
    ).toBe(true);
    expect(
      (await login(db, { email: "rajesh@auth.test", password: PASSWORD + "!", request: req })).ok,
    ).toBe(true);
  });

  it("throttles an IP address after too many failures", async () => {
    const ip = "198.51.100.77";
    await db.insert(loginAttempts).values(
      Array.from({ length: 30 }, () => ({
        emailLower: "x@x.test",
        ipAddress: ip,
        outcome: "bad_credentials",
      })),
    );
    const result = await login(db, {
      email: "admin@auth.test",
      password: PASSWORD,
      request: { ipAddress: ip },
    });
    expect(result).toMatchObject({ ok: false, reason: "throttled" });
  });
});

describe("sessions", () => {
  it("end after the idle timeout and the absolute limit, and on sign-out", async () => {
    const result = await login(db, { email: "admin@auth.test", password: PASSWORD, request: req });
    if (!result.ok) throw new Error("login failed");
    const start = new Date();

    expect(
      await validateSession(db, result.token, new Date(start.getTime() + 29 * 60_000)),
    ).not.toBeNull();
    // Activity at +29 min was recorded, so +58 min is still within 30 min idle.
    expect(
      await validateSession(db, result.token, new Date(start.getTime() + 58 * 60_000)),
    ).not.toBeNull();
    expect(
      await validateSession(db, result.token, new Date(start.getTime() + 90 * 60_000)),
    ).toBeNull();

    const second = await login(db, { email: "admin@auth.test", password: PASSWORD, request: req });
    if (!second.ok) throw new Error("login failed");
    expect(
      await validateSession(db, second.token, new Date(start.getTime() + 13 * 3_600_000)),
    ).toBeNull();

    await revokeSessionByToken(db, second.token);
    expect(await validateSession(db, second.token)).toBeNull();
  });

  it("rejects garbage tokens without querying", async () => {
    expect(await validateSession(db, "' or 1=1 --")).toBeNull();
    expect(await validateSession(db, undefined)).toBeNull();
  });

  it("stores only a hash of the session token", async () => {
    const result = await login(db, { email: "admin@auth.test", password: PASSWORD, request: req });
    if (!result.ok) throw new Error("login failed");
    const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, result.token));
    expect(rows).toHaveLength(0);
  });
});

describe("user administration", () => {
  it("is refused for roles without users.manage", async () => {
    const engineer = await createActiveUser(
      admin,
      "Ganesh Field",
      "ganesh@auth.test",
      "field_engineer",
    );
    await expect(
      inviteUser(db, engineer, { name: "Sneaky", email: "s@auth.test", role: "admin" }, req),
    ).rejects.toThrow(ForbiddenError);
  });

  it("deactivating signs the person out everywhere and blocks sign-in", async () => {
    const lab = await createActiveUser(admin, "Indrajit Lab", "indrajit@auth.test", "lab");
    const result = await login(db, {
      email: "indrajit@auth.test",
      password: PASSWORD,
      request: req,
    });
    if (!result.ok) throw new Error("login failed");

    await expect(
      setUserActive(db, admin, { userId: lab.id, active: false, reason: "" }, req),
    ).rejects.toThrow();
    await setUserActive(
      db,
      admin,
      { userId: lab.id, active: false, reason: "Left the company" },
      req,
    );
    expect(await validateSession(db, result.token)).toBeNull();
    expect(
      await login(db, { email: "indrajit@auth.test", password: PASSWORD, request: req }),
    ).toMatchObject({ ok: false, reason: "deactivated" });

    await setUserActive(db, admin, { userId: lab.id, active: true, reason: "Rejoined" }, req);
    expect(
      (await login(db, { email: "indrajit@auth.test", password: PASSWORD, request: req })).ok,
    ).toBe(true);
  });

  it("changing a role ends the person's sessions and is audited with the reason", async () => {
    const prep = await createActiveUser(
      admin,
      "Manasi Prep",
      "manasi@auth.test",
      "report_preparer",
    );
    const result = await login(db, { email: "manasi@auth.test", password: PASSWORD, request: req });
    if (!result.ok) throw new Error("login failed");
    await changeRole(db, admin, { userId: prep.id, role: "team_leader", reason: "Promoted" }, req);
    expect(await validateSession(db, result.token)).toBeNull();
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, prep.id), eq(auditLog.action, "user.role_changed")));
    expect(audit?.reason).toBe("Promoted");
    expect(audit?.after).toEqual({ role: "team_leader" });
  });

  it("keeps at least one active admin and stops self-changes", async () => {
    await expect(
      changeRole(db, admin, { userId: admin.id, role: "lab", reason: "test" }, req),
    ).rejects.toThrow(/own role/);
    await expect(
      setUserActive(db, admin, { userId: admin.id, active: false, reason: "test" }, req),
    ).rejects.toThrow(/own account/);

    const second = await createActiveUser(admin, "Second Admin", "admin2@auth.test", "admin");
    await changeRole(db, second, { userId: admin.id, role: "manager", reason: "Hand over" }, req);
    const [demoted] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(demoted?.role).toBe("manager");
    // A manager can't manage users.
    await expect(
      changeRole(
        db,
        { ...admin, role: "manager" },
        { userId: second.id, role: "lab", reason: "x" },
        req,
      ),
    ).rejects.toThrow(ForbiddenError);
    await changeRole(db, second, { userId: admin.id, role: "admin", reason: "Hand back" }, req);
  });

  it("two admins removing each other at the same moment leaves one admin", async () => {
    const a = await createActiveUser(admin, "Race Admin A", "race-a@auth.test", "admin");
    const b = await createActiveUser(admin, "Race Admin B", "race-b@auth.test", "admin");
    // Leave only A and B as admins in this organisation's count by demoting the others first.
    const others = await db
      .select()
      .from(users)
      .where(
        and(eq(users.organisationId, orgId), eq(users.role, "admin"), eq(users.status, "active")),
      );
    for (const other of others.filter((u) => u.id !== a.id && u.id !== b.id)) {
      await changeRole(db, a, { userId: other.id, role: "manager", reason: "race setup" }, req);
    }

    const results = await Promise.allSettled([
      setUserActive(db, a, { userId: b.id, active: false, reason: "race" }, req),
      setUserActive(db, b, { userId: a.id, active: false, reason: "race" }, req),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // The loser is refused by a business rule, not by a database deadlock.
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ForbiddenError);
    const activeAdmins = await db
      .select()
      .from(users)
      .where(
        and(eq(users.organisationId, orgId), eq(users.role, "admin"), eq(users.status, "active")),
      );
    expect(activeAdmins).toHaveLength(1);

    // Restore the original admin for the remaining tests.
    const survivor = toSessionUser(activeAdmins[0]!)!;
    await changeRole(db, survivor, { userId: admin.id, role: "admin", reason: "restore" }, req);
  });

  it("cannot reach users in another organisation", async () => {
    const [outsider] = await db
      .insert(users)
      .values({
        organisationId: otherOrgId,
        email: "out@other.test",
        name: "Outsider",
        role: "lab",
      })
      .returning();
    await expect(
      setUserActive(db, admin, { userId: outsider!.id, active: false, reason: "nope" }, req),
    ).rejects.toThrow(/does not exist/);
  });

  it("changing your own password needs the current one and signs out other sessions", async () => {
    const tl = await createActiveUser(admin, "Vikas Leader", "vikas@auth.test", "team_leader");
    const a = await login(db, { email: "vikas@auth.test", password: PASSWORD, request: req });
    const b = await login(db, { email: "vikas@auth.test", password: PASSWORD, request: req });
    if (!a.ok || !b.ok) throw new Error("login failed");
    const current = await validateSession(db, a.token);

    expect(
      await changeOwnPassword(
        db,
        { ...tl, sessionId: current!.sessionId },
        { currentPassword: "wrong one here", newPassword: "a brand new passphrase" },
        req,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await changeOwnPassword(
        db,
        { ...tl, sessionId: current!.sessionId },
        { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
        req,
      ),
    ).toEqual({ ok: true });
    expect(await validateSession(db, a.token)).not.toBeNull();
    expect(await validateSession(db, b.token)).toBeNull();
  });
});

describe("electronic signatures", () => {
  const recordHash = "a".repeat(64);

  it("records who signed, the meaning and the content hash, and audits it", async () => {
    const result = await signRecord(
      db,
      admin,
      {
        password: PASSWORD,
        meaning: "checked_by",
        entityType: "report_revision",
        entityId: "rev-1",
        recordHash,
      },
      req,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signature.signerName).toBe("First Admin");
    expect(result.signature.recordHash).toBe(recordHash);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, "rev-1"), eq(auditLog.action, "record.signed")));
    expect(audits).toHaveLength(1);
  });

  it("signs nothing on a wrong password and audits the attempt", async () => {
    const before = await db.$count(signatures);
    const result = await signRecord(
      db,
      admin,
      {
        password: "not my password",
        meaning: "approved_by",
        entityType: "report_revision",
        entityId: "rev-2",
        recordHash,
      },
      req,
    );
    expect(result).toMatchObject({ ok: false, reason: "bad_password" });
    expect(await db.$count(signatures)).toBe(before);
    const failed = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, "rev-2"), eq(auditLog.action, "signature.failed")));
    expect(failed).toHaveLength(1);
    // Clear the failure counter.
    expect(
      (await login(db, { email: "admin@auth.test", password: PASSWORD, request: req })).ok,
    ).toBe(true);
  });

  it("can never be edited or deleted", async () => {
    await expect(
      db.execute(sql`update signatures set signer_name = 'Someone Else'`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from signatures`)).rejects.toThrow();
  });
});

describe("number allocation", () => {
  it("gives 25 concurrent requests 25 distinct consecutive numbers", async () => {
    const date = new Date("2026-10-28T10:00:00+05:30");
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () =>
        db.transaction((tx) =>
          allocateNumber(tx, {
            organisationId: orgId,
            kind: "job",
            format: "QT/J/{YYYY}/{SEQ:4}",
            date,
          }),
        ),
      ),
    );
    const values = numbers.map((n) => n.number).sort();
    expect(new Set(values).size).toBe(25);
    expect(values[0]).toBe("QT/J/2026/0001");
    expect(values[24]).toBe("QT/J/2026/0025");
  });

  it("keeps a separate sequence per site and gives a rolled-back number back", async () => {
    const date = new Date("2026-10-28T10:00:00+05:30");
    const format = "CERT-{SITE}-{YYYY}-{SEQ:4}";
    const ind = await db.transaction((tx) =>
      allocateNumber(tx, {
        organisationId: orgId,
        kind: "certificate",
        format,
        date,
        siteCode: "IND",
      }),
    );
    await expect(
      db.transaction(async (tx) => {
        await allocateNumber(tx, {
          organisationId: orgId,
          kind: "certificate",
          format,
          date,
          siteCode: "BHW",
        });
        throw new Error("record creation failed");
      }),
    ).rejects.toThrow();
    const bhw = await db.transaction((tx) =>
      allocateNumber(tx, {
        organisationId: orgId,
        kind: "certificate",
        format,
        date,
        siteCode: "BHW",
      }),
    );
    expect(ind.number).toBe("CERT-IND-2026-0001");
    expect(bhw.number).toBe("CERT-BHW-2026-0001");
  });
});
