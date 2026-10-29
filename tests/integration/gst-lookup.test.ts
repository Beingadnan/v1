import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { auditLog, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import type { GstLookupConfig } from "@/domain/clients/gst-lookup";
import { GST_LOOKUPS_PER_HOUR, lookupGstin } from "@/domain/clients/gst-lookup-service";
import { recordAudit } from "@/lib/audit";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.60" };
const config: GstLookupConfig = { clientId: "cid", clientSecret: "secret", environment: "sandbox" };
let manager: SessionUser;
let engineer: SessionUser;

async function makeUser(organisationId: string, email: string, role: string) {
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

const fakeCashfree = () =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const { GSTIN } = JSON.parse(String(init.body)) as { GSTIN: string };
    const body =
      GSTIN === "29AAIZP2912R1ZR"
        ? { valid: false, message: "GSTIN Doesn't Exist" }
        : {
            GSTIN,
            legal_name_of_business: "WATSON PHARMA PRIVATE LIMITED",
            trade_name_of_business: "WATSON PHARMA",
            gst_in_status: "Active",
            constitution_of_business: "Private Limited Company",
            date_of_registration: "2017-07-01",
            principal_place_address:
              "Seawoods Grand Central, Nerul, Navi Mumbai, Maharashtra 400706",
            principal_place_split_address: {
              city: "Navi Mumbai",
              state: "Maharashtra",
              pincode: "400706",
            },
            valid: true,
          };
    return new Response(JSON.stringify(body), { status: 200 });
  });

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "gst-org", name: "GST Org" })).organisation;
  manager = await makeUser(org.id, "manager@gst.test", "manager");
  engineer = await makeUser(org.id, "engineer@gst.test", "field_engineer");
});

afterAll(close);

describe("GSTIN lookup", () => {
  it("fills from the service, then from the 30-day cache without paying again", async () => {
    const fetchImpl = fakeCashfree();
    const first = await lookupGstin(
      db,
      manager,
      "29AAICP2912R1ZR",
      config,
      req,
      fetchImpl as unknown as typeof fetch,
    );
    expect(first).toMatchObject({
      ok: true,
      fill: {
        legalName: "Watson Pharma Private Limited",
        shortName: "Watson",
        city: "Navi Mumbai",
        state: "Maharashtra",
        status: "Active",
        fromCache: false,
      },
    });
    const again = await lookupGstin(
      db,
      manager,
      "29aaicp2912r1zr",
      config,
      req,
      fetchImpl as unknown as typeof fetch,
    );
    expect(again).toMatchObject({ ok: true, fill: { fromCache: true } });
    expect(fetchImpl).toHaveBeenCalledOnce();

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "gstin.looked_up"),
          eq(auditLog.organisationId, manager.organisationId),
        ),
      );
    expect(audits.map((a) => a.summary)).toEqual([
      "manager looked up GSTIN 29AAICP2912R1ZR: Watson Pharma Private Limited (Active)",
    ]);
  });

  it("says when no business is registered, and when the lookup is switched off", async () => {
    const fetchImpl = fakeCashfree();
    expect(
      await lookupGstin(
        db,
        manager,
        "29AAIZP2912R1ZR",
        config,
        req,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await lookupGstin(db, manager, "29AAICP2912R1ZR", null, req)).toMatchObject({
      ok: false,
      message: "GST lookup is not switched on.",
    });
  });

  it("is for people who manage clients", async () => {
    await expect(lookupGstin(db, engineer, "29AAICP2912R1ZR", config, req)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it(`stops after ${GST_LOOKUPS_PER_HOUR} paid lookups an hour per person`, async () => {
    for (let i = 0; i < GST_LOOKUPS_PER_HOUR; i += 1) {
      await recordAudit(db, {
        organisationId: manager.organisationId,
        actor: { type: "user", userId: manager.id },
        action: "gstin.looked_up",
        entityType: "gstin",
        entityId: `X${i}`,
        summary: "test lookup",
      });
    }
    const fetchImpl = fakeCashfree();
    expect(
      await lookupGstin(
        db,
        manager,
        "05BBICP2912R1ZR",
        config,
        req,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toMatchObject({ ok: false, reason: "busy" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
