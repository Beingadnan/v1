import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createClientSite, createCompany } from "@/domain/clients/company-service";
import { createEquipment, updateEquipment } from "@/domain/clients/equipment-service";
import { exportDueList, exportRegister, listDueEquipment } from "@/domain/clients/export-service";
import { applyImport, previewImport } from "@/domain/clients/import/import-service";
import { buildImportTemplate } from "@/domain/clients/import/workbook";
import { getCompany, getEquipmentHistory } from "@/domain/clients/queries";
import { todayInIndia } from "@/domain/clients/requalification";
import { getEffectiveTypeDefaults, saveTypeDefaults } from "@/domain/clients/type-defaults-service";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.50" };
let admin: SessionUser;
let manager: SessionUser;
let engineer: SessionUser;
let blobs: LocalBlobStore;
let blobDir: string;
let companyId: string;
let siteId: string;

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

async function upload(bytes: Uint8Array, name: string): Promise<string> {
  const result = await storeFile(db, blobs, {
    organisationId: manager.organisationId,
    actor: { type: "user", userId: manager.id },
    fileName: name,
    bytes,
    maxBytes: 5 * 1024 * 1024,
  });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
}

/** A calendar date `days` from today in India, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const d = new Date(`${todayInIndia()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const company = {
  name: "Alkem Laboratories Ltd",
  code: "Alkem",
  gstin: "",
  address: "",
  notes: "",
  postCalRequired: false,
  requalificationMonths: 12,
  reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}",
};

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "auto-org", name: "Auto Org" })).organisation;
  admin = await makeUser(org.id, "admin@auto.test", "admin");
  manager = await makeUser(org.id, "manager@auto.test", "manager");
  engineer = await makeUser(org.id, "engineer@auto.test", "field_engineer");
  blobDir = await mkdtemp(path.join(tmpdir(), "qtech-auto-"));
  blobs = new LocalBlobStore(blobDir);
  companyId = (await createCompany(db, manager, company, req)).id;
  siteId = (
    await createClientSite(
      db,
      manager,
      companyId,
      // Real QA Tech GSTIN, used only to check the state is read from it.
      { name: "Taloja", code: "TLJ", address: "", city: "", state: "", gstin: "27aaacq1042p1zb" },
      req,
    )
  ).id;
});

afterAll(async () => {
  await close();
  await rm(blobDir, { recursive: true, force: true });
});

describe("GSTIN", () => {
  it("fills the site's state from its GSTIN", async () => {
    const detail = await getCompany(db, manager, companyId);
    expect(detail?.sites[0]).toMatchObject({ gstin: "27AAACQ1042P1ZB", state: "Maharashtra" });
  });

  it("refuses a GSTIN with a wrong check character", async () => {
    await expect(
      createClientSite(
        db,
        manager,
        companyId,
        { name: "Bad", code: "BAD", address: "", city: "", state: "", gstin: "27AAACQ1042P1ZC" },
        req,
      ),
    ).rejects.toThrow("typing mistake");
  });
});

describe("equipment type defaults", () => {
  it("start from the built-in values and can be changed by an admin, audited", async () => {
    const before = await getEffectiveTypeDefaults(db, admin.organisationId);
    expect(before.freezer).toMatchObject({ tempMinC: -25, tempMaxC: -15, customised: false });

    const { changed } = await saveTypeDefaults(
      db,
      admin,
      "freezer",
      {
        setPointC: "-24",
        tempMinC: "-30",
        tempMaxC: "-15",
        rhMinPct: "",
        rhMaxPct: "",
        defaultChannels: "9",
        readingIntervalMinutes: "10",
        studyDurationHours: "24",
        requalificationMonths: "12",
        cycles: ["empty", "door_open", "power_failure"],
        seasonalMapping: "",
      },
      req,
    );
    expect(changed.sort()).toEqual(
      ["cycles", "readingIntervalMinutes", "setPointC", "tempMinC"].sort(),
    );
    const after = await getEffectiveTypeDefaults(db, admin.organisationId);
    expect(after.freezer).toMatchObject({
      setPointC: -24,
      tempMinC: -30,
      cycles: ["empty", "door_open", "power_failure"],
      customised: true,
    });
  });

  it("refuses limits the wrong way round and non-admins", async () => {
    await expect(
      saveTypeDefaults(
        db,
        admin,
        "refrigerator",
        { tempMinC: "8", tempMaxC: "2", cycles: [] },
        req,
      ),
    ).rejects.toThrow();
    await expect(
      saveTypeDefaults(db, manager, "refrigerator", { cycles: [] }, req),
    ).rejects.toThrow(ForbiddenError);
  });

  it("fill the blank cells of new equipment in an import", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildImportTemplate()) as unknown as ExcelJS.Buffer);
    // Only the required cells: client, site, ID, name, type.
    wb.getWorksheet("Equipment")!.getRow(2).values = [
      "Alkem",
      "Taloja",
      "",
      "FR-01",
      "Freezer 1",
      "Freezer",
    ];
    const id = await upload(new Uint8Array(await wb.xlsx.writeBuffer()), "defaults.xlsx");
    await applyImport(db, blobs, manager, id, req);
    const detail = await getCompany(db, manager, companyId);
    const fr = detail?.equipment.find((e) => e.code === "FR-01");
    expect(fr).toMatchObject({
      setPointC: "-24.00",
      tempMinC: "-30.00",
      tempMaxC: "-15.00",
      defaultChannels: 9,
    });
  });
});

describe("register export", () => {
  it("exports in the import layout, and importing the export changes nothing", async () => {
    await createEquipment(
      db,
      manager,
      companyId,
      {
        siteId,
        code: "CR-07",
        name: "Cold room 7",
        type: "cold_room",
        tempMinC: "2",
        tempMaxC: "8",
        defaultChannels: "15",
        lastStudyOn: "2026-01-31",
        cycles: ["empty", "loaded"],
        seasonalMapping: "",
      },
      req,
    );
    const file = await exportRegister(db, manager, companyId);
    expect(file?.fileName).toBe("Alkem equipment register.xlsx");
    const id = await upload(new Uint8Array(file!.bytes), "export.xlsx");
    const preview = await previewImport(db, blobs, manager, id);
    expect(preview.errors).toEqual([]);
    expect(preview.changes).toEqual([]);
  });

  it("is not available for another organisation's client", async () => {
    const other = (await ensureOrganisation(db, { slug: "auto-other", name: "Other" }))
      .organisation;
    const outsider = await makeUser(other.id, "x@auto-other.test", "manager");
    expect(await exportRegister(db, outsider, companyId)).toBeNull();
  });
});

describe("requalification due list", () => {
  it("lists overdue first, then due soon, within the window", async () => {
    // Next due = last study + 12 months − 1 day.
    const lastFor = (dueInDays: number) => {
      const d = new Date(`${daysFromToday(dueInDays)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return d.toISOString().slice(0, 10);
    };
    for (const [code, due] of [
      ["OVD-1", -5],
      ["SOON-1", 10],
      ["LATER-1", 200],
    ] as const) {
      await createEquipment(
        db,
        manager,
        companyId,
        { siteId, code, name: code, type: "refrigerator", lastStudyOn: lastFor(due), cycles: [] },
        req,
      );
    }
    const items = await listDueEquipment(db, engineer, { days: 60 });
    const codes = items.map((i) => i.code);
    expect(codes).toContain("OVD-1");
    expect(codes).toContain("SOON-1");
    expect(codes).not.toContain("LATER-1");
    expect(codes.indexOf("OVD-1")).toBeLessThan(codes.indexOf("SOON-1"));
    expect(items.find((i) => i.code === "OVD-1")?.status).toBe("overdue");
    expect(items.find((i) => i.code === "SOON-1")?.status).toBe("due_soon");

    const withUnknown = await listDueEquipment(db, engineer, { days: 60, includeUnknown: true });
    expect(withUnknown.some((i) => i.code === "FR-01" && i.status === "none")).toBe(true);

    const sheet = new ExcelJS.Workbook();
    await sheet.xlsx.load((await exportDueList(items, "Due")) as unknown as ExcelJS.Buffer);
    expect(sheet.worksheets[0]!.getRow(4).getCell(9).value).toBe("Overdue");
  });
});

describe("duplicate clients and history", () => {
  it("warns about a client that looks the same, unless told it is different", async () => {
    await expect(
      createCompany(
        db,
        manager,
        { ...company, name: "ALKEM LABORATORIES LIMITED", code: "AL2" },
        req,
      ),
    ).rejects.toThrow("looks like the same company");
    const created = await createCompany(
      db,
      manager,
      { ...company, name: "Alkem Laboratories (India) Pvt Ltd", code: "AL3", allowSimilar: "on" },
      req,
    );
    expect(created.code).toBe("AL3");
  });

  it("shows who changed equipment and why", async () => {
    const detail = await getCompany(db, manager, companyId);
    const cr = detail!.equipment.find((e) => e.code === "CR-07")!;
    await updateEquipment(
      db,
      manager,
      cr.id,
      {
        siteId,
        code: "CR-07",
        name: "Cold room 7",
        type: "cold_room",
        tempMinC: "2",
        tempMaxC: "8",
        defaultChannels: "18",
        lastStudyOn: "2026-01-31",
        cycles: ["empty", "loaded"],
        seasonalMapping: "",
      },
      req,
    );
    const history = await getEquipmentHistory(db, engineer, cr.id);
    expect(history.map((h) => h.summary)).toEqual([
      "manager changed number of loggers for CR-07",
      "manager added CR-07 (Cold room 7) for Alkem Laboratories Ltd",
    ]);
  });
});
