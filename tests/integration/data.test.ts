/**
 * Phase 6: a team leader gets BE-WF-02's logger Excel by email, uploads it,
 * fixes what's wrong, and confirms the data; the job follows.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { choosePeriodsAsLogged } from "@/db/seed/choose-period";
import { auditLog, jobs, sites, studyDataFiles, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import {
  acceptIssue,
  addDataFile,
  markReceived,
  removeDataFile,
  requestData,
  setChannelMatch,
  setStudyPeriod,
  withdrawAcceptance,
} from "@/domain/data/data-service";
import { getStudyData } from "@/domain/data/queries";
import { layoutTemplate, placeLogger, recordEvent, saveLayout } from "@/domain/field/field-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments, saveModel } from "@/domain/instruments/instrument-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.90" };
const MIN = 60_000;
let blobs: BlobStore;
let leader: SessionUser;
let engineer: SessionUser;
let preparer: SessionUser;
let accounts: SessionUser;
let outsider: SessionUser;
let jobId: string;
let studyId: string;
let serials: string[] = [];
let start: Date;
let end: Date;

async function makeUser(organisationId: string, email: string, role: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ organisationId, email, name, role, status: "active", passwordHash: "x" })
    .returning();
  return toSessionUser(row!)!;
}

/** Wall-clock parts in India for an instant: what the logger software writes. */
function ist(ms: number) {
  const d = new Date(ms + 330 * MIN);
  return {
    date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    time: new Date(Date.UTC(1899, 11, 30, d.getUTCHours(), d.getUTCMinutes())),
  };
}

/**
 * A logger export laid out like WH013's Rawdata sheet: title lines, serials
 * over a °C row, split date and time, readings every 10 min from 10 min
 * before the start to 10 min after the end, then summary rows.
 */
async function export_(opts: {
  serials: string[];
  skip?: { serial: string; from: number; count: number };
  headers?: Record<string, string>;
}) {
  const wb = new ExcelJS.Workbook();
  // Each save differs in its metadata, as a re-saved file does.
  wb.creator = randomUUID();
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Customer Name", null, "M/s. Watson Pharma Pvt Limited."]);
  ws.addRow(["Equipment ID.", null, "BE-WF-02"]);
  ws.addRow([]);
  ws.addRow(["Date", "Time", ...opts.serials.map((s) => opts.headers?.[s] ?? Number(s))]);
  ws.addRow([null, null, ...opts.serials.map(() => "°C")]);
  const first = start.getTime() - 10 * MIN;
  const last = end.getTime() + 10 * MIN;
  let k = 0;
  for (let t = first; t <= last; t += 10 * MIN, k += 1) {
    const { date, time } = ist(t);
    ws.addRow([
      date,
      time,
      ...opts.serials.map((s, i) =>
        opts.skip &&
        opts.skip.serial === s &&
        k >= opts.skip.from &&
        k < opts.skip.from + opts.skip.count
          ? null
          : Math.round((-22 + i * 0.3 + (k % 5) * 0.1) * 10) / 10,
      ),
    ]);
  }
  ws.addRow([]);
  ws.addRow(["Minimum", null, ...opts.serials.map(() => -22)]);
  ws.addRow(["MKT(d.cel.)", null, ...opts.serials.map(() => -21.5)]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function upload(name: string, bytes: Uint8Array, by: SessionUser = leader) {
  const stored = await storeFile(db, blobs, {
    organisationId: by.organisationId,
    actor: { type: "user", userId: by.id },
    fileName: name,
    bytes,
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  return stored.file.id;
}

const jobStatus = async () =>
  (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, jobId)))[0]!.s;
const data = async (who: SessionUser = leader) => (await getStudyData(db, who, studyId))!;

beforeAll(async () => {
  blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-data-")));
  const org = (await ensureOrganisation(db, { slug: "data-org", name: "QA Tech Data" }))
    .organisation;
  const manager = await makeUser(org.id, "mgr@data.test", "manager", "Meera Manager");
  leader = await makeUser(org.id, "tl@data.test", "team_leader", "Ashraf Lead");
  engineer = await makeUser(org.id, "fe@data.test", "field_engineer", "Vikas Engineer");
  preparer = await makeUser(org.id, "rp@data.test", "report_preparer", "Mansi Preparer");
  accounts = await makeUser(org.id, "acc@data.test", "accounts", "Accounts");
  const other = (await ensureOrganisation(db, { slug: "data-other", name: "Other" })).organisation;
  outsider = await makeUser(other.id, "admin@data-other.test", "admin", "Other Admin");
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
        setPointC: "",
        tempMinC: "",
        tempMaxC: "",
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
      codePrefix: "E-TRH",
      serials: Array.from({ length: 11 }, (_, i) => `6228${1300 + i}`).join("\n"),
    },
    req,
  );
  serials = added.slice(0, 9).map((a) => a.serialNo);
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/09/26/PDL-31",
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
      poNumber: "4500022222",
      plannedStart: iso(new Date(now.getTime() - 2 * 86_400_000)),
      plannedEnd: iso(now),
      team: [
        { userId: leader.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
        { userId: preparer.id, role: "data_provider" },
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
  // A 24 h study that ended two hours ago, times tapped on the phone.
  end = new Date(Math.floor((now.getTime() - 2 * 3600_000) / (10 * MIN)) * 10 * MIN);
  start = new Date(end.getTime() - 24 * 3600_000);
  for (const [kind, at] of [
    ["start", start],
    ["end", end],
  ] as const) {
    await recordEvent(db, engineer, studyId, { id: randomUUID(), cycle: "routine", kind, at }, req);
  }
});

afterAll(close);

describe("phase 6: logger data in, checked, and confirmed", () => {
  let firstFile: string;
  let firstStored: string;

  it("reads the emailed workbook, matches all 9 loggers by serial and finds nothing wrong", async () => {
    expect(await jobStatus()).toBe("field_work");
    // Before any file, nothing is reported missing.
    expect((await data()).issues).toEqual([]);
    const fileId = await upload("BE-WF-02 raw data.xlsx", await export_({ serials }));
    const r = await addDataFile(db, blobs, preparer, studyId, { fileId }, req);
    firstFile = r.dataFileId;
    firstStored = fileId;
    expect(r).toMatchObject({
      sheet: "Rawdata",
      readings: 24 * 6 + 3,
      channels: 9,
      matched: 9,
      status: "checked",
      blockers: 0,
    });
    expect(r.notes.join(" ")).toMatch(/Stopped at row \d+ \(“Minimum”\)/);
    const d = await data();
    expect(d.positions.every((p) => p.temp?.how === "serial")).toBe(true);
    // Two readings outside the recorded times (10 min before and after) are left out.
    expect(d.issues.map((i) => [i.kind, i.severity])).toEqual([["outside_window", "info"]]);
    expect(await jobStatus()).toBe("field_work");
  });

  it("refuses the same file twice, a non-data file, and people without the right", async () => {
    await expect(
      addDataFile(db, blobs, leader, studyId, { fileId: firstStored }, req),
    ).rejects.toThrow("BE-WF-02 raw data.xlsx is already on this study.");
    // Re-saved by Excel: different bytes, same readings.
    const fileId = await upload("BE-WF-02 raw data (2).xlsx", await export_({ serials }));
    await expect(addDataFile(db, blobs, leader, studyId, { fileId }, req)).rejects.toThrow(
      "BE-WF-02 raw data (2).xlsx has the same readings as BE-WF-02 raw data.xlsx, already on this study.",
    );
    const csv = await upload("notes.csv", new TextEncoder().encode("Report,Watson\nDone,yes\n"));
    await expect(addDataFile(db, blobs, leader, studyId, { fileId: csv }, req)).rejects.toThrow(
      /No readings found/,
    );
    await expect(addDataFile(db, blobs, accounts, studyId, { fileId }, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(addDataFile(db, blobs, outsider, studyId, { fileId }, req)).rejects.toThrow(
      "That file was not uploaded.",
    );
    expect(await getStudyData(db, outsider, studyId)).toBeNull();
    await expect(markReceived(db, engineer, studyId, req)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("confirming the data moves the job to Data received", async () => {
    // Times tapped on site are a log: the report's period is chosen from the data first.
    expect((await data()).periods[0]).toMatchObject({ fromData: false });
    await expect(markReceived(db, leader, studyId, req)).rejects.toThrow(
      "Set the start and end of the BE-WF-02 study (Start & end) before confirming its data.",
    );
    await choosePeriodsAsLogged(db, leader, studyId, req);
    expect((await data()).periods[0]).toMatchObject({ fromData: true });
    expect(await markReceived(db, leader, studyId, req)).toEqual({ jobStatus: "data_received" });
    // A second tab (or a colleague) confirming at the same time is told, not recorded twice.
    await expect(markReceived(db, leader, studyId, req)).rejects.toThrow(
      /^BE-WF-02's data was already confirmed by Ashraf Lead at /,
    );
    expect((await data()).study).toMatchObject({
      dataStatus: "received",
      receivedBy: "Ashraf Lead",
    });
  });

  it("a corrected file with a 30-minute gap replaces the old one, keeps it in history, and sends the job to Data issue", async () => {
    const fileId = await upload(
      "BE-WF-02 raw data rev1.xlsx",
      await export_({ serials, skip: { serial: serials[2]!, from: 40, count: 2 } }),
    );
    await expect(
      addDataFile(db, blobs, leader, studyId, { fileId, replaces: firstFile, reason: "" }, req),
    ).rejects.toThrow("Say why the file is being replaced");
    const r = await addDataFile(
      db,
      blobs,
      leader,
      studyId,
      { fileId, replaces: firstFile, reason: "Site resent with corrected header" },
      req,
    );
    expect(r).toMatchObject({ status: "issues", blockers: 1 });
    expect(await jobStatus()).toBe("data_issue");
    const d = await data();
    expect(d.files.map((f) => [f.name, f.replaced?.reason ?? null])).toEqual([
      ["BE-WF-02 raw data rev1.xlsx", null],
      ["BE-WF-02 raw data.xlsx", "Site resent with corrected header"],
    ]);
    const gap = d.issues.find((i) => i.kind === "gap")!;
    expect(gap.message).toMatch(
      /^L-03 \(E-TRH0003, 62281302\) °C: 2 readings missing between .+ and .+ \(a 30-min gap\)\.$/,
    );
    expect(d.study.dataStatus).toBe("issues");
    expect(d.study.receivedAt).toBeNull();
  });

  it("a team leader accepts the gap with a reason; withdrawing it reopens it", async () => {
    const gap = (await data()).issues.find((i) => i.kind === "gap")!;
    await expect(
      acceptIssue(db, engineer, studyId, gap.fingerprint, "logger battery", req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(acceptIssue(db, leader, studyId, gap.fingerprint, "ok", req)).rejects.toThrow(
      "Give the reason",
    );
    expect(
      await acceptIssue(
        db,
        leader,
        studyId,
        gap.fingerprint,
        "Logger L-03 battery swap at 13:00; 30 min excluded, see DEV-2026-014",
        req,
      ),
    ).toEqual({ status: "checked", blockers: 0 });
    expect(await jobStatus()).toBe("field_work");
    const d = await data();
    expect(d.issues.find((i) => i.kind === "gap")!.accepted).toMatchObject({ by: "Ashraf Lead" });
    await withdrawAcceptance(db, leader, studyId, d.acceptances[0]!.id, req);
    expect(await jobStatus()).toBe("data_issue");
    await acceptIssue(
      db,
      leader,
      studyId,
      gap.fingerprint,
      "Battery swap; excluded per DEV-2026-014",
      req,
    );
    expect(await jobStatus()).toBe("field_work");
  });

  it("asks the site for a missing file; the next upload closes the request", async () => {
    await requestData(db, leader, studyId, "Please also send the door-sensor export", req);
    expect(await jobStatus()).toBe("data_issue");
    expect((await data(engineer)).requests[0]).toMatchObject({
      note: "Please also send the door-sensor export",
      closedAt: null,
    });
    // The site sends one more logger (not on this study): it's listed, not guessed.
    const extra = await upload(
      "door sensor.xlsx",
      await export_({ serials: ["99887766"], headers: { "99887766": "Door sensor 99887766" } }),
    );
    const r = await addDataFile(db, blobs, engineer, studyId, { fileId: extra }, req);
    expect(r.matched).toBe(0);
    const d = await data();
    expect(d.requests[0]!.closedNote).toBe("door sensor.xlsx uploaded");
    expect(d.others).toHaveLength(1);
    expect(d.issues.find((i) => i.kind === "unmatched_channel")!.message).toMatch(
      /“Door sensor 99887766 °C” isn.t a logger placed on this study/,
    );
    expect(await jobStatus()).toBe("field_work");
    await setChannelMatch(
      db,
      engineer,
      studyId,
      d.others[0]!.id,
      { positionId: null, ignored: true },
      req,
    );
    expect((await data()).issues.some((i) => i.kind === "unmatched_channel")).toBe(false);
  });

  it("a column without a serial is matched by hand to its position", async () => {
    const d0 = await data();
    const current = d0.files.find((f) => f.name === "BE-WF-02 raw data rev1.xlsx")!;
    const fileId = await upload(
      "BE-WF-02 raw data rev2.xlsx",
      await export_({ serials, headers: { [serials[8]!]: "Logger 9" } }),
    );
    const r = await addDataFile(
      db,
      blobs,
      leader,
      studyId,
      { fileId, replaces: current.id, reason: "Gap filled from the logger's own memory" },
      req,
    );
    // “Logger 9” can't be matched: L-09 is missing and the column is listed.
    expect(r.status).toBe("issues");
    const d = await data();
    expect(d.issues.find((i) => i.kind === "missing_logger")!.message).toMatch(/^L-09 /);
    const l09 = d.positions.find((p) => p.label === "L-09")!;
    const col = d.others.find((o) => o.header === "Logger 9 °C")!;
    expect(
      await setChannelMatch(
        db,
        leader,
        studyId,
        col.id,
        { positionId: l09.id, ignored: false },
        req,
      ),
    ).toEqual({ status: "checked", blockers: 0 });
    expect((await data()).positions.find((p) => p.label === "L-09")!.temp?.how).toBe("manual");
    // The gap from rev1 is gone, so its acceptance no longer applies to anything.
    expect((await data()).issues.some((i) => i.kind === "gap")).toBe(false);
  });

  it("a file from another study is flagged and removed, staying in the history", async () => {
    // The site sends a fridge file from another month by mistake.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Raw");
    ws.addRow(["Date", "Time", "DL-01 (°C)"]);
    for (let k = 0; k < 10; k += 1)
      ws.addRow(["20-Sep-2025", `10:${String(k * 5).padStart(2, "0")}:00`, 4 + k / 10]);
    const fileId = await upload(
      "Fridge raw data.xlsx",
      new Uint8Array(await wb.xlsx.writeBuffer()),
    );
    expect((await addDataFile(db, blobs, preparer, studyId, { fileId }, req)).status).toBe(
      "issues",
    );
    const d = await data();
    expect(d.issues[0]!.message).toMatch(
      /^Fridge raw data\.xlsx has readings from 20 Sept?, 10:00 to 20 Sept?, 10:45, but the study ran .+ Is it the right file\?/,
    );
    const fridge = d.files.find((f) => f.name === "Fridge raw data.xlsx")!;
    await expect(
      removeDataFile(db, blobs as never, studyId, fridge.id, "x", req),
    ).rejects.toThrow();
    await expect(removeDataFile(db, preparer, studyId, fridge.id, "oops", req)).rejects.toThrow(
      "Say why it's being removed",
    );
    expect(
      await removeDataFile(
        db,
        preparer,
        studyId,
        fridge.id,
        "Glenmark fridge file, wrong study",
        req,
      ),
    ).toEqual({ status: "checked", blockers: 0 });
    expect((await data()).files.find((f) => f.id === fridge.id)!.replaced!.reason).toBe(
      "Removed: Glenmark fridge file, wrong study",
    );
  });

  it("confirms again, and every step is in the audit trail", async () => {
    await choosePeriodsAsLogged(db, leader, studyId, req);
    await markReceived(db, leader, studyId, req);
    expect(await jobStatus()).toBe("data_received");
    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "study"), eq(auditLog.entityId, studyId)))
    ).map((a) => a.action);
    for (const a of [
      "study.data_uploaded",
      "study.data_replaced",
      "study.data_removed",
      "study.data_matched",
      "study.data_issue_accepted",
      "study.data_issue_withdrawn",
      "study.data_requested",
      "study.data_received",
    ]) {
      expect(actions).toContain(a);
    }
    // Replaced files are never deleted.
    expect(
      (await db.select().from(studyDataFiles).where(eq(studyDataFiles.studyId, studyId))).length,
    ).toBe(5);
  });

  it("sets the study period typed after the upload: old times struck out, data read for the new period", async () => {
    const istText = (ms: number) => {
      const d = new Date(ms + 330 * MIN);
      return d.toISOString().slice(0, 16);
    };
    const from = start.getTime() + 30 * MIN;
    const to = end.getTime() - 30 * MIN;
    const input = { cycle: "routine", start: istText(from), end: istText(to), reason: "" };
    // Field engineers record times on site; the period from the data is the team leader's.
    await expect(setStudyPeriod(db, engineer, studyId, input, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setStudyPeriod(db, leader, studyId, input, req)).rejects.toThrow(
      "Say why the times change",
    );
    await expect(
      setStudyPeriod(db, leader, studyId, { ...input, end: input.start, reason: "x" }, req),
    ).rejects.toThrow("The end must be after the start.");
    await setStudyPeriod(
      db,
      leader,
      studyId,
      { ...input, reason: "loggers started 30 min after the Start tap" },
      req,
    );
    const d = await data();
    const p = d.periods.find((x) => x.cycle === "routine")!;
    expect(p.start!.getTime()).toBe(from);
    expect(p.end!.getTime()).toBe(to);
    expect(d.windows[0]).toMatchObject({ start: from, end: to });
    const audits = await db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, studyId), eq(auditLog.action, "study.period_set")));
    expect(audits.map((a) => a.summary).join("\n")).toContain(
      "loggers started 30 min after the Start tap",
    );
  });
});
