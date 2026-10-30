import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { recordAudit } from "@/lib/audit";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
let organisationId: string;

beforeAll(async () => {
  const { organisation } = await ensureOrganisation(db, { slug: "audit-test", name: "Audit Test" });
  organisationId = organisation.id;
});

afterAll(close);

/** Postgres error from drizzle; the database message sits on the cause. */
async function expectDbError(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the database to reject the statement").not.toBeNull();
  const text = `${String(error)} ${String((error as { cause?: unknown }).cause ?? "")}`;
  expect(text).toMatch(message);
}

describe("audit log", () => {
  it("shortens an over-long summary instead of failing the save", async () => {
    const id = await recordAudit(db, {
      organisationId,
      actor: { type: "system" },
      action: "certificate.created",
      entityType: "certificate",
      entityId: "long",
      summary: `Recorded for ${Array.from({ length: 90 }, (_, i) => `W-${String(i).padStart(4, "0")}`).join(", ")}`,
    });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
    expect(row?.summary).toHaveLength(500);
    expect(row?.summary.endsWith("…")).toBe(true);
  });

  it("records an event with actor, entity and snapshots", async () => {
    const id = await recordAudit(db, {
      organisationId,
      actor: { type: "system" },
      action: "file.stored",
      entityType: "stored_file",
      entityId: "abc123",
      summary: "Stored logger export BE-WF-02.xlsx",
      after: { sha256: "abc123", bytes: 1024 },
      request: { ipAddress: "10.0.0.5", userAgent: "vitest" },
    });

    const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
    expect(row?.action).toBe("file.stored");
    expect(row?.actorType).toBe("system");
    expect(row?.after).toEqual({ sha256: "abc123", bytes: 1024 });
    expect(row?.ipAddress).toBe("10.0.0.5");
  });

  it("refuses UPDATE, DELETE and TRUNCATE at the database level", async () => {
    await expectDbError(
      db.execute(sql`update audit_log set summary = 'tampered'`),
      /append-only: UPDATE/,
    );
    await expectDbError(db.execute(sql`delete from audit_log`), /append-only: DELETE/);
    await expectDbError(db.execute(sql`truncate audit_log`), /append-only: TRUNCATE/);
  });

  it("rolls back the audit row when the surrounding transaction fails", async () => {
    const before = await db.$count(auditLog);
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          organisationId,
          actor: { type: "system" },
          action: "file.stored",
          entityType: "stored_file",
          entityId: "will-roll-back",
          summary: "This change fails after auditing",
        });
        throw new Error("simulated failure after the audit insert");
      }),
    ).rejects.toThrow("simulated failure");
    expect(await db.$count(auditLog)).toBe(before);
  });

  it("rejects invalid events before touching the database", async () => {
    await expect(
      recordAudit(db, {
        organisationId,
        actor: { type: "system" },
        // @ts-expect-error unknown actions are a type error and a runtime error
        action: "file.deleted",
        entityType: "stored_file",
        entityId: "x",
        summary: "nope",
      }),
    ).rejects.toThrow();
    await expect(
      recordAudit(db, {
        organisationId,
        actor: { type: "user", userId: "not-a-uuid" },
        action: "file.stored",
        entityType: "stored_file",
        entityId: "x",
        summary: "bad user id",
      }),
    ).rejects.toThrow();
  });

  it("enforces that user actions name a user, even if the app check is bypassed", async () => {
    await expectDbError(
      db.execute(
        sql`insert into audit_log (organisation_id, actor_type, action, entity_type, entity_id, summary)
            values (${organisationId}, 'user', 'file.stored', 'stored_file', 'x', 'no user id')`,
      ),
      /audit_log_user_actor_check/,
    );
  });
});

describe("organisation seed", () => {
  it("is idempotent and audits only the first creation", async () => {
    const first = await ensureOrganisation(db, { slug: "seed-twice", name: "Seed Twice" });
    const second = await ensureOrganisation(db, { slug: "seed-twice", name: "Seed Twice" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.organisation.id).toBe(first.organisation.id);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, first.organisation.id));
    expect(audits).toHaveLength(1);
  });

  it("creates only one organisation under concurrent seeding", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ensureOrganisation(db, { slug: "race", name: "Race Condition Co" }),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.organisation.id)).size).toBe(1);
  });
});
