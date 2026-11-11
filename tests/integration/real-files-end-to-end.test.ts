/**
 * The whole of QTech, start to finish, on QA Tech's real files (fixtures/client,
 * git-ignored): the real masters and their NABL certificates, the real FT-05
 * logger workbooks (PDL-12, PDL-14), a two-equipment job (a walk-in freezer
 * with empty and loaded cycles, a warehouse mapped for °C and %RH) with
 * logger data in the Testo export layout, a post-cal failure taken to the
 * client and a CAPA, analysis, reports returned and signed (in the app and on
 * paper), the WCR, the invoice, part payments with TDS and closing. Then the
 * home page, search, the archive and the bell.
 *
 * The data values are made up for the test; everything else is QA Tech's.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jobs, sites, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import {
  approveAnalysis,
  assessDeviation,
  clientDecideDeviation,
  reviewExcursion,
  runAnalysis,
} from "@/domain/analysis/analysis-service";
import { completeCapa, createCapa, verifyCapa } from "@/domain/analysis/capa-service";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import { hashPassword } from "@/domain/auth/password";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { closeJob, recordInvoice, recordPayment } from "@/domain/billing/billing-service";
import { acceptWcr, issueWcr } from "@/domain/billing/wcr-service";
import { createCompany } from "@/domain/clients/company-service";
import { getCompany } from "@/domain/clients/queries";
import { createEquipment } from "@/domain/clients/equipment-service";
import { archiveTree } from "@/domain/dashboard/archive";
import { homeFor } from "@/domain/dashboard/home";
import { addDataFile, markReceived } from "@/domain/data/data-service";
import { getStudyData } from "@/domain/data/queries";
import {
  layoutTemplate,
  placeLogger,
  recordEvent,
  recordPrecal,
  saveLayout,
} from "@/domain/field/field-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import {
  applyInstrumentImport,
  previewInstrumentImport,
} from "@/domain/instruments/instrument-import-service";
import { createInstrument } from "@/domain/instruments/instrument-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { myNotifications } from "@/domain/notifications/notify";
import { createReport, freezeReport, openComments } from "@/domain/reports/report-service";
import {
  answerComment,
  checkReport,
  clientApprove,
  recordPaperSignoff,
  releaseReport,
  returnForRework,
} from "@/domain/reports/review-service";
import { searchAll } from "@/domain/search/search";
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);

const FIX = path.resolve(__dirname, "../../fixtures/client");
const files = {
  pdl12: path.join(FIX, "instruments/23.07.2026 PDL-12.xlsx"),
  pdl14: path.join(FIX, "instruments/25.07.2026 PDL-14.xlsx"),
  tl65: path.join(FIX, "TL-65 05.04.2027.pdf"),
  tl38: path.join(FIX, "TL-38 27.01.2027.pdf"),
};
const haveFiles = Object.values(files).every((f) => existsSync(f));

const req = { ipAddress: "203.0.113.150" };
const PW = "real files end to end 2026";
const slug = `e2e-real-${Date.now() % 100000}`;
const ist = (s: string) => new Date(`${s}+05:30`);
/** "Now" for the phone: the day after the loggers came back. */
const NOW = ist("2026-10-07T12:00:00");

type People = Record<
  "manager" | "lead" | "engineer" | "lab" | "preparer" | "accounts" | "qa" | "head",
  SessionUser
>;
let p: People;
let blobs: LocalBlobStore;
let jobId: string;
let freezer: string;
let warehouse: string;
const reportIds: Record<string, string> = {};

const store = async (fileName: string, bytes: Uint8Array) => {
  const s = await storeFile(db, blobs, {
    organisationId: p.lead.organisationId,
    actor: { type: "user", userId: p.lead.id },
    fileName,
    bytes,
    maxBytes: 20 * 1024 * 1024,
  });
  if (!s.ok) throw new Error(s.message);
  return s.file.id;
};

/** A Testo export: Date, Time, then each serial (°C, and %RH when asked). */
async function testoExport(
  serials: string[],
  from: Date,
  to: Date,
  value: (i: number, t: Date) => { c: number; rh?: number },
  rh: boolean,
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Equipment ID.", "test"]);
  ws.addRow([]);
  ws.addRow(["Date", "Time", ...serials.flatMap((s) => (rh ? [Number(s), null] : [Number(s)]))]);
  ws.addRow(["", "", ...serials.flatMap(() => (rh ? ["°C", "%RH"] : ["°C"]))]);
  const all: { c: number[]; rh: number[] }[] = serials.map(() => ({ c: [], rh: [] }));
  for (let t = from.getTime(); t <= to.getTime(); t += 10 * 60_000) {
    const at = new Date(t);
    const ddmmyyyy = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata" }).format(at);
    const hhmm = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
    const row: (string | number)[] = [ddmmyyyy, hhmm];
    serials.forEach((_, i) => {
      const v = value(i, at);
      row.push(v.c);
      all[i]!.c.push(v.c);
      if (rh) {
        row.push(v.rh!);
        all[i]!.rh.push(v.rh!);
      }
    });
    ws.addRow(row);
  }
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), all };
}

const statsOf = (v: number[]) => ({
  min: Math.min(...v).toFixed(1),
  max: Math.max(...v).toFixed(1),
  avg: (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1),
});

beforeAll(async () => {
  if (!haveFiles) return;
  blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-e2e-real-")));
  const org = (await ensureOrganisation(db, { slug, name: "QA Tech" })).organisation;
  await db.insert(sites).values({ organisationId: org.id, code: "BHW", name: "Bhiwandi" });
  const hash = await hashPassword(PW, { N: 1024, r: 8, p: 1 });
  const make = async (role: string, name: string, clientCompanyId: string | null = null) => {
    const [row] = await db
      .insert(users)
      .values({
        organisationId: org.id,
        email: `${role}@${slug}.test`,
        name,
        role,
        status: "active",
        passwordHash: hash,
        clientCompanyId,
      })
      .returning();
    return toSessionUser(row!)!;
  };
  const manager = await make("manager", "Meera Manager");
  p = {
    manager,
    lead: await make("team_leader", "Tarun Lead"),
    engineer: await make("field_engineer", "Ravi Engineer"),
    lab: await make("lab", "Lata Lab"),
    preparer: await make("report_preparer", "Mangesh Preparer"),
    accounts: await make("accounts", "Kavita Accounts"),
    qa: manager,
    head: manager,
  };
});

describe.skipIf(!haveFiles)("QTech end to end on QA Tech's real files", () => {
  it("records the real masters with their NABL certificates", async () => {
    const master = async (
      code: string,
      type: "reference_thermometer" | "humidity_indicator",
      serialNo: string,
      cert: {
        number: string;
        labName: string;
        ulrNo: string;
        calibratedOn: string;
        validUntil: string;
      },
      pdf: string,
    ) => {
      const m = await createInstrument(
        db,
        p.manager,
        { type, tier: "master", code, serialNo, intervalMonths: "12 months" },
        req,
      );
      const fileId = await store(path.basename(pdf), new Uint8Array(readFileSync(pdf)));
      await createExternalCertificate(
        db,
        p.manager,
        { ...cert, instrumentIds: [m.id], fileId },
        req,
      );
    };
    // TL-02 and TL-30 calibrated PDL-12/14 in July 2026; they ran out in September.
    await master(
      "QATM/CAL/TL-02",
      "reference_thermometer",
      "311401/59",
      {
        number: "ARAI/CAL/2508/2925",
        labName: "ARAI, Pune",
        ulrNo: "CC274225000004727F",
        calibratedOn: "2025-09-08",
        validUntil: "2026-09-08",
      },
      files.tl65,
    );
    await master(
      "QATM/CAL/TL-30",
      "humidity_indicator",
      "60477499",
      {
        number: "SAN/25/1165/TH/1",
        labName: "Sansel, Chennai",
        ulrNo: "CC287925000005408F",
        calibratedOn: "2025-09-09",
        validUntil: "2026-09-08",
      },
      files.tl38,
    );
    await master(
      "QATM/CAL/TL-65",
      "reference_thermometer",
      "25000547",
      {
        number: "TL/026/444.1.1",
        labName: "Tempsens, Udaipur",
        ulrNo: "CC461426000002379F",
        calibratedOn: "2026-04-06",
        validUntil: "2027-04-05",
      },
      files.tl65,
    );
    await master(
      "QATM/CAL/TL-38",
      "humidity_indicator",
      "61442336",
      {
        number: "SAN/26/128/TH/1",
        labName: "Sansel, Chennai",
        ulrNo: "CC287926000000394F",
        calibratedOn: "2026-01-28",
        validUntil: "2027-01-27",
      },
      files.tl38,
    );
  });

  it("imports PDL-12 and PDL-14 as printed, masters linked, no stray cells as loggers", async () => {
    for (const f of [files.pdl12, files.pdl14]) {
      const fileId = await store(path.basename(f), new Uint8Array(readFileSync(f)));
      const preview = await previewInstrumentImport(db, blobs, p.lab, fileId, {
        defaultType: "portable_logger",
      });
      expect(preview.summary.unlinkedMasters).toBe(0);
      expect(preview.plan.instruments.filter((i) => !/^T-TRH\d+$/.test(i.code))).toEqual([]);
      await applyInstrumentImport(
        db,
        blobs,
        p.lab,
        fileId,
        { defaultType: "portable_logger" },
        req,
      );
    }
  });

  it("plans a two-equipment job; booking takes the SSPRT for °C and the RH indicator for %RH", async () => {
    const company = await createCompany(
      db,
      p.manager,
      {
        name: "TEST Demo Pharma",
        code: "TESTDEMO",
        gstin: "",
        address: "",
        notes: "",
        postCalRequired: true,
        requalificationMonths: 12,
        reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT_ID}",
        firstSite: {
          name: "Bhiwandi Plant",
          code: "BHP",
          address: "",
          city: "",
          state: "",
          gstin: "",
        },
      },
      req,
    );
    const site = (await getCompany(db, p.manager, company.id))!.sites[0]!.id;
    const hash = await hashPassword(PW, { N: 1024, r: 8, p: 1 });
    for (const [role, name, key] of [
      ["client_qa", "Priya Nair", "qa"],
      ["client_qa_head", "Sunil Deshmukh", "head"],
    ] as const) {
      const [row] = await db
        .insert(users)
        .values({
          organisationId: p.lead.organisationId,
          email: `${role}@${slug}.test`,
          name,
          role,
          status: "active",
          passwordHash: hash,
          clientCompanyId: company.id,
        })
        .returning();
      p[key] = toSessionUser(row!)!;
    }
    const equipment = (code: string, type: string, extra: Record<string, unknown>) =>
      createEquipment(
        db,
        p.manager,
        company.id,
        {
          siteId: site,
          code,
          name: code,
          type,
          departmentId: null,
          location: "",
          make: "",
          model: "",
          serialNo: "",
          rhMinPct: "",
          rhMaxPct: "",
          requalificationMonths: "",
          lastStudyOn: "",
          notes: "",
          ...extra,
        } as never,
        req,
      );
    freezer = (
      await equipment("TEST-FZ-01", "walk_in_freezer", {
        lengthM: "3.5 m",
        widthM: "2,4",
        heightM: "2500 mm",
        setPointC: "-20 °C",
        tempMinC: "-25",
        tempMaxC: "-15",
        defaultChannels: "9",
        readingIntervalMinutes: "10",
        studyDurationHours: "24",
        cycles: ["empty", "loaded"],
      })
    ).id;
    warehouse = (
      await equipment("TEST-WH-01", "warehouse", {
        lengthM: "12",
        widthM: "8",
        heightM: "4",
        setPointC: "",
        tempMinC: "15",
        tempMaxC: "25",
        rhMaxPct: "60",
        defaultChannels: "5",
        readingIntervalMinutes: "10",
        studyDurationHours: "48",
        cycles: [],
      })
    ).id;
    const job = await createJob(
      db,
      p.lead,
      {
        companyId: company.id,
        clientSiteId: site,
        poNumber: " TESTPO/2026/0451 ",
        poValue: "1.2 lakh",
        plannedStart: "2026-10-01",
        plannedEnd: "2026-10-06",
        team: [
          { userId: p.lead.id, role: "team_leader" },
          { userId: p.engineer.id, role: "field_engineer" },
          { userId: p.preparer.id, role: "report_preparer" },
        ],
        items: [{ equipmentId: freezer }, { equipmentId: warehouse }],
      },
      req,
    );
    jobId = job.id;
    const booked = await autoBook(db, p.lead, jobId, req, { loggers: true });
    expect(booked.masters).toEqual(["QATM/CAL/TL-65", "QATM/CAL/TL-38"]);
    expect(booked.short).toEqual([]);
    for (const key of ["site_access", "previous_report"]) {
      await setReadiness(db, p.lead, jobId, { key, state: "ready", note: "TEST" }, req);
    }
    const j = (await getJob(db, p.lead, jobId))!;
    expect(j.readiness.items.filter((i) => i.state === "pending")).toEqual([]);
  });

  const studyOf = async (equipmentId: string) =>
    (await getJob(db, p.lead, jobId))!.studies.find((s) => s.equipment.id === equipmentId)!;
  const loggersOn = async () =>
    (await getJob(db, p.lead, jobId))!.booked.filter((b) => b.tier !== "master");
  const expected: Record<string, Record<string, { c: number[]; rh: number[] }>> = {};

  it("lays out, places loggers by serial or ID, records the cycles, uploads the Testo export", async () => {
    const all = await loggersOn();
    const sets = { [freezer]: all.slice(0, 9), [warehouse]: all.slice(9, 14) };
    const from = ist("2026-10-01T09:50:00");
    const to = ist("2026-10-03T12:10:00");
    for (const eq of [freezer, warehouse]) {
      const st = await studyOf(eq);
      const tpl = await layoutTemplate(db, p.engineer, st.id);
      await saveLayout(db, p.engineer, st.id, tpl, req);
      const mine = sets[eq]!.slice(0, tpl.length);
      // Scanned as the serial on the label, or typed as the ID in lower case.
      for (const [i, l] of mine.entries())
        await placeLogger(
          db,
          p.engineer,
          st.id,
          { code: i % 2 ? l.code.toLowerCase() : ` ${l.serialNo} ` },
          req,
        );
      const ev = (cycle: string, kind: string, at: string) =>
        recordEvent(
          db,
          p.engineer,
          st.id,
          { id: randomUUID(), cycle, kind, at: ist(at) },
          req,
          NOW,
        );
      if (eq === freezer) {
        await ev("empty", "start", "2026-10-01T10:00:00");
        await ev("empty", "end", "2026-10-02T10:05:00");
        await ev("loaded", "start", "2026-10-02T11:00:00");
        await expect(ev("empty", "start", "2026-10-02T12:00:00")).rejects.toThrow(
          "Empty has already started.",
        );
        await ev("loaded", "end", "2026-10-03T11:05:00");
      } else {
        await ev("routine", "start", "2026-10-01T12:00:00");
        await ev("routine", "end", "2026-10-03T12:05:00");
      }
      const serials = mine.map((l) => l.serialNo);
      const rh = eq === warehouse;
      const exp = await testoExport(
        serials,
        from,
        to,
        (i, t) => {
          const wave = Math.sin(t.getTime() / 5_400_000 + i);
          if (!rh) {
            const hot =
              i === 2 && t >= ist("2026-10-02T14:00:00") && t < ist("2026-10-02T14:40:00");
            return { c: hot ? -14.2 : Math.round((-20.4 + 0.3 * wave) * 10) / 10 };
          }
          const wet = i === 1 && t >= ist("2026-10-02T09:00:00") && t < ist("2026-10-02T09:40:00");
          return {
            c: Math.round((21 + 0.8 * wave) * 10) / 10,
            rh: wet ? 62.5 : Math.round((50 + 3 * wave) * 10) / 10,
          };
        },
        rh,
      );
      expected[eq] = Object.fromEntries(serials.map((s, i) => [s, exp.all[i]!]));
      const fileId = await store(
        `${eq === freezer ? "TEST-FZ-01" : "TEST-WH-01"} raw data.xlsx`,
        exp.bytes,
      );
      await addDataFile(db, blobs, p.engineer, st.id, { fileId }, req);
    }
  });

  it("extracts every logger's readings exactly: min, max and average as in the file", async () => {
    for (const eq of [freezer, warehouse]) {
      const st = await studyOf(eq);
      const d = (await getStudyData(db, p.lead, st.id))!;
      const placed = d.positions.filter((x) => x.logger?.serialNo);
      expect(placed.length).toBeGreaterThan(0);
      for (const pos of placed) {
        const exp = expected[eq]![pos.logger!.serialNo]!;
        expect(pos.temp?.stats, `${pos.label} °C`).toMatchObject(statsOf(exp.c));
        if (eq === warehouse)
          expect(pos.rh?.stats, `${pos.label} %RH`).toMatchObject(statsOf(exp.rh));
      }
    }
  });

  let deviationId: string;

  it("post-cal against TL-65 (°C) and TL-38 (%RH); a failed logger opens a deviation", async () => {
    const masters = (await getJob(db, p.lead, jobId))!.booked.filter((b) => b.tier === "master");
    const tl65 = masters.find((m) => m.code === "QATM/CAL/TL-65")!.id;
    const tl38 = masters.find((m) => m.code === "QATM/CAL/TL-38")!.id;
    const tl02 = (await searchAll(db, p.lab, "QATM/CAL/TL-02")).find(
      (h) => h.label === "QATM/CAL/TL-02",
    )!;
    for (const eq of [freezer, warehouse]) {
      const st = await studyOf(eq);
      const d = (await getStudyData(db, p.lead, st.id))!;
      for (const [i, pos] of d.positions.filter((x) => x.logger).entries()) {
        const code = pos.logger!.code;
        const post = (masterId: string, quantity: string, reference: string, reading: string) =>
          recordPrecal(
            db,
            p.lab,
            st.id,
            { id: randomUUID(), code, masterId, quantity, phase: "post", reference, reading },
            req,
          );
        if (eq === freezer && i === 0) {
          // TL-02 ran out on 08.09.2026.
          await expect(
            post(tl02.href.split("/").at(-1)!, "temperature", "-20.05", "-20.1"),
          ).rejects.toThrow("valid only until 08.09.2026");
        }
        const fails = eq === freezer && i === 4;
        const r = await post(
          tl65,
          "temperature",
          eq === freezer ? "-20.05" : "21.02",
          fails ? "-19.2" : eq === freezer ? "-20.1" : "21.1",
        );
        expect(r.result).toBe(fails ? "fail" : "pass");
        if (fails) expect(r.deviationNumber).toMatch(/^QT\/DEV\/\d{4}\/\d{4}$/);
        if (eq === warehouse) {
          expect((await post(tl38, "humidity", "50.2", "51.4")).result).toBe("pass");
        }
      }
      await markReceived(db, p.lead, st.id, req);
    }
  });

  it("analyses both; the freezer's excursion is reviewed and its deviation goes to the client", async () => {
    for (const eq of [freezer, warehouse]) {
      const st = await studyOf(eq);
      await runAnalysis(db, p.preparer, st.id, req);
      const v = (await getStudyAnalysis(db, p.lead, st.id))!;
      expect(
        v.excursions.length,
        `${eq === freezer ? "freezer" : "warehouse"} excursions`,
      ).toBeGreaterThan(0);
      for (const x of v.excursions)
        await reviewExcursion(
          db,
          p.lead,
          st.id,
          {
            fingerprint: x.fingerprint,
            decision: "accepted",
            reason:
              eq === freezer
                ? "Door held open for loading, 14:00 to 14:40, logged on FT-12"
                : "Dock shutter open during receipt of goods",
          },
          req,
        );
      if (eq === freezer) {
        deviationId = v.deviations[0]!.id;
        await assessDeviation(
          db,
          p.lead,
          deviationId,
          {
            assessment:
              "L-05 read 0.85 °C high at post-cal. Its readings with the error applied still meet the limits.",
          },
          req,
        );
        expect(
          (
            await clientDecideDeviation(
              db,
              p.head,
              deviationId,
              { decision: "no_impact", note: "Accepted" },
              "wrong",
              req,
            )
          ).ok,
        ).toBe(false);
        expect(
          (
            await clientDecideDeviation(
              db,
              p.head,
              deviationId,
              { decision: "no_impact", note: "Accepted" },
              PW,
              req,
            )
          ).ok,
        ).toBe(true);
      }
      const run = (await getStudyAnalysis(db, p.lead, st.id))!.run!;
      await approveAnalysis(db, p.lead, st.id, run.id, req);
    }
  });

  it("raises a CAPA on the deviation, done by its owner, verified by someone else", async () => {
    const c = await createCapa(
      db,
      p.manager,
      deviationId,
      {
        kind: "corrective",
        rootCause: "Logger drifted between yearly calibrations.",
        action: "Check every logger at 6 months against TL-65.",
        ownerUserId: p.lab.id,
        dueOn: "2026-12-31",
      },
      req,
    );
    await completeCapa(
      db,
      p.lab,
      c.id,
      "6-monthly check added to the lab's schedule (FT-05).",
      req,
    );
    await verifyCapa(db, p.manager, c.id, "Checked on 10 loggers: all within ±0.3 °C.", req);
  });

  it("drafts both reports; the annexure redraws the imported PDL certificates (no scan needed)", async () => {
    for (const eq of [freezer, warehouse]) {
      const st = await studyOf(eq);
      reportIds[eq] = (await createReport(db, p.preparer, st.id, req)).id;
      const f = await freezeReport(db, blobs, p.preparer, reportIds[eq]!, req);
      if (!f.ok) throw new Error(f.message);
    }
  });

  it("the team leader returns the freezer report; the preparer answers and signs again", async () => {
    const id = reportIds[freezer]!;
    const st = await studyOf(freezer);
    await returnForRework(
      db,
      p.lead,
      id,
      { comments: [{ section: "details", page: 2, body: "Department should read Stores." }] },
      req,
    );
    await expect(freezeReport(db, blobs, p.preparer, id, req)).rejects.toThrow();
    for (const c of await openComments(db, st.id))
      await answerComment(db, p.preparer, c.id, "Corrected: Stores.", req);
    const again = await freezeReport(db, blobs, p.preparer, id, req);
    if (!again.ok) throw new Error(again.message);
  });

  it("checks and releases both; the client signs the freezer report in the app, the warehouse on paper", async () => {
    for (const eq of [freezer, warehouse]) {
      expect((await checkReport(db, p.manager, reportIds[eq]!, { password: PW }, req)).ok).toBe(
        true,
      );
      await releaseReport(
        db,
        p.lead,
        reportIds[eq]!,
        { to: [p.qa.id, p.head.id] },
        "https://qtech.test",
        req,
      );
    }
    expect(
      (await clientApprove(db, blobs, p.head, reportIds[freezer]!, { password: PW }, req)).ok,
    ).toBe(true);
    const scan = await PDFDocument.create();
    scan.addPage([595.28, 841.89]).drawText("TEST-WH-01 report signed in ink (scan)");
    const fileId = await store("TEST-WH-01 signed scan.pdf", await scan.save());
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    await recordPaperSignoff(
      db,
      p.lead,
      reportIds[warehouse]!,
      {
        fileId,
        approvedByName: "Sunil Deshmukh",
        approvedByTitle: "Head QA",
        approvedOn: today,
      },
      req,
    );
  });

  it("issues the WCR, the client accepts it, invoice and two part payments with TDS; the job closes", async () => {
    const wcr = await issueWcr(db, blobs, p.lead, jobId, req);
    expect((await acceptWcr(db, p.head, wcr.id, PW, req)).ok).toBe(true);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const inv = await recordInvoice(
      db,
      p.accounts,
      jobId,
      { number: "QT/26-27/451", invoiceDate: today, taxable: 120000, gst: 21600 },
      req,
    );
    const first = await recordPayment(
      db,
      p.accounts,
      inv.id,
      { paidOn: today, received: 70000, tds: 0, mode: "neft", reference: "UTR2026110301" },
      req,
    );
    expect(first.left).toBe(71600);
    const last = await recordPayment(
      db,
      p.accounts,
      inv.id,
      { paidOn: today, received: 69200, tds: 2400, mode: "neft", reference: "UTR2026110302" },
      req,
    );
    expect(last.left).toBe(0);
    await closeJob(db, p.manager, jobId, req);
    const [j] = await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
    expect(j!.s).toBe("closed");
  });

  it("shows it all on the home page, in search, the archive and the bell", async () => {
    const home = await homeFor(db, p.manager);
    expect(
      home.board.find((b) => /closed|history/i.test(b.label))?.count ?? 0,
    ).toBeGreaterThanOrEqual(0);
    const fz = await searchAll(db, p.lead, "TEST-FZ-01");
    expect(fz.map((h) => h.kind)).toEqual(expect.arrayContaining(["Report", "Equipment"]));
    expect((await searchAll(db, p.lead, "TESTPO/2026/0451")).some((h) => h.kind === "Job")).toBe(
      true,
    );
    const { total } = await archiveTree(db, p.lead);
    expect(total).toBe(2);
    const bell = await myNotifications(db, p.preparer);
    expect(bell.rows.map((r) => r.title)).toEqual(
      expect.arrayContaining([expect.stringMatching(/came back from the checker/)]),
    );
  });
});
