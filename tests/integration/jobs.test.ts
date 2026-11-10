import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, jobStatusHistory, sites, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany, createClientSite } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import {
  bulkAddInstruments,
  createInstrument,
  saveModel,
} from "@/domain/instruments/instrument-service";
import {
  addStudies,
  autoBook,
  bookByCodes,
  changeStatus,
  createJob,
  releaseInstruments,
  removeStudy,
  setReadiness,
  setTeam,
  updateJob,
  updateStudy,
} from "@/domain/jobs/job-service";
import { dueStatus, todayInIndia } from "@/domain/clients/requalification";
import { getFieldStudy } from "@/domain/field/queries";
import { getJob, listJobs, siteEquipment } from "@/domain/jobs/queries";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.70" };
let manager: SessionUser;
let leader: SessionUser;
let engineer: SessionUser;
let accounts: SessionUser;
let outsider: SessionUser;
let orgId: string;
let bhwId: string;
let watsonId: string;
let seawoodsId: string;
let navalId: string;
let wf02: string;
let wf03: string;
let cr01: string;
let elsewhere: string;
const loggerIds: Record<string, string> = {};
let loggerModelId: string;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ organisationId, email, name, role, status: "active", passwordHash: "x" })
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
const site = (name: string) => ({ name, code: name, address: "", city: "", state: "", gstin: "" });
const freezer = (siteId: string, code: string, lastStudyOn: string, type = "walk_in_freezer") => ({
  siteId,
  departmentId: null,
  code,
  name: type === "cold_room" ? "Cold Room" : "Cold Storage (Walk In Freezer)",
  type,
  location: "",
  make: "Blue Star",
  model: "",
  serialNo: "",
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
  lastStudyOn,
  notes: "",
});

let jobId: string;
let jobNumber: string;

beforeAll(async () => {
  const org = (await ensureOrganisation(db, { slug: "jobs-org", name: "QA Tech Jobs" }))
    .organisation;
  orgId = org.id;
  manager = await makeUser(org.id, "mgr@jobs.test", "manager", "Quality Manager");
  leader = await makeUser(org.id, "tl@jobs.test", "team_leader", "Rahul TL");
  engineer = await makeUser(org.id, "fe@jobs.test", "field_engineer", "Suresh FE");
  accounts = await makeUser(org.id, "acc@jobs.test", "accounts", "Accounts");
  const otherOrg = (await ensureOrganisation(db, { slug: "jobs-other", name: "Other" }))
    .organisation;
  outsider = await makeUser(otherOrg.id, "admin@jobs-other.test", "admin", "Other Admin");
  const [bhw] = await db
    .insert(sites)
    .values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" })
    .returning();
  bhwId = bhw!.id;

  watsonId = (await createCompany(db, manager, { ...company, firstSite: site("Seawoods") }, req))
    .id;
  seawoodsId = (await getCompany(db, manager, watsonId))!.sites[0]!.id;
  navalId = (await createClientSite(db, manager, watsonId, site("Taloja"), req)).id;
  wf02 = (
    await createEquipment(db, manager, watsonId, freezer(seawoodsId, "BE-WF-02", "2025-11-10"), req)
  ).id;
  wf03 = (await createEquipment(db, manager, watsonId, freezer(seawoodsId, "BE-WF-03", ""), req))
    .id;
  cr01 = (
    await createEquipment(
      db,
      manager,
      watsonId,
      freezer(seawoodsId, "BE-CR-01", "", "cold_room"),
      req,
    )
  ).id;
  elsewhere = (await createEquipment(db, manager, watsonId, freezer(navalId, "TL-WF-01", ""), req))
    .id;

  const modelId = (loggerModelId = (
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
  ).id);
  // T-01…T-10 valid to mid-2027; T-11, T-12 run out on 30.11.2026.
  for (let n = 1; n <= 12; n++) {
    const code = `T-${String(n).padStart(2, "0")}`;
    loggerIds[code] = (
      await createInstrument(
        db,
        manager,
        { type: "portable_logger", code, serialNo: `6236${3000 + n}`, modelId, homeSiteId: bhwId },
        req,
      )
    ).id;
  }
  const certify = (number: string, ids: string[], validUntil: string) =>
    createExternalCertificate(
      db,
      manager,
      {
        number,
        ulrNo: "",
        labName: "QA Tech Lab",
        calibratedOn: "2026-06-01",
        validUntil,
        instrumentIds: ids,
      },
      req,
    );
  await certify(
    "QATECH/BHIWANDI/06/26/PDL-01",
    Array.from({ length: 10 }, (_, i) => loggerIds[`T-${String(i + 1).padStart(2, "0")}`]!),
    "2027-06-30",
  );
  await certify(
    "QATECH/BHIWANDI/06/26/PDL-02",
    [loggerIds["T-11"]!, loggerIds["T-12"]!],
    "2026-11-30",
  );
});

afterAll(close);

const state = async (id: string) => (await getJob(db, manager, id))!;

describe("phase 4 exit test: a Watson job with 2 freezers", () => {
  it("ticks the due freezer in the wizard", async () => {
    const list = await siteEquipment(db, leader, seawoodsId);
    const wf = list.find((e) => e.code === "BE-WF-02")!;
    // Due soon until 9 Nov 2026, overdue after: the test doesn't depend on the day it runs.
    expect(wf).toMatchObject({
      nextDue: "2026-11-09",
      due: dueStatus("2026-11-09", todayInIndia()),
      onJob: null,
    });
    expect(list.find((e) => e.code === "BE-WF-03")!.due).toBe("none");
  });

  it("creates the job with studies, reserved report numbers and a team", async () => {
    await expect(
      createJob(
        db,
        accounts,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2026-11-02",
          plannedEnd: "2026-11-05",
          items: [{ equipmentId: wf02 }],
        },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createJob(
        db,
        leader,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2026-11-02",
          plannedEnd: "2026-11-05",
          items: [{ equipmentId: wf02 }, { equipmentId: elsewhere }],
        },
        req,
      ),
    ).rejects.toThrow("TL-WF-01 is at another site of this client");
    await expect(
      createJob(
        db,
        leader,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2026-11-05",
          plannedEnd: "2026-11-02",
          items: [{ equipmentId: wf02 }],
        },
        req,
      ),
    ).rejects.toThrow("The end date is before the start.");
    await expect(
      createJob(
        db,
        leader,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2026-11-02",
          plannedEnd: "2026-11-05",
          items: [{ equipmentId: wf02 }, { equipmentId: wf02 }],
        },
        req,
      ),
    ).rejects.toThrow("BE-WF-02 is already on this job.");

    const created = await createJob(
      db,
      leader,
      {
        companyId: watsonId,
        clientSiteId: seawoodsId,
        siteId: "",
        title: "Annual freezer mapping",
        poNumber: "",
        poValue: "",
        plannedStart: "2026-11-02",
        plannedEnd: "2026-11-05",
        team: [
          { userId: leader.id, role: "team_leader" },
          { userId: engineer.id, role: "field_engineer" },
        ],
        items: [{ equipmentId: wf02 }, { equipmentId: wf03 }],
      },
      req,
    );
    jobId = created.id;
    jobNumber = created.number;
    expect(jobNumber).toMatch(/^QT\/\d{2}\/2026\/\d{4}$/);

    const job = await state(jobId);
    expect(job.status).toBe("created");
    // The only QA Tech site is picked by itself.
    expect(job.qaSite?.code).toBe("BHW");
    expect(
      job.studies.map((s) => [s.equipment.code, s.reportNumber, s.loggerCount, s.price]),
    ).toEqual([
      ["BE-WF-02", "Watson/Seawoods/11/26/Cold Storage (Walk In Freezer)/BE-WF-02", 9, null],
      ["BE-WF-03", "Watson/Seawoods/11/26/Cold Storage (Walk In Freezer)/BE-WF-03", 9, null],
    ]);
    // No rate card: the job is worth its PO, and there is none yet.
    expect(job.value).toEqual({ expected: null, source: "none" });
    expect(job.team.map((t) => t.name).sort()).toEqual(["Rahul TL", "Suresh FE"]);
    const pending = job.readiness.items.filter((i) => i.state === "pending").map((i) => i.key);
    expect(pending).toEqual([
      "purchase_order",
      "site_access",
      "loggers_booked",
      "loggers_valid",
      "previous_report",
    ]);
    // On the due list the freezer now shows its job.
    expect(
      (await siteEquipment(db, leader, seawoodsId)).find((e) => e.code === "BE-WF-02")!.onJob
        ?.number,
    ).toBe(jobNumber);
  });

  it("is found by its PO, report number or equipment, and only in its organisation", async () => {
    await updateJob(
      db,
      leader,
      jobId,
      {
        siteId: bhwId,
        title: "Annual freezer mapping",
        poNumber: "4500098765",
        poDate: "2026-10-20",
        poValue: "₹ 30,000",
        quotedValue: "",
        plannedStart: "2026-11-02",
        plannedEnd: "2026-11-05",
        notes: "",
      },
      req,
    );
    for (const q of ["98765", "be-wf-03", "11/26/cold storage", "watson", jobNumber]) {
      expect(
        (await listJobs(db, engineer, { q })).map((j) => j.id),
        q,
      ).toEqual([jobId]);
    }
    expect(await listJobs(db, engineer, { q: "%" })).toEqual([]);
    expect(await listJobs(db, outsider, {})).toEqual([]);
    // Newest job first by default; by planned start when asked (QA Tech, Nov 2026).
    const all = await listJobs(db, manager, { scope: "all" });
    expect(all[0]!.id).toBe(jobId);
    const byStart = await listJobs(db, manager, { scope: "all", sort: "start" });
    const starts = byStart.map((j) => j.plannedStart);
    expect(starts).toEqual([...starts].sort());
    expect(await getJob(db, outsider, jobId)).toBeNull();
    await expect(
      createJob(
        db,
        outsider,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2026-11-02",
          plannedEnd: "2026-11-05",
          items: [{ equipmentId: wf02 }],
        },
        req,
      ),
    ).rejects.toThrow("That client does not exist.");
  });

  it("shows money to managers and accounts, not to field engineers", async () => {
    const forEngineer = (await getJob(db, engineer, jobId))!;
    expect(forEngineer.job.poValue).toBeNull();
    expect(forEngineer.value).toBeNull();
    expect((await listJobs(db, engineer, { q: "98765" }))[0]!.poValue).toBeNull();
    const forAccounts = (await getJob(db, accounts, jobId))!;
    expect(forAccounts.value).toMatchObject({ expected: 30000, source: "po" });
    expect(forAccounts.canManage).toBe(false);
  });

  it("books loggers in one click, skipping ones that would run out", async () => {
    // Five loggers per freezer: 10 + 1 spare.
    for (const s of (await state(jobId)).studies) {
      await updateStudy(
        db,
        leader,
        s.id,
        {
          workType: "temperature_mapping",
          loggerCount: "5",
          cycles: ["empty"],
          season: "",
          durationHours: "24",
          intervalMinutes: "10",
        },
        req,
      );
    }
    const booked = await autoBook(db, leader, jobId, req, { loggers: true });
    expect(booked.booked).toEqual([
      "T-01",
      "T-02",
      "T-03",
      "T-04",
      "T-05",
      "T-06",
      "T-07",
      "T-08",
      "T-09",
      "T-10",
      "T-11",
    ]);
    expect(booked.short).toEqual([]);
    // Run again: nothing more is needed.
    expect((await autoBook(db, leader, jobId, req, { loggers: true })).booked).toEqual([]);

    // The protocol is no longer on the list (QA Tech, Nov 2026).
    await expect(
      setReadiness(db, leader, jobId, { key: "protocol", state: "ready", note: "" }, req),
    ).rejects.toThrow();
    await setReadiness(db, leader, jobId, { key: "site_access", state: "ready", note: "" }, req);
    expect((await state(jobId)).status).toBe("created");
    await setReadiness(
      db,
      leader,
      jobId,
      { key: "previous_report", state: "ready", note: "11/25 report on file" },
      req,
    );
    const ready = await state(jobId);
    expect(ready.readiness.ready).toBe(true);
    expect(ready.status).toBe("ready");
    expect(ready.history.map((h) => h.toStatus)).toEqual(["created", "ready"]);
  });

  it("can't move to Field Work while a logger is out of date", async () => {
    // The client moves the visit to December: T-11 is valid only until 30.11.2026.
    await updateJob(
      db,
      leader,
      jobId,
      {
        siteId: bhwId,
        title: "Annual freezer mapping",
        poNumber: "4500098765",
        poDate: "2026-10-20",
        poValue: "30000",
        quotedValue: "",
        plannedStart: "2026-12-01",
        plannedEnd: "2026-12-04",
        notes: "Client postponed",
      },
      req,
    );
    const job = await state(jobId);
    expect(job.status).toBe("created");
    expect(job.booked.find((b) => b.code === "T-11")!.problem).toBe(
      "T-11 is valid only until 30.11.2026",
    );
    expect(job.history.at(-1)?.reason).toBe("Pending: Loggers calibrated through the study");
    await expect(changeStatus(db, leader, jobId, "start_field_work", "", req)).rejects.toThrow(
      "Start field work isn't possible while the job is Created.",
    );

    // Swapping in T-12 is refused for the same reason; a freshly calibrated logger is accepted.
    await releaseInstruments(db, leader, jobId, [loggerIds["T-11"]!], req);
    const swap = await bookByCodes(db, leader, jobId, "T-12\nNOPE-1", req);
    expect(swap).toEqual({
      booked: [],
      notFound: ["NOPE-1"],
      refused: [{ code: "T-12", reason: "is valid only until 30.11.2026" }],
    });
    const t13 = await createInstrument(
      db,
      manager,
      {
        type: "portable_logger",
        code: "T-13",
        serialNo: "62363013",
        make: "ebro",
        model: "EBI 20-T1",
        homeSiteId: bhwId,
      },
      req,
    );
    await createExternalCertificate(
      db,
      manager,
      {
        number: "QATECH/BHIWANDI/10/26/PDL-09",
        ulrNo: "",
        labName: "QA Tech Lab",
        calibratedOn: "2026-10-15",
        validUntil: "2027-10-14",
        instrumentIds: [t13.id],
      },
      req,
    );
    // Booked by its serial number, as it's printed on the logger.
    expect((await bookByCodes(db, leader, jobId, "62363013", req)).booked).toEqual(["T-13"]);
    expect((await state(jobId)).status).toBe("ready");

    await expect(
      changeStatus(db, engineer, jobId, "start_field_work", "", req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await changeStatus(db, leader, jobId, "start_field_work", "", req)).toBe("field_work");
    // Studies are fixed once field work starts.
    const first = (await state(jobId)).studies[0]!;
    await expect(removeStudy(db, leader, first.id, req)).rejects.toThrow(
      "before field work starts",
    );
  });
});

describe("clashes, holds and repeat visits", () => {
  let second: string;

  it("warns when people or loggers are already on an overlapping job", async () => {
    second = (
      await createJob(
        db,
        leader,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2026-12-03",
          plannedEnd: "2026-12-06",
          team: [{ userId: engineer.id, role: "field_engineer" }],
          items: [{ equipmentId: cr01, loggerCount: "3" }],
        },
        req,
      )
    ).id;
    const job = await state(second);
    expect(job.teamClashes).toEqual([
      { userId: engineer.id, name: "Suresh FE", jobs: [{ id: jobId, number: jobNumber }] },
    ]);
    const booked = await autoBook(db, leader, second, req, { loggers: true });
    // Every valid logger is on the first job; T-11 and T-12 run out.
    expect(booked.booked).toEqual([]);
    expect(booked.short).toEqual([{ type: "portable_logger", count: 3 }]);
    expect(booked.skipped).toEqual([
      { reason: "on another job on these dates", count: 11 },
      { reason: "not calibrated through these dates", count: 2 },
    ]);
    expect((await bookByCodes(db, leader, second, "T-01", req)).refused).toEqual([
      { code: "T-01", reason: `booked on ${jobNumber}` },
    ]);
  });

  it("holds with a reason, resumes where it was, and frees loggers when cancelled", async () => {
    await expect(changeStatus(db, leader, second, "hold", " ", req)).rejects.toThrow("Say why");
    expect(await changeStatus(db, leader, second, "hold", "Client shutdown", req)).toBe("on_hold");
    await expect(changeStatus(db, leader, second, "start_field_work", "", req)).rejects.toThrow(
      "isn't possible",
    );
    expect(await changeStatus(db, leader, second, "resume", "", req)).toBe("created");

    // A cancelled job no longer holds its loggers.
    await changeStatus(db, leader, jobId, "cancel", "Test of release", req);
    expect((await autoBook(db, leader, second, req, { loggers: true })).booked).toEqual([
      "T-01",
      "T-02",
      "T-03",
      "T-04",
    ]);
    await expect(changeStatus(db, leader, jobId, "resume", "", req)).rejects.toThrow(
      "isn't possible",
    );
    await expect(addStudies(db, leader, jobId, [wf02], req)).rejects.toThrow("Cancelled");
    const hist = await db
      .select({ to: jobStatusHistory.toStatus, reason: jobStatusHistory.reason })
      .from(jobStatusHistory)
      .where(eq(jobStatusHistory.jobId, second));
    expect(hist.map((h) => h.to)).toEqual(["created", "on_hold", "created"]);
  });

  it("gives a repeat study in the same month a suffixed report number", async () => {
    const repeat = await createJob(
      db,
      leader,
      {
        companyId: watsonId,
        clientSiteId: seawoodsId,
        plannedStart: "2026-11-20",
        plannedEnd: "2026-11-21",
        items: [{ equipmentId: wf02 }],
      },
      req,
    );
    expect((await state(repeat.id)).studies[0]!.reportNumber).toBe(
      "Watson/Seawoods/11/26/Cold Storage (Walk In Freezer)/BE-WF-02-2",
    );
    // A job keeps at least one study.
    await expect(
      removeStudy(db, leader, (await state(repeat.id)).studies[0]!.id, req),
    ).rejects.toThrow("at least one study");
    await setTeam(db, leader, repeat.id, [{ userId: leader.id, role: "team_leader" }], req);
    await expect(
      setTeam(db, leader, repeat.id, [{ userId: outsider.id, role: "field_engineer" }], req),
    ).rejects.toThrow("A team member does not exist.");
  });

  it("never books one logger twice when two people book at the same moment", async () => {
    const make = () =>
      createJob(
        db,
        leader,
        {
          companyId: watsonId,
          clientSiteId: seawoodsId,
          plannedStart: "2027-02-01",
          plannedEnd: "2027-02-02",
          items: [{ equipmentId: cr01, loggerCount: "6" }],
        },
        req,
      );
    const [a, b] = [await make(), await make()];
    const [ra, rb] = await Promise.all([
      autoBook(db, leader, a.id, req, { loggers: true }),
      autoBook(db, manager, b.id, req, { loggers: true }),
    ]);
    const both = [...ra.booked, ...rb.booked];
    expect(new Set(both).size).toBe(both.length);
    // 13 loggers, 7 wanted each (6 + 1 spare), T-11 and T-12 expired by then: 11 to share.
    expect(both).toHaveLength(11);
  });

  it("books a warehouse-sized kit and keeps the audit summary short", async () => {
    const added = await bulkAddInstruments(
      db,
      manager,
      {
        modelId: loggerModelId,
        homeSiteId: bhwId,
        codePrefix: "W-",
        serials: Array.from({ length: 60 }, (_, i) => `9100${String(i).padStart(3, "0")}`).join(
          "\n",
        ),
      },
      req,
    );
    await createExternalCertificate(
      db,
      manager,
      {
        number: "QATECH/BHIWANDI/10/26/PDL-20",
        ulrNo: "",
        labName: "QA Tech Lab",
        calibratedOn: "2026-10-01",
        validUntil: "2027-09-30",
        instrumentIds: added.map((a) => a.id),
      },
      req,
    );
    const big = await createJob(
      db,
      leader,
      {
        companyId: watsonId,
        clientSiteId: seawoodsId,
        plannedStart: "2027-03-01",
        plannedEnd: "2027-03-04",
        items: [{ equipmentId: cr01, loggerCount: "54" }],
      },
      req,
    );
    const booked = await autoBook(db, leader, big.id, req, { loggers: true });
    expect(booked.booked).toHaveLength(60);
    expect(booked.short).toEqual([]);
    const [entry] = await db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, big.id), eq(auditLog.action, "job.instruments_booked")));
    expect(entry!.summary).toMatch(/ and 52 more for job /);
  });

  it("books an SSPRT for °C and the RH indicator for %RH, not the RH indicator for both", async () => {
    const master = async (code: string, type: "humidity_indicator" | "reference_thermometer") => {
      const m = await createInstrument(
        db,
        manager,
        { type, tier: "master", code, serialNo: `${code}-SN`, homeSiteId: bhwId },
        req,
      );
      await createExternalCertificate(
        db,
        manager,
        {
          number: `CERT-${code}`,
          ulrNo: "",
          labName: "Outside lab",
          calibratedOn: "2026-04-06",
          validUntil: "2027-04-05",
          instrumentIds: [m.id],
        },
        req,
      );
    };
    // The RH indicator is registered first, so it would win on order alone.
    await master("TL-38", "humidity_indicator");
    await master("TL-65", "reference_thermometer");
    const rh = await createJob(
      db,
      leader,
      {
        companyId: watsonId,
        clientSiteId: seawoodsId,
        plannedStart: "2027-01-11",
        plannedEnd: "2027-01-14",
        items: [{ equipmentId: wf03, loggerCount: "2" }],
      },
      req,
    );
    const { studies: studiesTable } = await import("@/db/schema");
    await db
      .update(studiesTable)
      .set({ workType: "temperature_rh_mapping", postCalRequired: true })
      .where(eq(studiesTable.jobId, rh.id));
    const booked = await autoBook(db, leader, rh.id, req, { loggers: true });
    expect(booked.masters).toEqual(["TL-65", "TL-38"]);
    expect(booked.short).toEqual([]);
  });

  it("has pre- and post-calibration only when chosen; thermal validation always", async () => {
    const j = await createJob(
      db,
      leader,
      {
        companyId: watsonId,
        clientSiteId: seawoodsId,
        plannedStart: "2027-09-01",
        plannedEnd: "2027-09-03",
        items: [{ equipmentId: wf03, preCal: false, postCal: true }],
      },
      req,
    );
    const study = (await state(j.id)).studies[0]!;
    expect([study.preCalRequired, study.postCalRequired]).toEqual([false, true]);
    // Post-cal alone still needs a master; the study shows the Post-cal tab, not Pre-cal.
    expect((await state(j.id)).readiness.items.find((i) => i.key === "masters_valid")!.state).toBe(
      "pending",
    );
    const field = (await getFieldStudy(db, leader, study.id))!;
    expect([field.precalNeeded, field.postcalNeeded]).toEqual([false, true]);

    const edit = {
      loggerCount: "4",
      cycles: ["empty"],
      season: "",
      durationHours: "24",
      intervalMinutes: "10",
    };
    await updateStudy(db, leader, study.id, { ...edit, workType: "temperature_mapping" }, req);
    const none = (await state(j.id)).studies[0]!;
    expect([none.preCalRequired, none.postCalRequired]).toEqual([false, false]);
    expect((await state(j.id)).readiness.items.find((i) => i.key === "masters_valid")!.state).toBe(
      "na",
    );
    await updateStudy(db, leader, study.id, { ...edit, workType: "thermal_validation" }, req);
    const thermal = (await state(j.id)).studies[0]!;
    expect([thermal.preCalRequired, thermal.postCalRequired]).toEqual([true, true]);
  });

  it("finds the last report signed in QTech for a requalification", async () => {
    const { studies: studiesTable } = await import("@/db/schema");
    const [signed] = await db
      .update(studiesTable)
      .set({ archivedAt: new Date("2026-11-20T10:00:00+05:30") })
      .where(and(eq(studiesTable.jobId, jobId), eq(studiesTable.equipmentId, wf02)))
      .returning({ reportNumber: studiesTable.reportNumber });
    const again = await createJob(
      db,
      leader,
      {
        companyId: watsonId,
        clientSiteId: seawoodsId,
        plannedStart: "2027-11-01",
        plannedEnd: "2027-11-03",
        items: [{ equipmentId: wf02 }],
      },
      req,
    );
    const item = (await state(again.id)).readiness.items.find((i) => i.key === "previous_report")!;
    expect(item).toMatchObject({
      state: "ready",
      calculated: true,
      detail: `In QTech: BE-WF-02 ${signed!.reportNumber}.`,
    });
  });

  it("audits every change", async () => {
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.organisationId, orgId), eq(auditLog.entityId, jobId)));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "job.created",
      "job.updated",
      "job.status_changed",
      "job.readiness_updated",
      "job.instruments_booked",
      "job.instruments_released",
    ]) {
      expect(actions.has(a as never), a).toBe(true);
    }
  });
});
