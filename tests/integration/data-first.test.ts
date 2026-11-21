/**
 * The data comes first (QA Tech, Nov 2026): nobody tapped Start on site. The
 * team leader uploads the loggers' export, then chooses from it the period the
 * report covers ("12-11-2026 12:00 AM for 24 h"), and confirms the data.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jobs, sites, studies, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { addDataFile, markReceived, setStudyPeriod } from "@/domain/data/data-service";
import { getStudyData } from "@/domain/data/queries";
import { layoutTemplate, placeLogger, saveLayout } from "@/domain/field/field-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments, saveModel } from "@/domain/instruments/instrument-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.91" };
const MIN = 60_000;
let blobs: BlobStore;
let leader: SessionUser;
let jobId: string;
let studyId: string;
let serials: string[] = [];
/** The data runs from midnight two days ago (India) for 36 h. */
let dataStart: number;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ organisationId, email, name, role, status: "active", passwordHash: "x" })
    .returning();
  return toSessionUser(row!)!;
}

/** India wall-clock text "2026-11-12T00:00" for an instant, as the form sends it. */
const istText = (ms: number) => new Date(ms + 330 * MIN).toISOString().slice(0, 16);

async function export_() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Date", "Time", ...serials.map(Number)]);
  ws.addRow([null, null, ...serials.map(() => "°C")]);
  for (let t = dataStart, k = 0; t <= dataStart + 36 * 60 * MIN; t += 10 * MIN, k += 1) {
    const d = new Date(t + 330 * MIN);
    ws.addRow([
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
      new Date(Date.UTC(1899, 11, 30, d.getUTCHours(), d.getUTCMinutes())),
      ...serials.map((_, i) => 4 + i * 0.2 + (k % 3) * 0.1),
    ]);
  }
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const stored = await storeFile(db, blobs, {
    organisationId: leader.organisationId,
    actor: { type: "user", userId: leader.id },
    fileName: "PR-04 raw data.xlsx",
    bytes,
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  return stored.file.id;
}

const jobStatus = async () =>
  (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, jobId)))[0]!.s;

beforeAll(async () => {
  blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-data-first-")));
  const org = (await ensureOrganisation(db, { slug: "data-first-org", name: "QA Tech DF" }))
    .organisation;
  const manager = await makeUser(org.id, "mgr@df.test", "manager", "Meera Manager");
  leader = await makeUser(org.id, "tl@df.test", "team_leader", "Ashraf Lead");
  const engineer = await makeUser(org.id, "fe@df.test", "field_engineer", "Vikas Engineer");
  const [bhw] = await db
    .insert(sites)
    .values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" })
    .returning();
  const companyId = (
    await createCompany(
      db,
      manager,
      {
        name: "Fridge Pharma Pvt Limited",
        code: "Fridge",
        gstin: "",
        address: "",
        notes: "",
        postCalRequired: false,
        requalificationMonths: 12,
        reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}",
        firstSite: { name: "Taloja", code: "Taloja", address: "", city: "", state: "", gstin: "" },
      },
      req,
    )
  ).id;
  const siteId = (await getCompany(db, manager, companyId))!.sites[0]!.id;
  const equipmentId = (
    await createEquipment(
      db,
      manager,
      companyId,
      {
        siteId,
        code: "PR-04",
        name: "Pharmaceutical Refrigerator",
        type: "refrigerator",
        departmentId: null,
        location: "",
        make: "",
        model: "",
        serialNo: "",
        lengthM: "0.6",
        widthM: "0.6",
        heightM: "1.8",
        setPointC: "",
        tempMinC: "",
        tempMaxC: "",
        rhMinPct: "",
        rhMaxPct: "",
        defaultChannels: "5",
        readingIntervalMinutes: "10",
        studyDurationHours: "24",
        requalificationMonths: "",
        lastStudyOn: "",
        notes: "",
        cycles: [],
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
        defaultPoints: [{ quantity: "temperature", reference: "5", condition: "" }],
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
      codePrefix: "E-DF",
      serials: Array.from({ length: 6 }, (_, i) => `7228${1300 + i}`).join("\n"),
    },
    req,
  );
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/11/26/DF-01",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(new Date(now.getTime() - 60 * 86_400_000)),
      validUntil: iso(new Date(now.getTime() + 300 * 86_400_000)),
      instrumentIds: added.map((a) => a.id),
    },
    req,
  );
  const job = await createJob(
    db,
    leader,
    {
      companyId,
      clientSiteId: siteId,
      siteId: bhw!.id,
      poNumber: "4500033333",
      plannedStart: iso(new Date(now.getTime() - 3 * 86_400_000)),
      plannedEnd: iso(now),
      team: [
        { userId: leader.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
      ],
      items: [{ equipmentId }],
    },
    req,
  );
  jobId = job.id;
  studyId = (await getJob(db, leader, jobId))!.studies[0]!.id;
  for (const key of ["site_access", "previous_report"]) {
    await setReadiness(db, leader, jobId, { key, state: "ready", note: "" }, req);
  }
  await autoBook(db, leader, jobId, req, { loggers: true });
  await saveLayout(db, engineer, studyId, await layoutTemplate(db, engineer, studyId), req);
  const placed = (await getStudyData(db, leader, studyId))!.positions.length;
  serials = added.slice(0, placed).map((a) => a.serialNo);
  for (const s of serials) await placeLogger(db, engineer, studyId, { code: s }, req);
  // Midnight in India, two days ago.
  const todayIst = new Date(now.getTime() + 330 * MIN).toISOString().slice(0, 10);
  dataStart = Date.parse(`${todayIst}T00:00:00+05:30`) - 2 * 86_400_000;
});

afterAll(close);

describe("the data first, then the report's period chosen from it", () => {
  it("takes the data on a Ready job with no site taps, and puts the job in field work", async () => {
    expect(await jobStatus()).toBe("ready");
    const [row] = await db
      .select({ status: studies.status })
      .from(studies)
      .where(eq(studies.id, studyId));
    expect(row!.status).toBe("planned");
    const r = await addDataFile(db, blobs, leader, studyId, { fileId: await export_() }, req);
    expect(r).toMatchObject({ matched: serials.length, blockers: 0 });
    expect(await jobStatus()).toBe("field_work");
    // Not confirmable before the period is chosen.
    await expect(markReceived(db, leader, studyId, req)).rejects.toThrow(
      "Set the start and end of the PR-04 study (Start & end) before confirming its data.",
    );
  });

  it("sets 24 h from midnight inside the data, without a reason, and confirms", async () => {
    const from = dataStart;
    const to = dataStart + 24 * 60 * MIN;
    await setStudyPeriod(
      db,
      leader,
      studyId,
      { cycle: "routine", start: istText(from), end: istText(to), reason: "" },
      req,
    );
    const d = (await getStudyData(db, leader, studyId))!;
    const p = d.periods.find((x) => x.cycle === "routine")!;
    expect([p.start!.getTime(), p.end!.getTime()]).toEqual([from, to]);
    expect(d.windows[0]).toMatchObject({ start: from, end: to });
    expect(d.study.status).toBe("completed");
    expect(d.study.dataStatus).toBe("checked");
    await markReceived(db, leader, studyId, req);
    expect((await getStudyData(db, leader, studyId))!.study.dataStatus).toBe("received");
  });

  it("changes the period later with a reason, to any day in the data", async () => {
    const from = dataStart + 12 * 60 * MIN;
    const to = from + 24 * 60 * MIN;
    const input = { cycle: "routine", start: istText(from), end: istText(to), reason: "" };
    await expect(setStudyPeriod(db, leader, studyId, input, req)).rejects.toThrow(
      "Say why the times change",
    );
    await setStudyPeriod(db, leader, studyId, { ...input, reason: "report from noon" }, req);
    const p = (await getStudyData(db, leader, studyId))!.periods[0]!;
    expect([p.start!.getTime(), p.end!.getTime()]).toEqual([from, to]);
  });
});
