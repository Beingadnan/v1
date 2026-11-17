import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { auditLog, certificateItems, certificates, signatures, sites, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { hashPassword } from "@/domain/auth/password";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import {
  createCalibration,
  returnCalibration,
  saveCalibration,
  signCalibrationStep,
} from "@/domain/instruments/calibration-service";
import {
  cancelCertificate,
  createExternalCertificate,
} from "@/domain/instruments/certificate-service";
import {
  bulkAddInstruments,
  createInstrument,
  saveModel,
} from "@/domain/instruments/instrument-service";
import {
  calibrationIndex,
  getCertificate,
  listInstruments,
  traceChain,
} from "@/domain/instruments/queries";

import { certificatePdf } from "@/domain/instruments/pdf-service";
import { LocalBlobStore } from "@/lib/storage/blob-store";

import { openTestDatabase } from "../support/test-db";

const { db } = openTestDatabase();
const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const req = { ipAddress: "203.0.113.60" };
const PASSWORD = "dry block at one fifty";
let lab: SessionUser;
let leader: SessionUser;
let manager: SessionUser;
let engineer: SessionUser;
let other: SessionUser;
let siteId: string;
let modelId: string;
let ssprtId: string;
let hygroId: string;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({
      organisationId,
      email,
      name,
      role,
      status: "active",
      passwordHash: await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }),
    })
    .returning();
  return toSessionUser(row!)!;
}

async function master(
  code: string,
  type: "reference_thermometer" | "humidity_indicator",
  serial: string,
) {
  return (
    await createInstrument(
      db,
      manager,
      {
        type,
        tier: "master",
        code,
        serialNo: serial,
        make: "Isotech",
        model: "935-14-72",
        homeSiteId: siteId,
      },
      req,
    )
  ).id;
}

const ebi20th1 = {
  type: "portable_logger",
  make: "ebro",
  model: "EBI 20-TH1",
  equipmentName: "Temp. & RH Datalogger",
  quantities: ["temperature", "humidity"],
  rangeText: "-30 to 70 °C, 0 to 100 %RH",
  resolutionText: "0.1",
  accuracy: {
    temperature: "0.8",
    temperatureBandFrom: "-20",
    temperatureBandTo: "40",
    temperatureBandTolerance: "0.5",
    humidity: "3",
  },
  accuracyText: "± 0.5 °C (-20 to 40°C), ± 0.8 °C for the remaining range & ± 3% at 10 to 90 % RH",
  calibrationSop: "QATECH/CAL-026",
  defaultPoints: [
    { quantity: "temperature", reference: "-25", condition: "" },
    { quantity: "temperature", reference: "15", condition: "50 %RH" },
    { quantity: "temperature", reference: "60", condition: "" },
    { quantity: "humidity", reference: "20", condition: "25 °C" },
    { quantity: "humidity", reference: "50", condition: "25 °C" },
    { quantity: "humidity", reference: "90", condition: "25 °C" },
  ],
  intervalMonths: 12,
} as const;

/** PDL-17 points (master readings) from the FT-05 of 26.03.2026. */
const pdl17Points = [
  { quantity: "temperature", reference: "-25.084", condition: "" },
  { quantity: "temperature", reference: "15.041", condition: "50 %RH" },
  { quantity: "temperature", reference: "60.023", condition: "" },
  { quantity: "humidity", reference: "20.44", condition: "25 °C" },
  { quantity: "humidity", reference: "50.31", condition: "25 °C" },
  { quantity: "humidity", reference: "90.27", condition: "25 °C" },
] as const;

const header = (calibratedOn: string) => ({
  calibratedOn,
  validUntil: null,
  title: "ebro Portable Datalogger 10 (New)",
  location: "Bhiwandi",
  department: "Calibration Lab",
  equipmentName: "Temp. & RH Datalogger",
  make: "ebro",
  model: "EBI 20-TH1",
  rangeText: "-30 to 70 °C",
  resolutionText: "0.1",
  accuracyText: "± 0.5 °C",
  sopNo: "QATECH/CAL-026",
  conditionOnReceipt: "Good",
  environmentTemperature: "23 °C",
  environmentHumidity: "57 %RH",
  remarks: "",
});

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "instr-org", name: "QA Tech" })).organisation;
  lab = await makeUser(org.id, "lab@instr.test", "lab", "Lab Tech");
  leader = await makeUser(org.id, "tl@instr.test", "team_leader", "Team Leader");
  manager = await makeUser(org.id, "mgr@instr.test", "manager", "Quality Manager");
  engineer = await makeUser(org.id, "fe@instr.test", "field_engineer", "Field Engineer");
  const otherOrg = (await ensureOrganisation(db, { slug: "instr-other", name: "Other Lab" }))
    .organisation;
  other = await makeUser(otherOrg.id, "admin@other.test", "admin", "Other Admin");
  const [site] = await db
    .insert(sites)
    .values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" })
    .returning();
  siteId = site!.id;

  modelId = (await saveModel(db, manager, null, ebi20th1, req)).id;
  ssprtId = await master("QATM/CAL/SSPRT-01", "reference_thermometer", "311401/59");
  hygroId = await master("QATM/CAL/TH-22", "humidity_indicator", "60477499");
  await createExternalCertificate(
    db,
    manager,
    {
      number: "ARAI/CAL/2508/2925",
      ulrNo: "",
      labName: "ARAI",
      calibratedOn: "2025-09-09",
      validUntil: "2026-09-08",
      instrumentIds: [ssprtId],
    },
    req,
  );
  await createExternalCertificate(
    db,
    manager,
    {
      number: "SAN/25/1165/TH/1",
      ulrNo: "CC287925000001165F",
      labName: "Sansel",
      calibratedOn: "2025-10-01",
      validUntil: "2026-09-30",
      instrumentIds: [hygroId],
    },
    req,
  );
});

describe("instrument register", () => {
  it("adds a batch of loggers with consecutive IDs and the model's details", async () => {
    await createInstrument(
      db,
      manager,
      {
        type: "portable_logger",
        code: "E-TRH0523",
        serialNo: "62363016",
        modelId,
        homeSiteId: siteId,
      },
      req,
    );
    const added = await bulkAddInstruments(
      db,
      manager,
      {
        modelId,
        homeSiteId: siteId,
        codePrefix: "E-TRH",
        serials:
          "62363017\n62363018\t62363019, 62363020 62363021\n62363022\n62363023\n62363024\n62363025\n62363026",
      },
      req,
    );
    expect(added.map((i) => i.code)).toEqual([
      "E-TRH0524",
      "E-TRH0525",
      "E-TRH0526",
      "E-TRH0527",
      "E-TRH0528",
      "E-TRH0529",
      "E-TRH0530",
      "E-TRH0531",
      "E-TRH0532",
      "E-TRH0533",
    ]);
    expect(added[0]).toMatchObject({ make: "ebro", model: "EBI 20-TH1", serialNo: "62363017" });
  });

  it("refuses a serial already registered for the same model", async () => {
    await expect(
      createInstrument(
        db,
        manager,
        { type: "portable_logger", code: "E-TRH9999", serialNo: "62363017", modelId },
        req,
      ),
    ).rejects.toThrow(/serial/i);
  });

  it("names the pasted serials that are already registered, and adds none of the batch", async () => {
    await expect(
      bulkAddInstruments(
        db,
        manager,
        {
          modelId,
          homeSiteId: siteId,
          codePrefix: "E-TRH",
          serials: "62399001\n62363018\n62399002\n62363016",
        },
        req,
      ),
    ).rejects.toThrow(
      "Already registered: 62363018 (E-TRH0525), 62363016 (E-TRH0523). Take them out of the list and add the rest.",
    );
    expect(await listInstruments(db, manager, { q: "62399001" })).toHaveLength(0);
  });

  it("keeps field engineers to viewing", async () => {
    await expect(
      createInstrument(db, engineer, { type: "portable_logger", code: "X-1" }, req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listInstruments(db, engineer)).length).toBeGreaterThan(0);
  });

  it("does not show one organisation's instruments to another", async () => {
    expect(await listInstruments(db, other)).toEqual([]);
  });
});

describe("PDL-17: batch calibration certificate (exit test)", () => {
  let certId: string;
  let loggerIds: string[];

  it("starts a draft numbered from the site's monthly series, with the model's points", async () => {
    const loggers = await listInstruments(db, lab, { q: "E-TRH05" });
    loggerIds = loggers
      .filter((l) => l.code >= "E-TRH0524" && l.code <= "E-TRH0533")
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((l) => l.id);
    expect(loggerIds).toHaveLength(10);
    // 16 PDL certificates earlier that month, so this one is PDL-17.
    for (let i = 1; i <= 16; i++) {
      const c = await createCalibration(
        db,
        lab,
        {
          header: { ...header("2026-03-26"), siteId },
          instrumentIds: [loggerIds[0]!],
          masterIds: [],
        },
        req,
      );
      expect(c.number).toBe(`QATECH/BHIWANDI/03/26/PDL-${String(i).padStart(2, "0")}`);
    }
    const cert = await createCalibration(
      db,
      lab,
      {
        header: { ...header("2026-03-26"), siteId },
        instrumentIds: loggerIds,
        masterIds: [ssprtId, hygroId],
      },
      req,
    );
    certId = cert.id;
    expect(cert).toMatchObject({
      number: "QATECH/BHIWANDI/03/26/PDL-17",
      status: "draft",
      validUntil: "2027-03-25",
      sopNo: "QATECH/CAL-026",
      performedByName: "Lab Tech",
    });
    const detail = await getCertificate(db, lab, certId);
    expect(detail!.points.map((p) => p.reference)).toEqual(["-25", "15", "60", "20", "50", "90"]);
    expect(detail!.masters.map((m) => m.certificate?.number)).toEqual([
      "ARAI/CAL/2508/2925",
      "SAN/25/1165/TH/1",
    ]);
  });

  it("re-entering the readings gives the same deviations as the paper copy", async () => {
    // Logger 1 and logger 2 readings from the FT-05; the rest read exactly the master.
    const l1 = ["-25", "15", "60.2", "21.1", "50.6", "90.2"];
    const l2 = ["-25.2", "15.2", "59.9", "20.5", "50.31", "90.27"];
    const readings = pdl17Points.map((p, pi) =>
      loggerIds.map((_, li) => (li === 0 ? l1[pi]! : li === 1 ? l2[pi]! : p.reference)),
    );
    const saved = await saveCalibration(
      db,
      lab,
      certId,
      {
        header: header("2026-03-26"),
        points: [...pdl17Points],
        masterIds: [ssprtId, hygroId],
        instrumentIds: loggerIds,
        readings,
      },
      req,
    );
    expect(saved).toEqual({ missing: 0, failed: 0 });
    const detail = (await getCertificate(db, lab, certId))!;
    const dev = (instrumentId: string) =>
      detail.points.map((p) => {
        const r = detail.readings.find((x) => x.instrumentId === instrumentId && x.seq === p.seq)!;
        return Number(r.deviation);
      });
    expect(dev(loggerIds[0]!)).toEqual([0.084, -0.041, 0.177, 0.66, 0.29, -0.07]);
    expect(dev(loggerIds[1]!)).toEqual([-0.116, 0.159, -0.123, 0.06, 0, 0]);
    expect(detail.items.every((i) => i.result === "pass")).toBe(true);
  });

  it("marks a reading outside the accuracy as failed", async () => {
    const readings = pdl17Points.map((p, pi) =>
      loggerIds.map((_, li) => (li === 2 && pi === 1 ? "15.6" : p.reference)),
    );
    const saved = await saveCalibration(
      db,
      lab,
      certId,
      {
        header: header("2026-03-26"),
        points: [...pdl17Points],
        masterIds: [ssprtId, hygroId],
        instrumentIds: loggerIds,
        readings,
      },
      req,
    );
    expect(saved.failed).toBe(1);
    const detail = (await getCertificate(db, lab, certId))!;
    expect(detail.items[2]!.result).toBe("fail");
  });

  it("goes done by → checked by → approved by, with different people and passwords", async () => {
    const readings = pdl17Points.map((p) => loggerIds.map(() => p.reference));
    await saveCalibration(
      db,
      lab,
      certId,
      {
        header: header("2026-03-26"),
        points: [...pdl17Points],
        masterIds: [ssprtId, hygroId],
        instrumentIds: loggerIds,
        readings,
      },
      req,
    );
    expect(
      await signCalibrationStep(
        db,
        lab,
        { certificateId: certId, step: "submit", password: "wrong one" },
        req,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await signCalibrationStep(
        db,
        lab,
        { certificateId: certId, step: "submit", password: PASSWORD },
        req,
      ),
    ).toEqual({ ok: true, status: "checking" });
    await expect(
      saveCalibration(
        db,
        lab,
        certId,
        {
          header: header("2026-03-26"),
          points: [...pdl17Points],
          masterIds: [ssprtId],
          instrumentIds: loggerIds,
          readings,
        },
        req,
      ),
    ).rejects.toThrow(/return it to draft/i);
    await expect(
      signCalibrationStep(
        db,
        lab,
        { certificateId: certId, step: "check", password: PASSWORD },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await returnCalibration(
      db,
      leader,
      { certificateId: certId, reason: "Environment humidity missing" },
      req,
    );
    expect(
      await signCalibrationStep(
        db,
        lab,
        { certificateId: certId, step: "submit", password: PASSWORD },
        req,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await signCalibrationStep(
        db,
        leader,
        { certificateId: certId, step: "check", password: PASSWORD },
        req,
      ),
    ).toEqual({ ok: true, status: "approving" });
    expect(
      await signCalibrationStep(
        db,
        manager,
        { certificateId: certId, step: "approve", password: PASSWORD },
        req,
      ),
    ).toEqual({ ok: true, status: "issued" });

    const sigs = await db.select().from(signatures).where(eq(signatures.entityId, certId));
    expect(sigs.map((s) => s.meaning)).toEqual(["done_by", "done_by", "checked_by", "approved_by"]);
    expect(new Set(sigs.map((s) => s.recordHash)).size).toBe(1);
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, certId), eq(auditLog.entityType, "certificate")));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["certificate.created", "certificate.returned", "certificate.issued"]),
    );
    const issued = (await getCertificate(db, lab, certId))!;
    expect(issued.preparedByName).toBe("Lab Tech");
    expect(issued.issuedOn).not.toBeNull();
  });

  it("prints the FT-05 PDF with the readings, deviations and masters, and freezes it once issued", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qtech-ft05-"));
    const blobs = new LocalBlobStore(dir);
    const first = (await certificatePdf(db, blobs, lab, certId))!;
    expect(first.fileName).toBe("QATECH-BHIWANDI-03-26-PDL-17.pdf");
    expect(Buffer.from(first.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const again = (await certificatePdf(db, blobs, manager, certId))!;
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    if (!hasPdftotext) return; // the text check needs poppler's pdftotext
    const file = path.join(dir, "pdl17.pdf");
    await writeFile(file, first.bytes);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
    for (const expected of [
      "Calibration Certificate",
      "QATECH/BHIWANDI/03/26/PDL-17",
      "26.03.2026",
      "25.03.2027",
      "ARAI/CAL/2508/2925",
      "SAN/25/1165/TH/1",
      "62363017",
      "E-TRH0533",
      "-25.084",
      "90.27",
      "within the specified accuracy limits",
      "Decision rule",
      "Lab Tech",
      "Quality Manager",
      "Page 01 of 01",
      "QATM/PVAL/FT-05",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("DRAFT");
    expect(text.match(/Decision rule/g)).toHaveLength(1);
  });

  it("stops the person who did the calibration from checking it", async () => {
    const c = await createCalibration(
      db,
      leader,
      {
        header: { ...header("2026-03-27"), siteId },
        instrumentIds: [loggerIds[0]!],
        masterIds: [ssprtId],
      },
      req,
    );
    await saveCalibration(
      db,
      leader,
      c.id,
      {
        header: header("2026-03-27"),
        points: [{ quantity: "temperature", reference: "20", condition: "" }],
        masterIds: [ssprtId],
        instrumentIds: [loggerIds[0]!],
        readings: [["20.1"]],
      },
      req,
    );
    await signCalibrationStep(
      db,
      leader,
      { certificateId: c.id, step: "submit", password: PASSWORD },
      req,
    );
    await expect(
      signCalibrationStep(
        db,
        leader,
        { certificateId: c.id, step: "check", password: PASSWORD },
        req,
      ),
    ).rejects.toThrow(/someone other than/i);
  });

  it("lists the month in the Calibration Index, in number order", async () => {
    const index = await calibrationIndex(db, lab, 2026, 3);
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ section: "Portable Datalogger", kind: "PDL" });
    expect(index[0]!.rows).toEqual([
      expect.objectContaining({
        number: "QATECH/BHIWANDI/03/26/PDL-17",
        calibratedOn: "2026-03-26",
        validUntil: "2027-03-25",
        doneBy: "Lab Tech",
        certificateBy: "Lab Tech",
        instruments: 10,
      }),
    ]);
  });

  it("shows the loggers as valid, with PDL-17 as their latest certificate", async () => {
    const [row] = await listInstruments(db, lab, { q: "E-TRH0530" });
    expect(row!.latest?.number).toBe("QATECH/BHIWANDI/03/26/PDL-17");
  });
});

describe("masters must be valid on the calibration date", () => {
  it("refuses a master whose certificate had expired", async () => {
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    await expect(
      createCalibration(
        db,
        lab,
        {
          header: { ...header("2026-10-01"), siteId },
          instrumentIds: [logger!.id],
          masterIds: [hygroId],
        },
        req,
      ),
    ).rejects.toThrow(/SAN\/25\/1165\/TH\/1\) expired on 30.09.2026/);
  });

  it("refuses a working instrument as a master", async () => {
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    await expect(
      createCalibration(
        db,
        lab,
        {
          header: { ...header("2026-03-26"), siteId },
          instrumentIds: [logger!.id],
          masterIds: [logger!.id],
        },
        req,
      ),
    ).rejects.toThrow(/not a master standard/);
  });
});

describe("traceability (exit test: logger 62271257 on 11.08.2025)", () => {
  it("follows the logger's certificate to the masters and their ARAI certificate", async () => {
    const prt = (
      await createInstrument(
        db,
        manager,
        {
          type: "reference_thermometer",
          tier: "master",
          code: "QATM/CAL/SSPRT-OLD",
          serialNo: "311400/12",
          homeSiteId: siteId,
        },
        req,
      )
    ).id;
    await createExternalCertificate(
      db,
      manager,
      {
        number: "ARAI/CAL/2408/1836",
        labName: "ARAI",
        calibratedOn: "2024-08-20",
        validUntil: "2025-08-19",
        instrumentIds: [prt],
      },
      req,
    );
    const logger = await createInstrument(
      db,
      manager,
      { type: "portable_logger", code: "E-TRH0301", serialNo: "62271257", modelId },
      req,
    );
    const cal = await createCalibration(
      db,
      lab,
      { header: { ...header("2025-08-11"), siteId }, instrumentIds: [logger.id], masterIds: [prt] },
      req,
    );
    await saveCalibration(
      db,
      lab,
      cal.id,
      {
        header: header("2025-08-11"),
        points: [{ quantity: "temperature", reference: "-20.012", condition: "" }],
        masterIds: [prt],
        instrumentIds: [logger.id],
        readings: [["-20.1"]],
      },
      req,
    );
    await signCalibrationStep(
      db,
      lab,
      { certificateId: cal.id, step: "submit", password: PASSWORD },
      req,
    );
    await signCalibrationStep(
      db,
      leader,
      { certificateId: cal.id, step: "check", password: PASSWORD },
      req,
    );
    await signCalibrationStep(
      db,
      manager,
      { certificateId: cal.id, step: "approve", password: PASSWORD },
      req,
    );

    const chain = (await traceChain(db, lab, logger.id, "2025-08-11"))!;
    expect(chain.instrument.serialNo).toBe("62271257");
    expect(chain.certificate?.number).toBe("QATECH/BHIWANDI/08/25/PDL-01");
    expect(chain.validOnDate).toBe(true);
    expect(chain.masters).toHaveLength(1);
    expect(chain.masters[0]!.certificate?.number).toBe("ARAI/CAL/2408/1836");
    expect(chain.masters[0]!.date).toBe("2025-08-11");
    expect(chain.masters[0]!.validOnDate).toBe(true);

    // Later, the same master's old certificate no longer covers a new date.
    const lateChain = (await traceChain(db, lab, prt, "2025-09-01"))!;
    expect(lateChain.certificate).toBeNull();
  });

  it("does not trace another organisation's instrument", async () => {
    expect(await traceChain(db, other, ssprtId, "2026-03-26")).toBeNull();
  });
});

describe("cancelling", () => {
  it("cancels with a reason; a cancelled master certificate no longer covers anything", async () => {
    const prt = (
      await createInstrument(
        db,
        manager,
        { type: "reference_thermometer", tier: "master", code: "QATM/CAL/PRT-X" },
        req,
      )
    ).id;
    const cert = await createExternalCertificate(
      db,
      manager,
      {
        number: "X/1",
        labName: "Some Lab",
        calibratedOn: "2026-01-01",
        validUntil: "2026-12-31",
        instrumentIds: [prt],
      },
      req,
    );
    await expect(
      cancelCertificate(db, manager, { certificateId: cert.id, reason: "" }, req),
    ).rejects.toThrow();
    await cancelCertificate(
      db,
      manager,
      { certificateId: cert.id, reason: "Wrong instrument" },
      req,
    );
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    await expect(
      createCalibration(
        db,
        lab,
        {
          header: { ...header("2026-03-26"), siteId },
          instrumentIds: [logger!.id],
          masterIds: [prt],
        },
        req,
      ),
    ).rejects.toThrow(/no calibration certificate/);
    const items = await db
      .select()
      .from(certificateItems)
      .where(eq(certificateItems.certificateId, cert.id));
    expect(items).toHaveLength(1);
  });
});

describe("numbers already used before QTech", () => {
  it("skips a number an imported certificate already has", async () => {
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    // An imported record that took the next number of the April 2026 PDL series.
    await db.insert(certificates).values({
      organisationId: lab.organisationId,
      kind: "imported",
      status: "issued",
      number: "QATECH/BHIWANDI/04/26/PDL-01",
      labName: "QA Tech",
      calibratedOn: "2026-04-02",
    });
    const cert = await createCalibration(
      db,
      lab,
      {
        header: { ...header("2026-04-10"), siteId },
        instrumentIds: [logger!.id],
        masterIds: [ssprtId],
      },
      req,
    );
    expect(cert.number).toBe("QATECH/BHIWANDI/04/26/PDL-02");
  });
});

describe("dates a person might get wrong", () => {
  it("refuses a calibration dated in the future, and a due date before the calibration", async () => {
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    const start = (calibratedOn: string, validUntil: string | null) =>
      createCalibration(
        db,
        lab,
        {
          header: { ...header(calibratedOn), validUntil, siteId },
          instrumentIds: [logger!.id],
          masterIds: [ssprtId],
        },
        req,
      );
    await expect(start("2099-01-01", null)).rejects.toThrow(/in the future/);
    await expect(start("2026-03-26", "2025-01-01")).rejects.toThrow(/due date must be after/);
  });

  it("puts loggers of one model on one certificate however their Excel spelt the model", async () => {
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    // Same register model, typed "EBRO EBI20-TH1" in another site's Excel.
    const spelt = await createInstrument(
      db,
      manager,
      {
        type: "portable_logger",
        code: "E-TRH0901",
        serialNo: "62399901",
        modelId,
        make: "EBRO",
        model: "EBI20-TH1",
        homeSiteId: siteId,
      },
      req,
    );
    // Not linked to the register, spelt differently again.
    const unlinked = await createInstrument(
      db,
      manager,
      {
        type: "portable_logger",
        code: "E-TRH0902",
        serialNo: "62399902",
        make: "Ebro",
        model: "EBI-20 TH1",
        homeSiteId: siteId,
      },
      req,
    );
    const other = await createInstrument(
      db,
      manager,
      {
        type: "portable_logger",
        code: "E-TRH0903",
        serialNo: "62399903",
        make: "Testo",
        model: "174H",
        homeSiteId: siteId,
      },
      req,
    );
    const start = (ids: string[]) =>
      createCalibration(
        db,
        lab,
        { header: { ...header("2026-03-27"), siteId }, instrumentIds: ids, masterIds: [] },
        req,
      );
    await expect(start([logger!.id, spelt.id])).resolves.toMatchObject({
      number: expect.stringContaining("PDL"),
    });
    await expect(start([unlinked.id, other.id])).rejects.toThrow(
      "E-TRH0903 is Testo 174H, the others are Ebro EBI-20 TH1. Put each model on its own certificate.",
    );
  });
});

describe("readings that can't be right", () => {
  it("refuses a serial number pasted as a reading, and %RH points without a humidity master", async () => {
    const [logger] = await listInstruments(db, lab, { q: "E-TRH0523" });
    const c = await createCalibration(
      db,
      lab,
      {
        header: { ...header("2026-03-28"), siteId },
        instrumentIds: [logger!.id],
        masterIds: [ssprtId],
      },
      req,
    );
    const save = (reading: string, masters: string[]) =>
      saveCalibration(
        db,
        lab,
        c.id,
        {
          header: header("2026-03-28"),
          points: [
            { quantity: "temperature", reference: "15.12", condition: "" },
            { quantity: "humidity", reference: "50.31", condition: "25 °C" },
          ],
          masterIds: masters,
          instrumentIds: [logger!.id],
          readings: [[reading], ["50.6"]],
        },
        req,
      );
    await expect(save("84028189", [ssprtId])).rejects.toThrow(/serial number or a typo/);
    await save("15.2 °C", [ssprtId]);
    await expect(
      signCalibrationStep(
        db,
        lab,
        { certificateId: c.id, step: "submit", password: PASSWORD },
        req,
      ),
    ).rejects.toThrow(/no master for humidity/);
    await save("15.2", [ssprtId, hygroId]);
    expect(
      await signCalibrationStep(
        db,
        lab,
        { certificateId: c.id, step: "submit", password: PASSWORD },
        req,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("planning the week's calibration", () => {
  it("groups loggers that need calibrating by model, most urgent first, and exports the register", async () => {
    const { dueBatches } = await import("@/domain/instruments/queries");
    const { exportRegisterWorkbook } = await import("@/domain/instruments/register-export");
    const batches = await dueBatches(db, lab);
    const ebro = batches.find((b) => b.model === "EBI 20-TH1")!;
    expect(ebro.instruments.length).toBeGreaterThan(0);
    // Never calibrated first.
    expect(ebro.instruments[0]!.validity).toBe("never");
    expect(batches.every((b) => b.instruments.every((i) => i.validity !== "valid"))).toBe(true);

    const rows = await listInstruments(db, lab, { q: "E-TRH05" });
    const bytes = await exportRegisterWorkbook(rows, "Register");
    const wb = new (await import("exceljs")).default.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    expect((sheet.getRow(2).values as unknown[]).slice(1, 11)).toEqual([
      "SR. No.",
      "Instrument Name",
      "Make",
      "Model",
      "ID No.",
      "Serial No.",
      "Certificate No.",
      "Range",
      "Calibration Date",
      "Due Date",
    ]);
    const pdl17 = sheet.getColumn(7).values.find((v) => v === "QATECH/BHIWANDI/03/26/PDL-17");
    expect(pdl17).toBeDefined();
    expect(sheet.getColumn(10).values).toContain("25.03.2027");
  });

  it("adds a batch of serials in one go with one audit entry", async () => {
    const { bulkAddInstruments } = await import("@/domain/instruments/instrument-service");
    const before = await db.$count(auditLog);
    const added = await bulkAddInstruments(
      db,
      manager,
      {
        modelId,
        homeSiteId: siteId,
        codePrefix: "B-TRH",
        serials: Array.from({ length: 120 }, (_, i) => 70000000 + i).join("\n"),
      },
      req,
    );
    expect(added).toHaveLength(120);
    expect(added[0]).toMatchObject({
      code: "B-TRH0001",
      make: "ebro",
      accuracyText: expect.stringContaining("± 0.5"),
    });
    expect(added.at(-1)!.code).toBe("B-TRH0120");
    expect((await db.$count(auditLog)) - before).toBe(1);
  });
});
