/**
 * Phase 7: the report preparer analyses BE-WF-02's confirmed data, a logger
 * fails post-calibration, a deviation opens by itself, the client's QA head
 * decides, and the team leader approves.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, jobs, sites, studies, studyAnalysisRuns, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import {
  approveAnalysis,
  assessDeviation,
  decideDeviation,
  recalculateImpact,
  reviewExcursion,
  runAnalysis,
  withdrawApproval,
  withdrawExcursionReview,
} from "@/domain/analysis/analysis-service";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import { hashPassword } from "@/domain/auth/password";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { addDataFile, markReceived } from "@/domain/data/data-service";
import {
  layoutTemplate,
  placeLogger,
  recordEvent,
  recordPrecal,
  saveLayout,
} from "@/domain/field/field-service";
import { decideOverride, overridesOf, requestOverride } from "@/domain/field/override-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import {
  bulkAddInstruments,
  createInstrument,
  saveModel,
} from "@/domain/instruments/instrument-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.91" };
const MIN = 60_000;
let blobs: BlobStore;
let manager: SessionUser;
let leader: SessionUser;
let engineer: SessionUser;
let preparer: SessionUser;
let lab: SessionUser;
let accounts: SessionUser;
let outsider: SessionUser;
let jobId: string;
let studyId: string;
let serials: string[] = [];
let codes: string[] = [];
let masterId: string;
let start: Date;
let end: Date;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ organisationId, email, name, role, status: "active", passwordHash: "x" })
    .returning();
  return toSessionUser(row!)!;
}

function ist(ms: number) {
  const d = new Date(ms + 330 * MIN);
  return {
    date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    time: new Date(Date.UTC(1899, 11, 30, d.getUTCHours(), d.getUTCMinutes())),
  };
}

/**
 * Readings every 10 min across the study. L-05 (5th logger) runs warmest;
 * it goes above −15 °C for three readings (30 min) in the middle.
 */
async function export_() {
  const wb = new ExcelJS.Workbook();
  wb.creator = randomUUID();
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Equipment ID.", null, "BE-WF-02"]);
  ws.addRow(["Date", "Time", ...serials.map(Number)]);
  ws.addRow([null, null, ...serials.map(() => "°C")]);
  let k = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 10 * MIN, k += 1) {
    const { date, time } = ist(t);
    ws.addRow([
      date,
      time,
      ...serials.map((_, i) => {
        if (i === 4) return k >= 70 && k < 73 ? -14.2 : Math.round((-17 + (k % 4) * 0.2) * 10) / 10;
        return Math.round((-22 + i * 0.1 + (k % 5) * 0.1) * 10) / 10;
      }),
    ]);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const jobStatus = async () =>
  (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, jobId)))[0]!.s;
const view = async (who: SessionUser = leader) => (await getStudyAnalysis(db, who, studyId))!;
const postCal = (code: string, reference: string, reading: string, who = engineer) =>
  recordPrecal(
    db,
    who,
    studyId,
    { id: randomUUID(), code, masterId, phase: "post", reference, reading },
    req,
  );

beforeAll(async () => {
  blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-analysis-")));
  const org = (await ensureOrganisation(db, { slug: "analysis-org", name: "QA Tech Analysis" }))
    .organisation;
  manager = await makeUser(org.id, "mgr@an.test", "manager", "Meera Manager");
  leader = await makeUser(org.id, "tl@an.test", "team_leader", "Ashraf Lead");
  engineer = await makeUser(org.id, "fe@an.test", "field_engineer", "Vikas Engineer");
  preparer = await makeUser(org.id, "rp@an.test", "report_preparer", "Mansi Preparer");
  lab = await makeUser(org.id, "lab@an.test", "lab", "Lab Tech");
  accounts = await makeUser(org.id, "acc@an.test", "accounts", "Accounts");
  const other = (await ensureOrganisation(db, { slug: "analysis-other", name: "Other" }))
    .organisation;
  outsider = await makeUser(other.id, "admin@an-other.test", "admin", "Other Admin");
  const [bhw] = await db
    .insert(sites)
    .values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" })
    .returning();
  const companyId = (
    await createCompany(
      db,
      manager,
      {
        name: "Watson Pharma Pvt Limited",
        code: "Watson",
        gstin: "",
        address: "",
        notes: "",
        postCalRequired: true,
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
  const siteId = (await getCompany(db, manager, companyId))!.sites[0]!.id;
  const equipmentId = (
    await createEquipment(
      db,
      manager,
      companyId,
      {
        siteId,
        code: "BE-WF-02",
        name: "Cold Storage (Walk In Freezer)",
        type: "walk_in_freezer",
        departmentId: null,
        location: "",
        make: "",
        model: "",
        serialNo: "",
        lengthM: "3.36",
        widthM: "6.4",
        heightM: "2.4",
        setPointC: "-20",
        tempMinC: "-25",
        tempMaxC: "-15",
        rhMinPct: "",
        rhMaxPct: "",
        defaultChannels: "9",
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
      codePrefix: "A-TRH",
      serials: Array.from({ length: 9 }, (_, i) => `6229${1300 + i}`).join("\n"),
    },
    req,
  );
  serials = added.map((a) => a.serialNo);
  codes = added.map((a) => a.code);
  masterId = (
    await createInstrument(
      db,
      manager,
      {
        tier: "master",
        type: "rtd",
        modelId: null,
        code: "M-RTD-01",
        serialNo: "RTD9001",
        homeSiteId: bhw!.id,
      },
      req,
    )
  ).id;
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/09/26/PDL-41",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(new Date(now.getTime() - 60 * 86_400_000)),
      validUntil: iso(new Date(now.getTime() + 300 * 86_400_000)),
      instrumentIds: [...added.map((a) => a.id), masterId],
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
      plannedStart: iso(new Date(now.getTime() - 2 * 86_400_000)),
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
  for (const s of serials) await placeLogger(db, engineer, studyId, { code: s }, req);
  end = new Date(Math.floor((now.getTime() - 2 * 3600_000) / (10 * MIN)) * 10 * MIN);
  start = new Date(end.getTime() - 24 * 3600_000);
  for (const [kind, at] of [
    ["start", start],
    ["end", end],
  ] as const) {
    await recordEvent(db, engineer, studyId, { id: randomUUID(), cycle: "routine", kind, at }, req);
  }
  const stored = await storeFile(db, blobs, {
    organisationId: leader.organisationId,
    actor: { type: "user", userId: leader.id },
    fileName: "BE-WF-02 raw data.xlsx",
    bytes: await export_(),
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  await addDataFile(db, blobs, leader, studyId, { fileId: stored.file.id }, req);
});

afterAll(close);

describe("phase 7: analysis, post-calibration and deviations", () => {
  let runId: string;
  let fingerprint: string;
  let deviationId: string;

  it("refuses to analyse before the data is confirmed, and people without the right", async () => {
    await expect(runAnalysis(db, preparer, studyId, req)).rejects.toThrow(
      /isn't possible while job .* is field work/,
    );
    await markReceived(db, leader, studyId, req);
    expect(await jobStatus()).toBe("data_received");
    await expect(runAnalysis(db, accounts, studyId, req)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAnalysis(db, engineer, studyId, req)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runAnalysis(db, outsider, studyId, req)).rejects.toThrow(
      "That study does not exist.",
    );
    expect(await getStudyAnalysis(db, outsider, studyId)).toBeNull();
  });

  it("runs once, finds L-05 hot with one 30-minute excursion, and moves the job to Analysis", async () => {
    // Two people pressing Run at the same moment: one run is made.
    const [a, b] = await Promise.all([
      runAnalysis(db, preparer, studyId, req),
      runAnalysis(db, leader, studyId, req),
    ]);
    expect([a.fresh, b.fresh].sort()).toEqual([false, true]);
    expect(a.runNo).toBe(1);
    expect(b.runNo).toBe(1);
    runId = a.runId;
    expect(await jobStatus()).toBe("analysis");

    const v = await view();
    const c = v.run!.result.cycles[0]!;
    expect(c.hot!.label).toBe("L-05");
    expect(c.cold!.label).toBe("L-01");
    expect(c.pass).toBe(false);
    expect(v.excursions).toHaveLength(1);
    expect(v.excursions[0]).toMatchObject({
      label: "L-05",
      side: "high",
      limit: -15,
      peak: -14.2,
      readings: 3,
      minutes: 30,
      review: null,
    });
    fingerprint = v.excursions[0]!.fingerprint;
    expect(v.run!.inputs.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.run!.engineVersion).toBe("7.0.0");
    expect(v.stale).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/1 excursion not reviewed/);
    expect(v.blockers.join(" ")).toMatch(/Post-calibration missing for 9 loggers/);
  });

  it("never changes a stored run", async () => {
    const error = await db
      .update(studyAnalysisRuns)
      .set({ engineVersion: "0" })
      .where(eq(studyAnalysisRuns.id, runId))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(String((error as { cause?: unknown })?.cause)).toMatch(/append-only: UPDATE/);
  });

  it("opens a numbered deviation when a logger fails post-calibration, with its impact", async () => {
    for (const code of codes.filter((_, i) => i !== 3)) {
      const r = await postCal(code, "-25.00", "-24.80");
      expect(r).toMatchObject({ result: "pass", deviationNumber: null });
    }
    // The lab does the last one when the loggers are back: L-04 reads 0.8 high.
    const id = randomUUID();
    const input = {
      id,
      code: codes[3]!,
      masterId,
      phase: "post",
      reference: "-25.00",
      reading: "-24.20",
    };
    const r = await recordPrecal(db, lab, studyId, input, req);
    const year = new Date().getFullYear();
    expect(r).toMatchObject({
      result: "fail",
      deviation: "0.80",
      deviationNumber: `QT/DEV/${year}/0001`,
    });
    // A resend after a dropped connection opens nothing new.
    expect(await recordPrecal(db, lab, studyId, input, req)).toMatchObject({
      deviationNumber: `QT/DEV/${year}/0001`,
    });
    await expect(postCal(codes[0]!, "-25", "-25", accounts)).rejects.toBeInstanceOf(ForbiddenError);

    const run = await recalculateImpact(db, preparer, (await view()).deviations[0]!.id, req);
    expect(run.runNo).toBe(2);
    const v = await view();
    expect(v.runs.map((x) => x.runNo)).toEqual([1]);
    const d = v.deviations[0]!;
    deviationId = d.id;
    expect(d).toMatchObject({ source: "post_cal", position: "L-04", decision: null });
    expect(d.title).toBe(`${codes[3]} (L-04) failed post-calibration: 0.80 °C against ±0.5`);
    expect(d.impact!.note).toMatch(/corrected by −0.8/);
    // L-04's corrected readings are 0.8 lower, still inside −25…−15.
    expect(d.impact!.cycles[0]!.position!.pass).toBe(true);
    expect(v.blockers.join(" ")).toMatch(/Deviation open: QT\/DEV\/\d{4}\/0001/);
    expect(v.blockers.join(" ")).not.toMatch(/Post-calibration missing/);
  });

  it("keeps an excursion's acceptance across runs, and lets it be withdrawn", async () => {
    await expect(
      reviewExcursion(
        db,
        preparer,
        studyId,
        { fingerprint, decision: "accepted", reason: "no" },
        req,
      ),
    ).rejects.toThrow("Say why the excursion is acceptable.");
    await reviewExcursion(
      db,
      preparer,
      studyId,
      { fingerprint, decision: "accepted", reason: "Loading of 40 cartons, recorded at 11:40" },
      req,
    );
    await expect(
      reviewExcursion(
        db,
        leader,
        studyId,
        { fingerprint, decision: "accepted", reason: "again ok" },
        req,
      ),
    ).rejects.toThrow("That excursion has already been reviewed.");
    await withdrawExcursionReview(db, leader, studyId, fingerprint, req);
    await reviewExcursion(
      db,
      leader,
      studyId,
      { fingerprint, decision: "accepted", reason: "Loading of 40 cartons, door log entry 11:40" },
      req,
    );
    expect((await view()).excursions[0]!.review).toMatchObject({
      decision: "accepted",
      by: "Ashraf Lead",
    });
  });

  it("needs QA Tech's assessment, then the client QA head's decision, to close the deviation", async () => {
    await expect(approveAnalysis(db, leader, studyId, runId, req)).rejects.toThrow(
      /Deviation open/,
    );
    const today = new Date().toISOString().slice(0, 10);
    const decision = {
      decision: "exclude_probe",
      decidedByName: "Dr. R. Shah",
      decidedByTitle: "Head QA, Watson Pharma",
      decidedOn: today,
    };
    await expect(decideDeviation(db, leader, deviationId, decision, req)).rejects.toThrow(
      "Write QA Tech's assessment before the decision.",
    );
    await expect(
      assessDeviation(db, preparer, deviationId, { assessment: "Logger drifted." }, req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await assessDeviation(
      db,
      leader,
      deviationId,
      {
        assessment:
          "L-04 read 0.8 °C high after the study. With the error applied it still passes, but the client prefers to leave it out.",
      },
      req,
    );
    await expect(
      decideDeviation(db, leader, deviationId, { ...decision, decidedOn: "2099-01-01" }, req),
    ).rejects.toThrow("The decision date is in the future.");
    await decideDeviation(db, leader, deviationId, decision, req);
    await expect(decideDeviation(db, manager, deviationId, decision, req)).rejects.toThrow(
      /was already closed \(Exclude probe, Dr. R. Shah\)/,
    );
    const v = await view();
    expect(v.deviations[0]).toMatchObject({
      decision: "exclude_probe",
      decidedByName: "Dr. R. Shah",
    });
    // Leaving L-04 out changes the inputs: the run is out of date.
    expect(v.stale).toBe(true);
    expect(v.blockers.join(" ")).toMatch(/changed after run 1/);
  });

  it("reruns without L-04, keeps the excursion review, and the team leader approves", async () => {
    const r = await runAnalysis(db, preparer, studyId, req);
    expect(r).toMatchObject({ fresh: true, runNo: 3 });
    const v = await view();
    const c = v.run!.result.cycles[0]!;
    expect(c.positions[3]).toMatchObject({ label: "L-04", pass: null });
    expect(c.positions[3]!.excluded).toMatch(/QT\/DEV\/\d{4}\/0001, decided by Dr. R. Shah/);
    expect(c.cold!.label).toBe("L-01");
    expect(v.excursions[0]!.review?.decision).toBe("accepted");
    expect(v.blockers).toEqual([]);
    await expect(approveAnalysis(db, preparer, studyId, r.runId, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(approveAnalysis(db, leader, studyId, runId, req)).rejects.toThrow(
      "A newer analysis was run. Check it before approving.",
    );
    await approveAnalysis(db, leader, studyId, r.runId, req);
    await expect(approveAnalysis(db, manager, studyId, r.runId, req)).rejects.toThrow(
      "BE-WF-02's analysis is already approved.",
    );
    expect((await view()).approval).toMatchObject({ runId: r.runId, by: "Ashraf Lead" });
    await expect(withdrawExcursionReview(db, leader, studyId, fingerprint, req)).rejects.toThrow(
      "The analysis is approved. Withdraw the approval first.",
    );
  });

  it("takes the approval back when another logger fails post-calibration", async () => {
    const r = await postCal(codes[6]!, "-25.00", "-25.90");
    expect(r.deviationNumber).toMatch(/\/0002$/);
    const v = await view();
    expect(v.approval).toBeNull();
    expect(v.blockers.join(" ")).toMatch(/Deviation open: QT\/DEV\/\d{4}\/0002/);
    // Its impact is worked out on the next run press, by itself.
    await runAnalysis(db, preparer, studyId, req);
    const d = (await view()).deviations[1]!;
    expect(d.impact!.note).toMatch(/corrected by \+0.9/);
    await expect(withdrawApproval(db, leader, studyId, "not approved now", req)).rejects.toThrow(
      "BE-WF-02's analysis isn't approved.",
    );
    const [s] = await db.select().from(studies).where(eq(studies.id, studyId));
    expect(s!.analysisRunId).toBeNull();
  });

  it("rejects an override with a note; a second ask, approved, turns the post-cal to pass", async () => {
    const pw = "Lead-Signs-2";
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(pw, { N: 1024, r: 8, p: 1 }) })
      .where(eq(users.id, leader.id));
    const failed = (await view()).postCal.find((p) => p.code === codes[6]!)!;
    expect(failed.result).toBe("fail");
    const readingId = failed.readings.find((r) => r.result === "fail")!.id;
    const first = await requestOverride(
      db,
      engineer,
      readingId,
      { toResult: "pass", reason: "Logger was still settling when read" },
      req,
    );
    await expect(
      decideOverride(db, leader, first.id, { approve: false, password: "", note: "" }, req),
    ).rejects.toThrow("Say why it is rejected.");
    expect(
      await decideOverride(
        db,
        leader,
        first.id,
        { approve: false, password: "", note: "Re-read it after 30 minutes instead" },
        req,
      ),
    ).toEqual({ ok: true });
    expect((await view()).postCal.find((p) => p.code === codes[6]!)!.result).toBe("fail");

    const second = await requestOverride(
      db,
      engineer,
      readingId,
      { toResult: "pass", reason: "Re-read after 30 minutes: -25.2 against -25.0" },
      req,
    );
    expect(
      await decideOverride(db, leader, second.id, { approve: true, password: pw, note: "" }, req),
    ).toEqual({ ok: true });
    expect((await view()).postCal.find((p) => p.code === codes[6]!)!.result).toBe("pass");
    expect((await overridesOf(db, studyId)).map((o) => o.status)).toEqual(["rejected", "approved"]);
  });

  it("audits every step", async () => {
    const rows = await db
      .select({ action: auditLog.action, summary: auditLog.summary })
      .from(auditLog)
      .where(sql`${auditLog.organisationId} = ${leader.organisationId}`);
    const actions = rows.map((r) => r.action);
    for (const a of [
      "study.analysis_run",
      "study.postcal_recorded",
      "deviation.opened",
      "deviation.impact_recalculated",
      "study.excursion_reviewed",
      "study.excursion_review_withdrawn",
      "deviation.assessed",
      "deviation.decided",
      "study.analysis_approved",
      "study.analysis_approval_withdrawn",
    ]) {
      expect(actions).toContain(a);
    }
    expect(rows.find((r) => r.action === "deviation.decided")!.summary).toMatch(
      /closed: Exclude probe, decided by Dr. R. Shah/,
    );
  });
});
