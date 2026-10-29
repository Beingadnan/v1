import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, clientDepartments, equipment, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { applyImport, previewImport } from "@/domain/clients/import/import-service";
import { buildImportTemplate, readImportWorkbook } from "@/domain/clients/import/workbook";
import { getCompany, listCompanies } from "@/domain/clients/queries";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.40" };
let manager: SessionUser;
let engineer: SessionUser;
let blobs: LocalBlobStore;
let blobDir: string;

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

/** Fills the real template, the way a person would in Excel. */
async function workbook(clients: unknown[][], items: unknown[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildImportTemplate()) as unknown as ExcelJS.Buffer);
  // Typed from row 2 down, as in Excel (the template's dropdowns already "use" rows 2–501).
  clients.forEach(
    (row, i) => (wb.getWorksheet("Clients")!.getRow(2 + i).values = row as ExcelJS.CellValue[]),
  );
  items.forEach(
    (row, i) => (wb.getWorksheet("Equipment")!.getRow(2 + i).values = row as ExcelJS.CellValue[]),
  );
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function upload(bytes: Uint8Array, name = "clients.xlsx"): Promise<string> {
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

// Columns: Company name, Short name, GSTIN, Address, Post-cal, Requal months, Site name, Site code, Site address, City, State, Site GSTIN
const WATSON_SEAWOODS = [
  "Watson Pharma Pvt Limited",
  "Watson",
  "",
  "",
  "No",
  12,
  "Seawoods",
  "",
  "Sector 40",
  "Navi Mumbai",
  "Maharashtra",
  "",
];
const WATSON_AMBERNATH = [
  "Watson Pharma Pvt Limited",
  "Watson",
  "",
  "",
  "",
  "",
  "Ambernath",
  "AMB",
  "",
  "Thane",
  "Maharashtra",
  "",
];
// Columns: Client, Site, Department, ID, Name, Type, Room, Make, Model, Serial, L, W, H, Set point, Lowest, Highest, RH lo, RH hi, Loggers, Interval, Duration, Requal, Last study, Notes
const BE_WF_02 = [
  "Watson",
  "Seawoods",
  "BA",
  "BE-WF-02",
  "Cold Storage (Walk In Freezer)",
  "Walk In Freezer",
  "Walk In Freezer",
  "Blue Star",
  "NA",
  "NA",
  "",
  "",
  "",
  -24,
  -30,
  -15,
  "",
  "",
  9,
  10,
  24,
  "",
  "23.05.2026",
  "",
];
const WH_013 = [
  "Watson",
  "AMB",
  "Warehouse",
  "WH013",
  "Dispensing-2",
  "Warehouse",
  "",
  "",
  "",
  "",
  20,
  10,
  6,
  "",
  "",
  25,
  "",
  60,
  15,
  5,
  72,
  "",
  new Date(Date.UTC(2025, 9, 1)),
  "",
];

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "import-org", name: "Import Org" }))
    .organisation;
  manager = await makeUser(org.id, "manager@import.test", "manager");
  engineer = await makeUser(org.id, "engineer@import.test", "field_engineer");
  blobDir = await mkdtemp(path.join(tmpdir(), "qtech-import-"));
  blobs = new LocalBlobStore(blobDir);
});

afterAll(async () => {
  await close();
  await rm(blobDir, { recursive: true, force: true });
});

describe("import template", () => {
  it("is a workbook the importer reads back (headers only → nothing to import)", async () => {
    const read = await readImportWorkbook(new Uint8Array(await buildImportTemplate()));
    expect(read).toEqual({ ok: false, message: "The sheets have headers but no rows to import." });
  });
});

describe("importing clients and equipment", () => {
  let fileId: string;

  it("previews without changing anything", async () => {
    fileId = await upload(await workbook([WATSON_SEAWOODS, WATSON_AMBERNATH], [BE_WF_02, WH_013]));
    const preview = await previewImport(db, blobs, manager, fileId);
    expect(preview.errors).toEqual([]);
    expect(preview.counts).toEqual({
      companies: { create: 1, update: 0 },
      sites: { create: 2, update: 0 },
      departments: { create: 2 },
      equipment: { create: 2, update: 0, unchanged: 0 },
    });
    expect(await listCompanies(db, manager)).toEqual([]);
  });

  it("applies everything in one go and audits the file hash", async () => {
    await applyImport(db, blobs, manager, fileId, req);
    const [company] = await listCompanies(db, manager, "Watson");
    const detail = await getCompany(db, manager, company!.id);
    expect(detail?.sites.map((s) => `${s.name}/${s.code}`).sort()).toEqual([
      "Ambernath/AMB",
      "Seawoods/Seawoods",
    ]);
    const freezer = detail?.equipment.find((e) => e.code === "BE-WF-02");
    expect(freezer).toMatchObject({
      type: "walk_in_freezer",
      tempMinC: "-30.00",
      tempMaxC: "-15.00",
      defaultChannels: 9,
      lastStudyOn: "2026-05-23",
      nextDue: "2027-05-22",
    });
    const warehouse = detail?.equipment.find((e) => e.code === "WH013");
    expect(warehouse).toMatchObject({
      tempMinC: null,
      tempMaxC: "25.00",
      rhMaxPct: "60.0",
      lastStudyOn: "2025-10-01",
    });
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "clients.imported"), eq(auditLog.entityId, fileId)));
    expect(audit?.after).toMatchObject({ fileName: "clients.xlsx" });
    expect((audit?.after as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("re-importing the same file changes nothing", async () => {
    const preview = await previewImport(db, blobs, manager, fileId);
    expect(preview.changes).toEqual([]);
  });

  it("updates only filled cells and keeps the rest", async () => {
    const changed = [...BE_WF_02];
    changed[18] = 12; // loggers
    changed[7] = ""; // make left empty → keeps Blue Star
    const id = await upload(await workbook([], [changed]), "update.xlsx");
    const preview = await previewImport(db, blobs, manager, id);
    expect(preview.changes).toEqual([
      {
        kind: "equipment",
        action: "update",
        label: "Watson → BE-WF-02 · Cold Storage (Walk In Freezer)",
        detail: "changes number of loggers",
      },
    ]);
    await applyImport(db, blobs, manager, id, req);
    const [row] = await db.select().from(equipment).where(eq(equipment.code, "BE-WF-02"));
    expect(row).toMatchObject({ defaultChannels: 12, make: "Blue Star" });
  });
});

describe("problems", () => {
  it("lists every bad row and refuses to apply any of the file", async () => {
    const id = await upload(
      await workbook(
        [["Acme Labs", "Acme", "", "", "Maybe", "", "Pune", "", "", "", "", ""]],
        [
          [
            "Nobody",
            "X",
            "",
            "E-1",
            "Fridge",
            "Fridge",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
          [
            "Watson",
            "Seawood",
            "",
            "E-2",
            "Fridge",
            "Fridge",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
          [
            "Watson",
            "Seawoods",
            "",
            "E-3",
            "Pod",
            "Spaceship",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
          [
            "Watson",
            "Seawoods",
            "",
            "E-4",
            "Freezer",
            "Freezer",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "-24",
            "-15",
            "-30",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
          [
            "Watson",
            "Seawoods",
            "",
            "E-5",
            "Freezer",
            "Freezer",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
          [
            "Watson",
            "Seawoods",
            "",
            "e-5",
            "Freezer",
            "Freezer",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
        ],
      ),
      "bad.xlsx",
    );
    const preview = await previewImport(db, blobs, manager, id);
    expect(preview.errors.map((e) => `${e.sheet} ${e.row}: ${e.message}`)).toEqual([
      "Clients 2: Post-cal required by SOP: write Yes or No, not “Maybe”.",
      "Equipment 2: Client “Nobody” isn't in QTech or the Clients sheet.",
      "Equipment 3: Site “Seawood” isn't listed for Watson. Add it to the Clients sheet or fix the name.",
      expect.stringMatching(
        /^Equipment 4: Type “Spaceship” isn't known\. Use one of: Refrigerator, /,
      ),
      "Equipment 5: Highest temp: The highest temperature must be above the lowest.",
      "Equipment 7: Equipment ID e-5 appears twice for Watson.",
    ]);
    await expect(applyImport(db, blobs, manager, id, req)).rejects.toThrow(
      "The file has 6 problems.",
    );
    const [row] = await db.select().from(equipment).where(eq(equipment.code, "E-5"));
    expect(row).toBeUndefined();
  });

  it("explains when the file is not an Excel workbook", async () => {
    const pdf = await upload(new TextEncoder().encode("%PDF-1.4 test"), "not-excel.pdf");
    await expect(previewImport(db, blobs, manager, pdf)).rejects.toThrow(
      "Upload an Excel (.xlsx) file made from the template.",
    );
  });

  it("needs clients.manage", async () => {
    const id = await upload(await workbook([WATSON_SEAWOODS], []), "x.xlsx");
    await expect(previewImport(db, blobs, engineer, id)).rejects.toThrow(ForbiddenError);
  });

  it("creates a department only once even when many rows name it", async () => {
    const one = [...BE_WF_02];
    one[2] = "QC";
    one[3] = "QC-1";
    const two = [...one];
    two[3] = "QC-2";
    const id = await upload(await workbook([], [one, two]), "qc.xlsx");
    await applyImport(db, blobs, manager, id, req);
    const qc = await db.select().from(clientDepartments).where(eq(clientDepartments.name, "QC"));
    expect(qc).toHaveLength(1);
  });
});
