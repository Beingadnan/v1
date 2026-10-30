import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, jobInstruments, jobs, sites, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import {
  addPhoto,
  layoutTemplate,
  placeLogger,
  recordEvent,
  recordPrecal,
  removeLogger,
  saveLayout,
  voidEvent,
} from "@/domain/field/field-service";
import { ft12Pdf, getFieldStudy, myStudies } from "@/domain/field/queries";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import {
  bulkAddInstruments,
  createInstrument,
  saveModel,
} from "@/domain/instruments/instrument-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { LocalBlobStore } from "@/lib/storage/blob-store";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const req = { ipAddress: "203.0.113.80" };
let leader: SessionUser;
let engineer: SessionUser;
let otherEngineer: SessionUser;
let accounts: SessionUser;
let outsider: SessionUser;
let orgId: string;
let watsonId: string;
let siteId: string;
let wf02: string;
let cr01: string;
let jobId: string;
let freezerStudy: string;
let roomStudy: string;
let codes: string[] = [];
let expiredSerial: string;
let masterId: string;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ organisationId, email, name, role, status: "active", passwordHash: "x" })
    .returning();
  return toSessionUser(row!)!;
}

const eq0 = (o: Record<string, string>) => ({
  departmentId: null,
  location: "",
  make: "",
  model: "",
  serialNo: "",
  lengthM: "",
  widthM: "",
  heightM: "",
  setPointC: "",
  tempMinC: "",
  tempMaxC: "",
  rhMinPct: "",
  rhMaxPct: "",
  defaultChannels: "",
  readingIntervalMinutes: "10",
  studyDurationHours: "24",
  requalificationMonths: "",
  lastStudyOn: "",
  notes: "",
  ...o,
});

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "field-org", name: "QA Tech Field" }))
    .organisation;
  orgId = org.id;
  const manager = await makeUser(org.id, "mgr@field.test", "manager", "Meera Manager");
  leader = await makeUser(org.id, "tl@field.test", "team_leader", "Tarun Lead");
  engineer = await makeUser(org.id, "fe@field.test", "field_engineer", "Ravi Engineer");
  otherEngineer = await makeUser(org.id, "fe2@field.test", "field_engineer", "Sunil Engineer");
  accounts = await makeUser(org.id, "acc@field.test", "accounts", "Accounts");
  const other = (await ensureOrganisation(db, { slug: "field-other", name: "Other" })).organisation;
  outsider = await makeUser(other.id, "admin@field-other.test", "admin", "Other Admin");
  const [bhw] = await db
    .insert(sites)
    .values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" })
    .returning();

  watsonId = (
    await createCompany(
      db,
      manager,
      {
        name: "Watson Pharma Pvt Limited",
        code: "Watson",
        gstin: "",
        address: "",
        notes: "",
        postCalRequired: false,
        requalificationMonths: 12,
        reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}",
        firstSite: {
          name: "Seawoods",
          code: "Seawoods",
          address: "",
          city: "",
          state: "",
          gstin: "",
        },
      },
      req,
    )
  ).id;
  siteId = (await getCompany(db, manager, watsonId))!.sites[0]!.id;
  wf02 = (
    await createEquipment(
      db,
      manager,
      watsonId,
      eq0({
        siteId,
        code: "BE-WF-02",
        name: "Cold Storage (Walk In Freezer)",
        type: "walk_in_freezer",
        lengthM: "3.36",
        widthM: "6.4",
        heightM: "2.4",
        defaultChannels: "9",
        lastStudyOn: "2025-11-10",
      }) as never,
      req,
    )
  ).id;
  cr01 = (
    await createEquipment(
      db,
      manager,
      watsonId,
      {
        ...eq0({
          siteId,
          code: "BE-CR-01",
          name: "Cold Room",
          type: "cold_room",
          defaultChannels: "4",
        }),
        cycles: ["empty", "door_open"],
      } as never,
      req,
    )
  ).id;

  const modelId = (
    await saveModel(
      db,
      manager,
      null,
      {
        type: "portable_logger",
        make: "ebro",
        model: "EBI 20-T1",
        equipmentName: "Temperature Datalogger",
        quantities: ["temperature"],
        accuracy: { temperature: "0.5" },
        defaultPoints: [{ quantity: "temperature", reference: "-25", condition: "" }],
        intervalMonths: 12,
      },
      req,
    )
  ).id;
  const added = await bulkAddInstruments(
    db,
    manager,
    {
      modelId,
      homeSiteId: bhw!.id,
      codePrefix: "E-TRH",
      serials: Array.from({ length: 20 }, (_, i) => `6228${1200 + i}`).join("\n"),
    },
    req,
  );
  codes = added.map((a) => a.code);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const past = new Date(today.getTime() - 60 * 86_400_000);
  const future = new Date(today.getTime() + 300 * 86_400_000);
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/09/26/PDL-30",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(past),
      validUntil: iso(future),
      instrumentIds: added.slice(0, 19).map((a) => a.id),
    },
    req,
  );
  // The 16th logger has a certificate that ran out yesterday.
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/09/25/PDL-02",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(new Date(today.getTime() - 400 * 86_400_000)),
      validUntil: iso(new Date(today.getTime() - 86_400_000)),
      instrumentIds: [added[19]!.id],
    },
    req,
  );
  expiredSerial = added[19]!.serialNo;
  masterId = (
    await createInstrument(
      db,
      manager,
      {
        type: "reference_thermometer",
        tier: "master",
        code: "QATM/CAL/SSPRT-09",
        serialNo: "321445/3",
        make: "Isotech",
        model: "935",
      },
      req,
    )
  ).id;
  await createExternalCertificate(
    db,
    manager,
    {
      number: "ARAI/CAL/2601/0009",
      ulrNo: "",
      labName: "ARAI",
      calibratedOn: iso(past),
      validUntil: iso(future),
      instrumentIds: [masterId],
    },
    req,
  );

  const job = await createJob(
    db,
    leader,
    {
      companyId: watsonId,
      clientSiteId: siteId,
      siteId: bhw!.id,
      poNumber: "4500011111",
      plannedStart: iso(today),
      plannedEnd: iso(new Date(today.getTime() + 2 * 86_400_000)),
      team: [
        { userId: leader.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
      ],
      items: [{ equipmentId: wf02 }, { equipmentId: cr01 }],
    },
    req,
  );
  jobId = job.id;
  const detail = (await getJob(db, leader, jobId))!;
  freezerStudy = detail.studies.find((s) => s.equipment.code === "BE-WF-02")!.id;
  roomStudy = detail.studies.find((s) => s.equipment.code === "BE-CR-01")!.id;
  for (const key of ["protocol", "site_access", "previous_report"]) {
    await setReadiness(db, leader, jobId, { key, state: "ready", note: "" }, req);
  }
  // The kit: 9 + 4 loggers and 2 spares, E-TRH0001…0015. 0016–0019 stay in the lab.
  await autoBook(db, leader, jobId, req);
});

afterAll(close);

const study = async (id: string) => (await getFieldStudy(db, engineer, id))!;

describe("phase 5: an engineer places 9 loggers for BE-WF-02 and records start and end", () => {
  it("lists my studies for today, only for the team", async () => {
    const mine = await myStudies(db, engineer);
    expect(mine.map((s) => s.equipmentCode)).toEqual(["BE-WF-02", "BE-CR-01"]);
    expect(mine[0]).toMatchObject({ today: true, positions: 0, placed: 0, loggerCount: 9 });
    expect(await myStudies(db, otherEngineer)).toEqual([]);
    expect((await myStudies(db, leader, { everyone: true })).length).toBe(2);
    await expect(myStudies(db, accounts)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getFieldStudy(db, outsider, freezerStudy)).toBeNull();
  });

  it("lays out 9 positions from the template and refuses duplicate labels", async () => {
    const template = await layoutTemplate(db, engineer, freezerStudy);
    expect(template).toHaveLength(9);
    await expect(
      saveLayout(
        db,
        engineer,
        freezerStudy,
        [
          { ...template[0]!, label: "L-01" },
          { ...template[1]!, label: "l-01" },
        ],
        req,
      ),
    ).rejects.toThrow("l-01 is used twice.");
    expect(await saveLayout(db, engineer, freezerStudy, template, req)).toEqual({ count: 9 });
    const s = await study(freezerStudy);
    expect(s.positions.map((p) => p.label)).toEqual(template.map((p) => p.label));
    expect(s.equipment.dims).toEqual({ lengthM: 3.36, widthM: 6.4, heightM: 2.4 });
  });

  it("places scanned loggers on the next empty position, refusing the wrong ones", async () => {
    // By serial, then by ID; each lands on the next empty position.
    const first = await placeLogger(db, engineer, freezerStudy, { code: "62281200" }, req);
    expect(first).toMatchObject({ label: "L-01", code: codes[0], booked: false, left: 8 });
    expect(
      (await placeLogger(db, engineer, freezerStudy, { code: codes[1]!.toLowerCase() }, req)).label,
    ).toBe("L-02");
    await expect(placeLogger(db, engineer, freezerStudy, { code: codes[0]! }, req)).rejects.toThrow(
      `${codes[0]} is already at L-01.`,
    );
    await expect(
      placeLogger(db, engineer, freezerStudy, { code: expiredSerial }, req),
    ).rejects.toThrow("is valid only until");
    await expect(
      placeLogger(db, engineer, freezerStudy, { code: "QATM/CAL/SSPRT-09" }, req),
    ).rejects.toThrow("is a master standard");
    await expect(placeLogger(db, engineer, freezerStudy, { code: "NOPE-1" }, req)).rejects.toThrow(
      "NOPE-1 is not in the instrument register.",
    );
    await expect(placeLogger(db, otherEngineer, freezerStudy, { code: "" }, req)).rejects.toThrow(
      "Scan or type",
    );
    await expect(
      placeLogger(db, accounts, freezerStudy, { code: codes[2]! }, req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(placeLogger(db, outsider, freezerStudy, { code: codes[2]! }, req)).rejects.toThrow(
      "That study does not exist.",
    );
    for (let i = 2; i < 9; i++)
      await placeLogger(db, engineer, freezerStudy, { code: codes[i]! }, req);
    const s = await study(freezerStudy);
    expect(s.positions.filter((p) => p.instrumentId).length).toBe(9);
    await expect(placeLogger(db, engineer, freezerStudy, { code: codes[9]! }, req)).rejects.toThrow(
      "All 9 positions have a logger.",
    );
    // A logger used in this study can't go into the cold room too.
    await saveLayout(db, engineer, roomStudy, await layoutTemplate(db, engineer, roomStudy), req);
    await expect(placeLogger(db, engineer, roomStudy, { code: codes[0]! }, req)).rejects.toThrow(
      `is already at L-01 (BE-WF-02)`,
    );
  });

  it("books a valid logger that wasn't booked, and keeps positions with loggers", async () => {
    const booked = await db.select().from(jobInstruments).where(eq(jobInstruments.jobId, jobId));
    expect(booked.length).toBe(15);
    const s = await study(roomStudy);
    const placed = await placeLogger(
      db,
      engineer,
      roomStudy,
      { code: codes[15]!, positionId: s.positions[2]!.id },
      req,
    );
    expect(placed).toMatchObject({ label: "L-03", booked: true });
    await expect(
      placeLogger(
        db,
        engineer,
        roomStudy,
        { code: codes[16]!, positionId: s.positions[2]!.id },
        req,
      ),
    ).rejects.toThrow(`L-03 already has ${codes[15]}. Remove it first.`);
    await expect(saveLayout(db, engineer, roomStudy, s.positions.slice(0, 2), req)).rejects.toThrow(
      "Remove the logger from L-03",
    );
    await removeLogger(db, engineer, s.positions[2]!.id, req);
    expect((await study(roomStudy)).positions[2]!.instrumentId).toBeNull();
  });

  it("records start and end; the first start moves the job to Field Work; a resend changes nothing", async () => {
    expect((await getJob(db, leader, jobId))!.status).toBe("ready");
    const startId = randomUUID();
    const t0 = new Date(Date.now() - 2 * 3600_000);
    await expect(
      recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: randomUUID(), cycle: "routine", kind: "end", at: t0 },
        req,
      ),
    ).rejects.toThrow("Start study first.");
    expect(
      await recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: startId, cycle: "routine", kind: "start", at: t0 },
        req,
      ),
    ).toEqual({ status: "in_progress", duplicate: false });
    expect(
      await recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: startId, cycle: "routine", kind: "start", at: t0 },
        req,
      ),
    ).toEqual({ status: "in_progress", duplicate: true });
    expect((await getJob(db, leader, jobId))!.status).toBe("field_work");
    await expect(
      recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: randomUUID(), cycle: "routine", kind: "start", at: t0 },
        req,
      ),
    ).rejects.toThrow("Study has already started.");
    await expect(
      recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: randomUUID(), cycle: "routine", kind: "end", at: new Date(t0.getTime() - 60_000) },
        req,
      ),
    ).rejects.toThrow("before study started");
    await expect(
      recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: randomUUID(), cycle: "routine", kind: "end", at: new Date(Date.now() + 3600_000) },
        req,
      ),
    ).rejects.toThrow("in the future");
    await expect(
      recordEvent(
        db,
        engineer,
        freezerStudy,
        { id: randomUUID(), cycle: "empty", kind: "start", at: t0 },
        req,
      ),
    ).rejects.toThrow("isn't part of this study");
    const end = await recordEvent(
      db,
      engineer,
      freezerStudy,
      { id: randomUUID(), cycle: "routine", kind: "end", at: new Date() },
      req,
    );
    expect(end.status).toBe("completed");
    await expect(
      placeLogger(db, engineer, freezerStudy, { code: codes[10]! }, req),
    ).rejects.toThrow("study is done");
  });

  it("orders door and power markers and corrects a wrong time with a reason", async () => {
    await expect(
      recordEvent(
        db,
        engineer,
        roomStudy,
        { id: randomUUID(), cycle: "empty", kind: "start", at: new Date() },
        req,
      ),
    ).rejects.toThrow("Place the loggers before starting.");
    await placeLogger(db, engineer, roomStudy, { code: codes[15]! }, req);
    await expect(
      recordEvent(
        db,
        engineer,
        roomStudy,
        { id: randomUUID(), cycle: "empty", kind: "start", at: new Date() },
        req,
      ),
    ).rejects.toThrow("3 positions have no logger (L-02, L-03, L-04).");
    for (const c of [codes[16]!, codes[17]!, codes[18]!])
      await placeLogger(db, engineer, roomStudy, { code: c }, req);
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    await recordEvent(
      db,
      engineer,
      roomStudy,
      { id: randomUUID(), cycle: "door_open", kind: "start", at: t(60) },
      req,
    );
    await expect(
      recordEvent(
        db,
        engineer,
        roomStudy,
        { id: randomUUID(), cycle: "door_open", kind: "door_closed", at: t(50) },
        req,
      ),
    ).rejects.toThrow('Record "Door opened" first.');
    await recordEvent(
      db,
      engineer,
      roomStudy,
      { id: randomUUID(), cycle: "door_open", kind: "door_opened", at: t(50) },
      req,
    );
    await expect(
      recordEvent(
        db,
        engineer,
        roomStudy,
        { id: randomUUID(), cycle: "door_open", kind: "end", at: t(40) },
        req,
      ),
    ).rejects.toThrow("The door is still open");
    const closed = randomUUID();
    await recordEvent(
      db,
      engineer,
      roomStudy,
      { id: closed, cycle: "door_open", kind: "door_closed", at: t(45) },
      req,
    );
    await expect(voidEvent(db, engineer, closed, "", req)).rejects.toThrow("Say why");
    await voidEvent(db, engineer, closed, "Tapped too early", req);
    let s = await study(roomStudy);
    const door = s.cycles.find((c) => c.cycle === "door_open")!;
    expect(door.events.map((e) => e.kind)).toEqual(["start", "door_opened"]);
    expect(door.next).toBe("door_opened");
    await recordEvent(
      db,
      engineer,
      roomStudy,
      { id: randomUUID(), cycle: "door_open", kind: "door_closed", at: t(44) },
      req,
    );
    await recordEvent(
      db,
      engineer,
      roomStudy,
      { id: randomUUID(), cycle: "door_open", kind: "end", at: t(10) },
      req,
    );
    s = await study(roomStudy);
    // Only one of its two cycles is done.
    expect(s.status).toBe("in_progress");
    expect(s.cycles.map((c) => [c.cycle, c.done])).toEqual([
      ["empty", false],
      ["door_open", true],
    ]);
  });

  it("blocks a logger that fails pre-calibration", async () => {
    const pass = await recordPrecal(
      db,
      engineer,
      roomStudy,
      { id: randomUUID(), code: codes[13]!, masterId, reference: "-20.10", reading: "-20.4" },
      req,
    );
    expect(pass).toMatchObject({ result: "pass", deviation: "-0.30", tolerance: 0.5 });
    const fail = await recordPrecal(
      db,
      engineer,
      roomStudy,
      { id: randomUUID(), code: codes[14]!, masterId, reference: "-20.10", reading: "-21.2" },
      req,
    );
    expect(fail.result).toBe("fail");
    await expect(placeLogger(db, engineer, roomStudy, { code: codes[14]! }, req)).rejects.toThrow(
      "failed pre-calibration",
    );
    await expect(
      recordPrecal(
        db,
        engineer,
        roomStudy,
        { id: randomUUID(), code: codes[13]!, masterId: null, reference: "-20.1", reading: "20.4" },
        req,
      ),
    ).rejects.toThrow("minus sign");
    await expect(
      recordPrecal(
        db,
        engineer,
        roomStudy,
        {
          id: randomUUID(),
          code: codes[13]!,
          masterId: codes.length ? (await study(roomStudy)).positions[0]!.id : null,
          reference: "1",
          reading: "1",
        },
        req,
      ),
    ).rejects.toThrow("Pick a master standard.");
  });

  it("stores photos once and refuses other files", async () => {
    const blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-photos-")));
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff,
      0xd9,
    ]);
    const id = randomUUID();
    expect(
      await addPhoto(
        db,
        blobs,
        engineer,
        roomStudy,
        { id, fileName: "IMG_2041.jpg", bytes: jpeg, positionLabel: "L-01" },
        req,
      ),
    ).toEqual({ id });
    expect(
      await addPhoto(
        db,
        blobs,
        engineer,
        roomStudy,
        { id, fileName: "IMG_2041.jpg", bytes: jpeg },
        req,
      ),
    ).toEqual({ id });
    expect((await study(roomStudy)).photos).toHaveLength(1);
    const pdf = new TextEncoder().encode("%PDF-1.4 not a photo");
    await expect(
      addPhoto(
        db,
        blobs,
        engineer,
        roomStudy,
        { id: randomUUID(), fileName: "x.pdf", bytes: pdf },
        req,
      ),
    ).rejects.toThrow("Only photos");
  });

  it("prints FT-12 with the box, the positions, the loggers and the times", async () => {
    const blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-ft12-")));
    const pdf = (await ft12Pdf(db, blobs, leader, freezerStudy))!;
    expect(pdf.fileName).toMatch(/^FT-12 BE-WF-02 QT-J-\d{4}-\d{4}\.pdf$/);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await writeFile(path.join(tmpdir(), "ft12-test.pdf"), pdf.bytes);
    if (!hasPdftotext) return;
    const text = execFileSync("pdftotext", [
      "-layout",
      path.join(tmpdir(), "ft12-test.pdf"),
      "-",
    ]).toString();
    for (const want of [
      "Sensor Location Sheet",
      "BE-WF-02",
      "L-3360 mm",
      "W-6400 mm",
      "H-2400 mm",
      "L-09",
      codes[8]!,
      "62281200",
      "QATM/PVAL/FT-12",
      "Tarun Lead",
    ]) {
      expect(text, want).toContain(want);
    }
    expect(await ft12Pdf(db, blobs, outsider, freezerStudy)).toBeNull();
  });

  it("audits field work", async () => {
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.organisationId, orgId), eq(auditLog.entityId, freezerStudy)));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "study.layout_saved",
      "study.logger_placed",
      "study.event_recorded",
      "study.status_changed",
    ]) {
      expect(actions.has(a as never), a).toBe(true);
    }
    const [job] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
    expect(job!.status).toBe("field_work");
  });
});
