import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, clientSites, equipment, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { inviteClientUser } from "@/domain/auth/account-service";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import {
  createClientSite,
  createCompany,
  createContact,
  createDepartment,
  updateCompany,
} from "@/domain/clients/company-service";
import {
  createEquipment,
  setEquipmentActive,
  updateEquipment,
} from "@/domain/clients/equipment-service";
import { ClientsError } from "@/domain/clients/errors";
import { getCompany, getEquipment, listCompanies } from "@/domain/clients/queries";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.30" };
let manager: SessionUser;
let engineer: SessionUser;
let accounts: SessionUser;
let admin: SessionUser;
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

const company = {
  name: "Watson Pharma Pvt Limited",
  code: "Watson",
  gstin: "",
  address: "",
  notes: "",
  postCalRequired: false,
  requalificationMonths: 12,
  reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}",
};
const seawoods = {
  name: "Seawoods",
  code: "Seawoods",
  address:
    "Unit V BEC Seawoods Sector 40, Seawoods Grand Central Tower 2, Nerul Navi Mumbai 400706",
  city: "Navi Mumbai",
  state: "Maharashtra",
  gstin: "",
};
const freezer = (siteId: string, departmentId: string | null) => ({
  siteId,
  departmentId,
  code: "BE-WF-02",
  name: "Cold Storage (Walk In Freezer)",
  type: "walk_in_freezer",
  location: "Walk In Freezer",
  make: "Blue Star",
  model: "NA",
  serialNo: "NA",
  lengthM: "",
  widthM: "",
  heightM: "",
  setPointC: "-24",
  tempMinC: "-30",
  tempMaxC: "-15",
  rhMinPct: "",
  rhMaxPct: "",
  defaultChannels: "9",
  readingIntervalMinutes: "10",
  studyDurationHours: "24",
  requalificationMonths: "",
  lastStudyOn: "2026-05-23",
  notes: "",
});

let watsonId: string;
let seawoodsId: string;
let baId: string;
let freezerId: string;

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "clients-org", name: "Clients Org" }))
    .organisation;
  const other = (await ensureOrganisation(db, { slug: "clients-other", name: "Other" }))
    .organisation;
  admin = await makeUser(org.id, "admin@clients.test", "admin");
  manager = await makeUser(org.id, "manager@clients.test", "manager");
  engineer = await makeUser(org.id, "engineer@clients.test", "field_engineer");
  accounts = await makeUser(org.id, "accounts@clients.test", "accounts");
  outsider = await makeUser(other.id, "manager@clients-other.test", "manager");
});

afterAll(close);

describe("phase 2 exit test: Watson Pharma → Seawoods → BA → BE-WF-02", () => {
  it("creates the client with its first site", async () => {
    const created = await createCompany(db, manager, { ...company, firstSite: seawoods }, req);
    watsonId = created.id;
    const detail = await getCompany(db, manager, watsonId);
    expect(detail?.sites.map((s) => s.name)).toEqual(["Seawoods"]);
    seawoodsId = detail!.sites[0]!.id;
  });

  it("adds department BA and the walk-in freezer with −30 to −15 °C limits and 9 loggers", async () => {
    baId = (await createDepartment(db, manager, seawoodsId, { name: "BA" }, req)).id;
    freezerId = (await createEquipment(db, manager, watsonId, freezer(seawoodsId, baId), req)).id;

    const found = await getEquipment(db, engineer, freezerId);
    expect(found?.company.name).toBe("Watson Pharma Pvt Limited");
    expect(found?.equipment).toMatchObject({
      code: "BE-WF-02",
      siteId: seawoodsId,
      departmentId: baId,
      setPointC: "-24.00",
      tempMinC: "-30.00",
      tempMaxC: "-15.00",
      defaultChannels: 9,
      readingIntervalMinutes: 10,
      studyDurationHours: 24,
    });
    // Same next due date as printed on the BE-WF-02 report.
    expect(found?.nextDue).toBe("2027-05-22");
  });

  it("lists the client with its equipment count and next due date, and finds it by equipment ID", async () => {
    const [row] = await listCompanies(db, accounts, "be-wf-02");
    expect(row).toMatchObject({
      name: "Watson Pharma Pvt Limited",
      siteCount: 1,
      equipmentCount: 1,
      nextDue: "2027-05-22",
    });
    expect(await listCompanies(db, accounts, "nothing-like-this")).toEqual([]);
  });
});

describe("rules", () => {
  it("refuses duplicate names, codes and equipment IDs with a readable message", async () => {
    await expect(createCompany(db, manager, { ...company, code: "WPL" }, req)).rejects.toThrow(
      new ClientsError("A client with this name already exists."),
    );
    await expect(
      createCompany(db, manager, { ...company, name: "Watson Two", code: "watson" }, req),
    ).rejects.toThrow("Another client already uses this short name.");
    await expect(
      createEquipment(
        db,
        manager,
        watsonId,
        { ...freezer(seawoodsId, null), code: "be-wf-02" },
        req,
      ),
    ).rejects.toThrow("This client already has equipment with that ID.");
    await expect(createDepartment(db, manager, seawoodsId, { name: "ba" }, req)).rejects.toThrow(
      "This site already has a department with that name.",
    );
  });

  it("checks limits make sense", async () => {
    await expect(
      createEquipment(
        db,
        manager,
        watsonId,
        { ...freezer(seawoodsId, null), code: "X-1", tempMinC: "-15", tempMaxC: "-30" },
        req,
      ),
    ).rejects.toThrow("The highest temperature must be above the lowest.");
    // One-sided limits are fine (e.g. "not more than 25 °C").
    const oneSided = await createEquipment(
      db,
      manager,
      watsonId,
      {
        ...freezer(seawoodsId, null),
        code: "WH-01",
        type: "warehouse",
        setPointC: "",
        tempMinC: "",
        tempMaxC: "25",
      },
      req,
    );
    expect(oneSided.tempMinC).toBeNull();
  });

  it("refuses a department from another site", async () => {
    const other = await createClientSite(
      db,
      manager,
      watsonId,
      { ...seawoods, name: "Ambernath", code: "Ambernath" },
      req,
    );
    await expect(
      createEquipment(db, manager, watsonId, { ...freezer(other.id, baId), code: "AM-1" }, req),
    ).rejects.toThrow("Choose a department of the selected site.");
  });

  it("audits only changed fields, and saving the same values changes nothing", async () => {
    const same = await updateEquipment(db, manager, freezerId, freezer(seawoodsId, baId), req);
    expect(same.changed).toEqual([]);
    const result = await updateEquipment(
      db,
      manager,
      freezerId,
      { ...freezer(seawoodsId, baId), defaultChannels: "15" },
      req,
    );
    expect(result.changed).toEqual(["defaultChannels"]);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "equipment.updated"), eq(auditLog.entityId, freezerId)));
    expect(audit?.before).toEqual({ defaultChannels: 9 });
    expect(audit?.after).toEqual({ defaultChannels: 15 });
    expect(audit?.summary).toContain("number of loggers");
  });

  it("retires equipment only with a reason, and never deletes it", async () => {
    await expect(
      setEquipmentActive(db, manager, { equipmentId: freezerId, active: false, reason: "" }, req),
    ).rejects.toThrow();
    await setEquipmentActive(
      db,
      manager,
      { equipmentId: freezerId, active: false, reason: "Replaced by BE-WF-03" },
      req,
    );
    const [row] = await db.select().from(equipment).where(eq(equipment.id, freezerId));
    expect(row?.active).toBe(false);
    await setEquipmentActive(
      db,
      manager,
      { equipmentId: freezerId, active: true, reason: "Retired by mistake" },
      req,
    );
  });

  it("stores client settings: post-cal by SOP, requalification interval", async () => {
    const { changed } = await updateCompany(
      db,
      manager,
      watsonId,
      { ...company, postCalRequired: "on", requalificationMonths: "24", active: "true" },
      req,
    );
    expect(changed.sort()).toEqual(["postCalRequired", "requalificationMonths"]);
    const found = await getEquipment(db, manager, freezerId);
    expect(found?.nextDue).toBe("2028-05-22");
  });

  it("adds report signatories", async () => {
    const contact = await createContact(
      db,
      manager,
      watsonId,
      {
        siteId: seawoodsId,
        name: "QA Head",
        designation: "Head QA",
        email: "",
        phone: "",
        signatory: "approved_by",
      },
      req,
    );
    expect(contact.signatory).toBe("approved_by");
  });
});

describe("access", () => {
  it("lets every staff role view clients but only managers and team leaders change them", async () => {
    expect(await getCompany(db, engineer, watsonId)).not.toBeNull();
    await expect(
      createCompany(db, engineer, { ...company, name: "New", code: "New" }, req),
    ).rejects.toThrow(ForbiddenError);
    await expect(createDepartment(db, accounts, seawoodsId, { name: "QC" }, req)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("hides one organisation's clients from another", async () => {
    expect(await getCompany(db, outsider, watsonId)).toBeNull();
    expect(await getEquipment(db, outsider, freezerId)).toBeNull();
    expect(await listCompanies(db, outsider)).toEqual([]);
    await expect(
      updateEquipment(db, outsider, freezerId, freezer(seawoodsId, baId), req),
    ).rejects.toThrow("That equipment does not exist.");
    await expect(
      createClientSite(db, outsider, watsonId, { ...seawoods, name: "X", code: "X" }, req),
    ).rejects.toThrow("That client does not exist.");
  });

  it("the database refuses a site under another organisation's client", async () => {
    await expect(
      db.insert(clientSites).values({
        organisationId: outsider.organisationId,
        companyId: watsonId,
        name: "Sneaky",
        code: "Sneaky",
      }),
    ).rejects.toThrow();
  });
});

describe("client users", () => {
  it("invites a client QA user tied to the company", async () => {
    const { user } = await inviteClientUser(
      db,
      admin,
      { companyId: watsonId, name: "Watson QA", email: "qa@watson.test", role: "client_qa" },
      req,
    );
    expect(user.clientCompanyId).toBe(watsonId);
    const detail = await getCompany(db, admin, watsonId);
    expect(detail?.clientUsers.map((u) => u.email)).toEqual(["qa@watson.test"]);
    // People without users.view don't get the list.
    expect((await getCompany(db, engineer, watsonId))?.clientUsers).toEqual([]);
  });

  it("refuses staff roles, other organisations' clients and non-admins", async () => {
    await expect(
      inviteClientUser(
        db,
        admin,
        { companyId: watsonId, name: "Bad Role", email: "bad@watson.test", role: "manager" },
        req,
      ),
    ).rejects.toThrow("Choose Client QA or Client QA head.");
    await expect(
      inviteClientUser(
        db,
        manager,
        { companyId: watsonId, name: "No Rights", email: "no@watson.test", role: "client_qa" },
        req,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("the database refuses a client role without a company", async () => {
    await expect(
      db.insert(users).values({
        organisationId: admin.organisationId,
        email: "orphan@watson.test",
        name: "Orphan",
        role: "client_qa",
      }),
    ).rejects.toThrow();
  });
});
