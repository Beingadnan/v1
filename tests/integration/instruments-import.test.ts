import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { auditLog, instrumentModels, sites, users } from "@/db/schema";
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
  // A model already set up: imported loggers of it take its accuracy and resolution.
  await db.insert(instrumentModels).values({
    organisationId: org.id,
    type: "portable_logger",
    make: "Testo",
    model: "174H",
    equipmentName: "Portable Datalogger",
    quantities: ["temperature", "humidity"],
    resolutionText: "0.1 °C, 0.1 %RH",
    accuracyText: "± 0.5 °C (-20 to 70 °C), ± 3 %RH",
  });
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
    const preview = await previewInstrumentImport(db, blobs, manager, fileId, {
      defaultType: "portable_logger",
    });
    expect(preview.summary).toMatchObject({
      models: 0,
      instruments: 3,
      certificates: 2,
      unnumbered: 1,
      skipped: 0,
      unassigned: 1,
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
    expect(preview.plan.unassigned).toEqual([expect.objectContaining({ serialNo: "90000003" })]);
  });

  it("applies in one go and the loggers show their certificates", async () => {
    const summary = await applyInstrumentImport(
      db,
      blobs,
      manager,
      fileId,
      { defaultType: "portable_logger" },
      req,
    );
    expect(summary.instruments).toBe(3);
    const rows = await listInstruments(db, manager, { q: "T-TRH900" });
    expect(rows.map((r) => r.code).sort()).toEqual(["T-TRH9001", "T-TRH9002", "T-TRH9004"]);
    const t2 = rows.find((r) => r.code === "T-TRH9002")!;
    expect(t2.latest).toMatchObject({
      number: "QATECH/BHIWANDI/08/25/PDL-23",
      validUntil: "2026-08-13",
    });
    expect(t2.serialNo).toBe("90000002");
    expect(t2).toMatchObject({
      accuracyText: "± 0.5 °C (-20 to 70 °C), ± 3 %RH",
      resolutionText: "0.1 °C, 0.1 %RH",
    });
    expect(t2.modelId).not.toBeNull();
    expect((await listModels(db, manager)).map((m) => `${m.make} ${m.model}`)).toEqual([
      "Testo 174H",
    ]);
    const detail = await getInstrument(db, manager, t2.id);
    expect(detail!.history[0]!.certificate).toMatchObject({
      kind: "imported",
      customerName: "QA Tech",
    });
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "instruments.imported"));
    expect(audits.some((a) => a.entityId === fileId)).toBe(true);
  });

  it("importing the same list again adds nothing, and asks only about the serial without an ID", async () => {
    const again = await previewInstrumentImport(db, blobs, manager, fileId, {
      defaultType: "portable_logger",
    });
    expect(again.summary).toMatchObject({
      instruments: 0,
      certificateLinks: 0,
      alreadyRegistered: 3,
      unassigned: 1,
    });
    await expect(
      applyInstrumentImport(db, blobs, manager, fileId, { defaultType: "portable_logger" }, req),
    ).rejects.toThrow(/1 serial number has no QA Tech ID/);
  });
});

/**
 * An FT-05 certificate workbook laid out like QA Tech's (header grid with merged
 * labels repeated across columns, reference standards, observation blocks with
 * "ID No. / Serial No." in one cell). Synthetic values; the layout is the real one.
 */
async function certificateWorkbook(number: string, codes: { id: string; serial: string }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("TRH-9701 to TRH-9703 (°C)");
  const put = (r: number, cells: Record<string, unknown>) =>
    Object.entries(cells).forEach(
      ([col, v]) => (ws.getCell(`${col}${r}`).value = v as ExcelJS.CellValue),
    );
  put(1, { F: " Calibration Certificate", G: " Calibration Certificate" });
  put(3, {
    B: "Date of Calibration",
    C: "Date of Calibration",
    E: new Date("2026-07-06"),
    F: "Due Date",
    G: new Date("2027-07-05"),
    I: "Certificate No.",
    J: "Certificate No.",
    L: number,
  });
  put(5, { B: "Customer Name & Address", E: "QA Tech" });
  put(6, { B: "Customer Name & Address", E: "Bhiwandi, Thane" });
  put(8, { B: "Location", E: "Bhiwandi", I: "Department", L: "Process Validation" });
  put(9, {
    B: "Equipment Name",
    E: "Portable Datalogger",
    I: "Range",
    L: "-20 to 70 °C, 0 to 100 % RH",
  });
  put(10, { B: "Make", E: "Testo", I: "Resolution", L: "0.1 °C, 0.1 % RH" });
  put(11, { B: "Model", E: "174H", I: "Calibration SOP No.", L: "QATECH/CAL-026" });
  put(12, {
    B: "Instrument Serial & ID No.",
    E: "As Mentioned below",
    I: "Condition on receipt",
    L: "Good",
  });
  put(13, {
    B: "Accuracy",
    E: "± 0.5 °C, ± 3% RH",
    I: "Environmental Conditions",
    L: "Temperature: 22 °C   Relative Humidity: 49 %RH",
  });
  put(16, {
    B: "Name of Equipment",
    F: "Make",
    G: "Model",
    J: "Serial No.",
    M: "Due Date",
    N: "Certificate No.",
  });
  put(17, {
    B: "Semi standard Platinum Resistance",
    F: "Isotech",
    G: "935-14-72",
    J: "S9701/59 (Sensor)",
    M: new Date("2027-09-08"),
    N: `ARAI/CAL/9701/${run}`,
  });
  put(20, { B: "OBSERVATION TABLE" });
  put(21, { B: "Sr. No.", C: "Master Reading", E: "UUC Reading" });
  const uuc = ["F", "G", "H"];
  put(22, {
    B: "Sr. No.",
    C: "°C",
    D: "% RH",
    E: "ID No.\nSerial No.",
    ...Object.fromEntries(codes.map((c, i) => [uuc[i]!, `${c.id}\n${c.serial}`])),
  });
  // Excel's own deviation formulas leave float noise; the import recomputes exactly.
  put(23, {
    B: 1,
    C: -20.105,
    D: "-",
    E: "Actual Output in °C",
    F: -20.2,
    G: -20.300000000000004,
    H: -20.1,
  });
  put(24, { B: 1, C: -20.105, D: "-", E: "Deviation °C", F: -0.09499999999999886 });
  put(25, { B: 2, C: "@25", D: 20.06, E: "Actual Output in %RH", F: 20.3, G: 20.4, H: "" });
  put(26, { B: 2, C: "@25", D: 20.06, E: "Deviation %RH", F: 0.240000000000002 });
  put(28, { B: "Remarks:" });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const run = String(Date.now() % 100000);

describe("importing FT-05 certificate workbooks and serial lists", () => {
  it("records the certificate with every reading, exact deviations and the linked master", async () => {
    const { createExternalCertificate } = await import("@/domain/instruments/certificate-service");
    const { createInstrument } = await import("@/domain/instruments/instrument-service");
    const { getCertificate, listInstruments: list } = await import("@/domain/instruments/queries");
    const master = await createInstrument(
      db,
      manager,
      { type: "reference_thermometer", tier: "master", code: `SSPRT-${run}`, serialNo: "S9701/59" },
      req,
    );
    await createExternalCertificate(
      db,
      manager,
      {
        number: `ARAI/CAL/9701/${run}`,
        labName: "ARAI",
        calibratedOn: "2026-06-01",
        validUntil: "2027-09-08",
        instrumentIds: [master.id],
      },
      req,
    );
    const number = `QATECH/BHIWANDI/07/26/PDL-0${(Number(run) % 5) + 3}`;
    const stored = await storeFile(db, blobs, {
      organisationId: manager.organisationId,
      actor: { type: "user", userId: manager.id },
      fileName: "TRH-9701 to TRH-9703.xlsx",
      bytes: await certificateWorkbook(number, [
        { id: "TRH-9701", serial: "97010001" },
        { id: "TRH-9702", serial: "97010002" },
        { id: "TRH-9703", serial: "97010003" },
      ]),
      maxBytes: 5 * 1024 * 1024,
    });
    if (!stored.ok) throw new Error(stored.message);
    const preview = await previewInstrumentImport(db, blobs, manager, stored.file.id, {
      defaultType: "portable_logger",
    });
    expect(preview.summary).toMatchObject({
      instruments: 3,
      certificatesWithReadings: 1,
      readings: 5,
      unlinkedMasters: 0,
    });

    await applyInstrumentImport(
      db,
      blobs,
      manager,
      stored.file.id,
      { defaultType: "portable_logger" },
      req,
    );
    const [row] = await list(db, manager, { q: "TRH-9702" });
    expect(row!.latest?.number).toBe(number);
    const cert = (await getCertificate(db, manager, row!.latest!.id))!;
    expect(cert).toMatchObject({
      kind: "imported",
      calibratedOn: "2026-07-06",
      validUntil: "2027-07-05",
      sopNo: "QATECH/CAL-026",
      environmentTemperature: "22 °C",
      environmentHumidity: "49 %RH",
    });
    expect(cert.points.map((p) => [p.quantity, p.reference, p.condition])).toEqual([
      ["temperature", "-20.105", ""],
      ["humidity", "20.06", "25 °C"],
    ]);
    const dev = (code: string, seq: number) =>
      cert.readings.find(
        (r) =>
          r.seq === seq &&
          r.instrumentId === cert.items.find((i) => i.instrument.code === code)!.instrument.id,
      )?.deviation;
    expect(dev("TRH-9701", 1)).toBe("-0.095");
    expect(dev("TRH-9702", 1)).toBe("-0.195");
    expect(dev("TRH-9701", 2)).toBe("0.24");
    expect(dev("TRH-9703", 2)).toBeUndefined();
    expect(cert.masters.map((m) => m.certificate?.number)).toEqual([`ARAI/CAL/9701/${run}`]);
    // Imported loggers take the model's accuracy, so pass/fail is judged (Testo 174H model exists).
    expect(cert.items.find((i) => i.instrument.code === "TRH-9701")!.result).not.toBeNull();

    // A report's annexure redraws it from its readings: no scan needed.
    const { certificateAnnex } = await import("@/domain/reports/report-data");
    const annex = await certificateAnnex(db, blobs, manager, {
      placed: [],
      covering: new Map([["L-01", { id: cert.id }]]),
      masters: [],
    } as unknown as Parameters<typeof certificateAnnex>[3]);
    expect(annex.missing).toEqual([]);
    expect(Buffer.from(annex.pdfs[0]!).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("adds a logger left out the first time (no ID yet) to the recorded certificate when the file is imported again", async () => {
    const { createInstrument } = await import("@/domain/instruments/instrument-service");
    const { getCertificate, listInstruments: list } = await import("@/domain/instruments/queries");
    const number = `QATECH/BHIWANDI/07/26/PDL-${(Number(run) % 40) + 50}`;
    const file = async () => {
      const stored = await storeFile(db, blobs, {
        organisationId: manager.organisationId,
        actor: { type: "user", userId: manager.id },
        fileName: "TRH-9801 to TRH-9803.xlsx",
        bytes: await certificateWorkbook(number, [
          { id: `TRH-98${run}1`, serial: `98${run}1` },
          { id: `TRH-98${run}2`, serial: `98${run}2` },
          { id: "", serial: `98${run}3` },
        ]),
        maxBytes: 5 * 1024 * 1024,
      });
      if (!stored.ok) throw new Error(stored.message);
      return stored.file.id;
    };
    const first = await file();
    await applyInstrumentImport(db, blobs, manager, first, { defaultType: "portable_logger" }, req);
    const [one] = await list(db, manager, { q: `TRH-98${run}1` });
    const certId = one!.latest!.id;
    expect((await getCertificate(db, manager, certId))!.items).toHaveLength(2);

    // The lab registers the third logger, then imports the same workbook again.
    await createInstrument(
      db,
      manager,
      { type: "portable_logger", code: `TRH-98${run}3`, serialNo: `98${run}3` },
      req,
    );
    const again = await file();
    const preview = await previewInstrumentImport(db, blobs, manager, again, {
      defaultType: "portable_logger",
    });
    expect(preview.plan.alreadyRecorded).toEqual([]);
    expect(preview.plan.fullCertificates.map((c) => [c.existingId, c.codes])).toEqual([
      [certId, [`TRH-98${run}3`]],
    ]);
    await applyInstrumentImport(db, blobs, manager, again, { defaultType: "portable_logger" }, req);
    const cert = (await getCertificate(db, manager, certId))!;
    expect(cert.items.map((i) => i.instrument.code)).toEqual([
      `TRH-98${run}1`,
      `TRH-98${run}2`,
      `TRH-98${run}3`,
    ]);
    expect(cert.points).toHaveLength(2);
    const third = cert.items.find((i) => i.instrument.code === `TRH-98${run}3`)!.instrument.id;
    expect(cert.readings.filter((r) => r.instrumentId === third).map((r) => r.deviation)).toEqual([
      "0.005",
    ]);
    // A third import changes nothing.
    const thrice = await previewInstrumentImport(db, blobs, manager, await file(), {
      defaultType: "portable_logger",
    });
    expect(thrice.plan.alreadyRecorded).toEqual([number]);
  });

  it("continues the number series after imported numbers, so none is handed out twice", async () => {
    const { allocateNumber } = await import("@/domain/numbering/allocate");
    const { noteUsedNumber } = await import("@/domain/numbering/allocate");
    const format = "QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}";
    const sitesList = [{ code: "BHW", name: "Bhiwandi" }];
    const next = await db.transaction(async (tx) => {
      await noteUsedNumber(tx, {
        organisationId: manager.organisationId,
        kind: "certificate",
        format,
        number: "QATECH/BHIWANDI/03/24/PDL-17",
        sites: sitesList,
      });
      await noteUsedNumber(tx, {
        organisationId: manager.organisationId,
        kind: "certificate",
        format,
        number: "QATECH/BHIWANDI/03/24/PDL-05",
        sites: sitesList,
      });
      return allocateNumber(tx, {
        organisationId: manager.organisationId,
        kind: "certificate",
        format,
        date: new Date("2024-03-20T10:00:00+05:30"),
        siteCode: "BHW",
        siteName: "Bhiwandi",
        certificateKind: "PDL",
      });
    });
    expect(next.number).toBe("QATECH/BHIWANDI/03/24/PDL-18");
  });

  it("gives serials without IDs the next IDs of a prefix, as the chosen model", async () => {
    const { listModels } = await import("@/domain/instruments/queries");
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Sheet1");
    sheet.addRow(["DATA LOGGER DETAILS"]);
    sheet.addRow(["Sr.No", "Data Logger Sr.No."]);
    for (let i = 1; i <= 4; i++) sheet.addRow([i, Number(`88${run}${i}`)]);
    const stored = await storeFile(db, blobs, {
      organisationId: manager.organisationId,
      actor: { type: "user", userId: manager.id },
      fileName: "Data logger details.xlsx",
      bytes: new Uint8Array(await wb.xlsx.writeBuffer()),
      maxBytes: 5 * 1024 * 1024,
    });
    if (!stored.ok) throw new Error(stored.message);
    const plain = await previewInstrumentImport(db, blobs, manager, stored.file.id, {
      defaultType: "portable_logger",
    });
    expect(plain.summary).toMatchObject({ unassigned: 4, instruments: 0 });
    await expect(
      applyInstrumentImport(
        db,
        blobs,
        manager,
        stored.file.id,
        { defaultType: "portable_logger" },
        req,
      ),
    ).rejects.toThrow(/Enter an ID prefix/);

    const testo = (await listModels(db, manager)).find((m) => m.model === "174H")!;
    const choices = {
      defaultType: "portable_logger",
      assignPrefix: `X${run}-`,
      assignModelId: testo.id,
    };
    const preview = await previewInstrumentImport(db, blobs, manager, stored.file.id, choices);
    expect(preview.plan.instruments.map((i) => i.code)).toEqual([
      `X${run}-0001`,
      `X${run}-0002`,
      `X${run}-0003`,
      `X${run}-0004`,
    ]);
    await applyInstrumentImport(db, blobs, manager, stored.file.id, choices, req);
    const rows = await listInstruments(db, manager, { q: `X${run}-` });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      make: "Testo",
      model: "174H",
      accuracyText: "± 0.5 °C (-20 to 70 °C), ± 3 %RH",
    });
  });
});
