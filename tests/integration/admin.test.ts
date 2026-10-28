import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ensureQatechDefaults } from "@/db/seed/qatech-defaults";
import { getSettings, listAuditEvents, listUsers } from "@/domain/admin/queries";
import { createSite, updateSettings, updateSite } from "@/domain/admin/settings-service";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.20" };
let admin: SessionUser;
let manager: SessionUser;
let outsider: SessionUser;

async function makeUser(organisationId: string, email: string, role: string): Promise<SessionUser> {
  const [row] = await db
    .insert(users)
    .values({
      organisationId,
      email,
      name: email.split("@")[0]!,
      role,
      status: "active",
      passwordHash: "x",
    })
    .returning();
  return toSessionUser(row!)!;
}

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "admin-org", name: "Admin Org" })).organisation;
  await ensureQatechDefaults(db, org.id);
  const other = (await ensureOrganisation(db, { slug: "admin-other", name: "Other" })).organisation;
  admin = await makeUser(org.id, "boss@admin.test", "admin");
  manager = await makeUser(org.id, "mgr@admin.test", "manager");
  outsider = await makeUser(other.id, "outsider@admin-other.test", "admin");
});

afterAll(close);

describe("settings", () => {
  it("seeds QA Tech details and the six sites", async () => {
    const { settings, sites } = await getSettings(db, admin);
    expect(settings?.gstin).toBe("27AAACQ1042P1ZB");
    expect(sites.map((s) => s.code)).toEqual(["BDD", "BHW", "HDP", "IND", "NGP", "SLK"]);
  });

  it("audits only the fields that changed, with before and after", async () => {
    const { changed } = await updateSettings(
      db,
      admin,
      {
        section: "numbers",
        values: {
          jobNumberFormat: "QT/JOB/{YYYY}/{SEQ:4}",
          certificateNumberFormat: "CERT-{SITE}-{YYYY}-{SEQ:4}",
        },
      },
      req,
    );
    expect(changed).toEqual(["jobNumberFormat"]);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "settings.updated"), eq(auditLog.entityId, admin.organisationId)),
      );
    expect(audit?.before).toEqual({ jobNumberFormat: "QT/J/{YYYY}/{SEQ:4}" });
    expect(audit?.after).toEqual({ jobNumberFormat: "QT/JOB/{YYYY}/{SEQ:4}" });
    expect(audit?.summary).toContain("job number format");

    // Saving the same values again changes and audits nothing.
    const again = await updateSettings(
      db,
      admin,
      {
        section: "numbers",
        values: {
          jobNumberFormat: "QT/JOB/{YYYY}/{SEQ:4}",
          certificateNumberFormat: "CERT-{SITE}-{YYYY}-{SEQ:4}",
        },
      },
      req,
    );
    expect(again.changed).toEqual([]);
  });

  it("refuses invalid values with field-level messages", async () => {
    await expect(
      updateSettings(
        db,
        admin,
        {
          section: "numbers",
          values: { jobNumberFormat: "QT/{YYYY}", certificateNumberFormat: "CERT-{YYYY}-{SEQ:4}" },
        },
        req,
      ),
    ).rejects.toThrow(/SEQ|SITE/);
    await expect(
      updateSettings(
        db,
        admin,
        {
          section: "details",
          values: {
            legalName: "QA Tech",
            shortName: "QA",
            address: "",
            phone: "",
            email: "",
            website: "",
            gstin: "NOT-A-GSTIN",
          },
        },
        req,
      ),
    ).rejects.toThrow(/GSTIN/);
    await expect(
      updateSettings(
        db,
        admin,
        {
          section: "calculations",
          values: {
            mktActivationEnergyKjMol: "abc",
            f0ReferenceTempC: "121.1",
            f0ZValueC: "10",
            sessionIdleMinutes: "30",
          },
        },
        req,
      ),
    ).rejects.toThrow(/number/);
  });

  it("lets a manager view but not change settings", async () => {
    await expect(getSettings(db, manager)).resolves.toBeTruthy();
    await expect(
      updateSettings(
        db,
        manager,
        {
          section: "calculations",
          values: {
            mktActivationEnergyKjMol: "83.144",
            f0ReferenceTempC: "121.1",
            f0ZValueC: "10",
            sessionIdleMinutes: "60",
          },
        },
        req,
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("sites", () => {
  it("adds a site once and keeps its code fixed", async () => {
    const site = await createSite(db, admin, { code: "pune", name: "Pune", address: "" }, req);
    expect(site.code).toBe("PUNE");
    await expect(
      createSite(db, admin, { code: "PUNE", name: "Pune 2", address: "" }, req),
    ).rejects.toThrow(/already exists/);
    await updateSite(
      db,
      admin,
      { siteId: site.id, name: "Pune (Hinjewadi)", address: "Phase 1", active: false },
      req,
    );
    const { sites } = await getSettings(db, admin);
    const updated = sites.find((s) => s.id === site.id);
    expect(updated).toMatchObject({ code: "PUNE", name: "Pune (Hinjewadi)", active: false });
  });

  it("can't touch another organisation's site", async () => {
    const theirs = await createSite(
      db,
      outsider,
      { code: "XYZ", name: "Theirs", address: "" },
      req,
    );
    await expect(
      updateSite(
        db,
        admin,
        { siteId: theirs.id, name: "Hijacked", address: "", active: true },
        req,
      ),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("tenant isolation in lists", () => {
  it("shows only your own organisation's users and audit entries", async () => {
    const mine = await listUsers(db, admin);
    expect(mine.every((u) => u.email.endsWith("@admin.test"))).toBe(true);
    const { events } = await listAuditEvents(db, admin, {});
    const theirSite = events.find((e) => e.summary.includes("XYZ"));
    expect(theirSite).toBeUndefined();
  });

  it("refuses the audit trail to roles without audit.view", async () => {
    const engineer = await makeUser(admin.organisationId, "eng@admin.test", "field_engineer");
    await expect(listAuditEvents(db, engineer, {})).rejects.toThrow(ForbiddenError);
  });
});

describe("audit trail paging", () => {
  it("pages by id so entries never repeat or go missing", async () => {
    for (let i = 0; i < 60; i++) {
      await createSite(
        db,
        admin,
        {
          code: `Z${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
          name: `Site ${i}`,
          address: "",
        },
        req,
      );
    }
    const first = await listAuditEvents(db, admin, { action: "site.created" });
    expect(first.events).toHaveLength(50);
    expect(first.nextBefore).toBeDefined();
    const second = await listAuditEvents(db, admin, {
      action: "site.created",
      before: first.nextBefore,
    });
    const ids = [...first.events, ...second.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.events.length).toBeGreaterThanOrEqual(11);
  });
});
