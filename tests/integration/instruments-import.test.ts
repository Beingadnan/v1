import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { auditLog, sites, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import {
  applyInstrumentImport,
  previewInstrumentImport,
} from "@/domain/instruments/instrument-import-service";
import { getInstrument, listInstruments, listModels } from "@/domain/instruments/queries";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db } = openTestDatabase();
const req = { ipAddress: "203.0.113.70" };
let manager: SessionUser;
let blobs: LocalBlobStore;

/** A list laid out like QA Tech's site logger lists (synthetic serials). */
async function loggerList(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Testo Temp.RH(MUM)");
  a.addRow([
    "SR. No.",
    "Instrument Name",
    "Make ",
    "Model",
    "ID No.",
    "Serial No.",
    "Certificate No.",
    "Range ",
    "Calibration Date  ",
    "Due Date",
    "Traceability",
  ]);
  a.addRow([
    1,
    "Portable Datalogger",
    "Testo",
    "174H",
    "T-TRH9001",
    90000001,
    "QATECH/BHIWANDI/08/25/PDL-23",
    "-20 to 70°C, 0 to 100%RH",
    new Date("2025-08-14"),
    new Date("2026-08-13"),
    "OK",
  ]);
  a.addRow([
    2,
    "Portable Datalogger",
    "Testo",
    "174H",
    "T-TRH9002",
    90000002,
    null,
    "-20 to 70°C, 0 to 100%RH",
    new Date("2025-08-14"),
    new Date("2026-08-13"),
    "OK",
  ]);
  a.addRow([
    3,
    "Portable Datalogger",
    "Testo",
    "174H",
    null,
    90000003,
    null,
    "-20 to 70°C, 0 to 100%RH",
    new Date("2025-08-14"),
    new Date("2026-08-13"),
    "OK",
  ]);
  const b = wb.addWorksheet("Nagpur");
  b.addRow(["SR. No.", "Serial No.", "ID No.", "Calibration Date  ", "Due Date"]);
  b.addRow([1, 90000004, "T-TRH9004", "18.08.2025", "17.08.2026"]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "instr-import", name: "QA Tech" }))
    .organisation;
  const [row] = await db
    .insert(users)
    .values({
      organisationId: org.id,
      email: "m@imp.test",
      name: "Manager",
      role: "manager",
      status: "active",
      passwordHash: "x",
    })
    .returning();
  manager = toSessionUser(row!)!;
  await db.insert(sites).values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" });
  blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-instr-import-")));
});

describe("importing an instrument list", () => {
  let fileId: string;

  it("previews: carries the certificate number down, skips rows without an ID, creates the model", async () => {
    const stored = await storeFile(db, blobs, {
      organisationId: manager.organisationId,
      actor: { type: "user", userId: manager.id },
      fileName: "All site logger list.xlsx",
      bytes: await loggerList(),
      maxBytes: 5 * 1024 * 1024,
    });
    if (!stored.ok) throw new Error(stored.message);
    fileId = stored.file.id;
    const preview = await previewInstrumentImport(db, blobs, manager, fileId, "portable_logger");
    expect(preview.summary).toMatchObject({
      models: 1,
      instruments: 3,
      certificates: 2,
      unnumbered: 1,
      skipped: 1,
    });
    const pdl23 = preview.plan.certificates.find(
      (c) => c.number === "QATECH/BHIWANDI/08/25/PDL-23",
    )!;
    expect(pdl23.codes).toEqual(["T-TRH9001", "T-TRH9002"]);
    expect(pdl23.siteId).not.toBeNull();
    expect(preview.plan.certificates.find((c) => c.unnumbered)).toMatchObject({
      number: "Number not recorded (18.08.2025)",
      calibratedOn: "2025-08-18",
      validUntil: "2026-08-17",
      codes: ["T-TRH9004"],
    });
    expect(preview.plan.skipped[0]!.reason).toMatch(/90000003 has no ID No/);
  });

  it("applies in one go and the loggers show their certificates", async () => {
    const summary = await applyInstrumentImport(db, blobs, manager, fileId, "portable_logger", req);
    expect(summary.instruments).toBe(3);
    const rows = await listInstruments(db, manager, { q: "T-TRH900" });
    expect(rows.map((r) => r.code).sort()).toEqual(["T-TRH9001", "T-TRH9002", "T-TRH9004"]);
    const t2 = rows.find((r) => r.code === "T-TRH9002")!;
    expect(t2.latest).toMatchObject({
      number: "QATECH/BHIWANDI/08/25/PDL-23",
      validUntil: "2026-08-13",
    });
    expect(t2.serialNo).toBe("90000002");
    expect((await listModels(db, manager)).map((m) => `${m.make} ${m.model}`)).toEqual([
      "Testo 174H",
    ]);
    const detail = await getInstrument(db, manager, t2.id);
    expect(detail!.history[0]!.certificate.kind).toBe("imported");
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "instruments.imported"));
    expect(audits.some((a) => a.entityId === fileId)).toBe(true);
  });

  it("importing the same list again adds nothing", async () => {
    await expect(
      applyInstrumentImport(db, blobs, manager, fileId, "portable_logger", req),
    ).rejects.toThrow(/Nothing new to import/);
  });
});
