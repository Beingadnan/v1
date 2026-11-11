/**
 * TEST jobs at every stage, for looking around the app: one job stopped at
 * each step from "created" to "closed", for a TEST client, run through the
 * same services people use (so every record, signature and audit entry is
 * real). The loggers and masters must already be in the register with valid
 * certificates; the logger data is generated in the Testo export layout.
 *
 * Used by scripts/seed-demo.ts and tested in tests/integration/seed-demo.test.ts.
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";

import type { Database } from "@/db/client-factory";
import { clientCompanies, equipment, instruments, jobs, studyPrecal, users } from "@/db/schema";
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
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { addDataFile, markReceived } from "@/domain/data/data-service";
import { getStudyData } from "@/domain/data/queries";
import {
  layoutTemplate,
  placeLogger,
  recordEvent,
  recordPrecal,
  saveLayout,
} from "@/domain/field/field-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { createReport, freezeReport } from "@/domain/reports/report-service";
import { checkReport, clientApprove, releaseReport } from "@/domain/reports/review-service";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

export type DemoPerson = { user: SessionUser; password: string };
export type DemoPeople = Record<
  "manager" | "lead" | "engineer" | "lab" | "preparer" | "accounts" | "qa" | "head",
  DemoPerson
>;
/** QA Tech's people; the client's two signatories are made with the TEST client. */
export type DemoStaff = Omit<DemoPeople, "qa" | "head">;

export const DEMO_STAGES = [
  "created",
  "ready",
  "field_work",
  "data_received",
  "analysis",
  "with_checker",
  "with_client",
  "invoiced",
  "closed",
] as const;
export type DemoStage = (typeof DEMO_STAGES)[number];

const req = { ipAddress: "127.0.0.1" };
const ist = (s: string) => new Date(`${s}+05:30`);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

type Ctx = {
  db: Database;
  blobs: BlobStore;
  p: DemoPeople;
  companyId: string;
  siteId: string;
  equipment: Record<"freezer" | "coldRoom" | "warehouse", string>;
  log: (line: string) => void;
};

/** A Testo export: Date, Time, then each serial (°C, and %RH when asked). */
async function testoExport(
  serials: string[],
  from: Date,
  to: Date,
  rh: boolean,
  value: (i: number, t: Date) => { c: number; rh: number },
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Date", "Time", ...serials.flatMap((s) => (rh ? [Number(s), null] : [Number(s)]))]);
  ws.addRow(["", "", ...serials.flatMap(() => (rh ? ["°C", "%RH"] : ["°C"]))]);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", ...o });
  for (let t = from.getTime(); t <= to.getTime(); t += 10 * 60_000) {
    const at = new Date(t);
    const row: (string | number)[] = [
      fmt({}).format(at),
      fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(at),
    ];
    serials.forEach((_, i) => {
      const v = value(i, at);
      row.push(v.c);
      if (rh) row.push(v.rh);
    });
    ws.addRow(row);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function store(c: Ctx, fileName: string, bytes: Uint8Array) {
  const s = await storeFile(c.db, c.blobs, {
    organisationId: c.p.lead.user.organisationId,
    actor: { type: "user", userId: c.p.lead.user.id },
    fileName,
    bytes,
    maxBytes: 20 * 1024 * 1024,
  });
  if (!s.ok) throw new Error(s.message);
  return s.file.id;
}

/** The TEST client with a freezer, a cold room and a warehouse. */
async function client(
  db: Database,
  blobs: BlobStore,
  staff: DemoStaff,
  clientPassword: string,
  log: Ctx["log"],
): Promise<Ctx> {
  const p = staff as DemoPeople;
  const org = p.manager.user.organisationId;
  const [exists] = await db
    .select({ id: clientCompanies.id })
    .from(clientCompanies)
    .where(and(eq(clientCompanies.organisationId, org), eq(clientCompanies.code, "TESTSEED")));
  if (exists) {
    // Seeded before (or stopped half-way): carry on with what is there.
    const siteId = (await getCompany(db, p.manager.user, exists.id))!.sites[0]!.id;
    const eqRows = await db
      .select({ id: equipment.id, code: equipment.code })
      .from(equipment)
      .where(eq(equipment.companyId, exists.id));
    const id = (code: string) => eqRows.find((e) => e.code === code)!.id;
    const hash = await hashPassword(clientPassword);
    for (const [key, email] of [
      ["qa", "test.seed.clientqa@qtech-demo.example.com"],
      ["head", "test.seed.clienthead@qtech-demo.example.com"],
    ] as const) {
      const [row] = await db
        .update(users)
        .set({ passwordHash: hash })
        .where(and(eq(users.organisationId, org), eq(users.email, email)))
        .returning();
      p[key] = { user: toSessionUser(row!)!, password: clientPassword };
    }
    log("TEST client TEST Seed Pharma Pvt Ltd (TESTSEED) found: carrying on");
    return {
      db,
      blobs,
      p,
      companyId: exists.id,
      siteId,
      equipment: {
        freezer: id("TSEED-FZ-01"),
        coldRoom: id("TSEED-CR-01"),
        warehouse: id("TSEED-WH-01"),
      },
      log,
    };
  }
  const company = await createCompany(
    db,
    p.manager.user,
    {
      name: "TEST Seed Pharma Pvt Ltd",
      code: "TESTSEED",
      gstin: "",
      address: "Plot T-1, TEST MIDC, Bhiwandi",
      notes: "TEST client made by scripts/seed-demo.ts to show a job at every stage. Not real.",
      postCalRequired: true,
      requalificationMonths: 12,
      reportNumberFormat: "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT_ID}",
      firstSite: {
        name: "TEST Bhiwandi Plant",
        code: "TBP",
        address: "",
        city: "Bhiwandi",
        state: "Maharashtra",
        gstin: "",
      },
    },
    req,
  );
  const siteId = (await getCompany(db, p.manager.user, company.id))!.sites[0]!.id;
  // The client's QA and QA head, who sign in the app.
  const hash = await hashPassword(clientPassword);
  for (const [key, role, name, email] of [
    ["qa", "client_qa", "TEST Seed Priya (client QA)", "test.seed.clientqa@qtech-demo.example.com"],
    [
      "head",
      "client_qa_head",
      "TEST Seed Sunil (client QA head)",
      "test.seed.clienthead@qtech-demo.example.com",
    ],
  ] as const) {
    const [row] = await db
      .insert(users)
      .values({
        organisationId: org,
        email,
        name,
        role,
        status: "active",
        passwordHash: hash,
        clientCompanyId: company.id,
      })
      .returning();
    p[key] = { user: toSessionUser(row!)!, password: clientPassword };
  }
  const make = (code: string, name: string, type: string, extra: Record<string, unknown>) =>
    createEquipment(
      db,
      p.manager.user,
      company.id,
      {
        siteId,
        code,
        name,
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
        notes: "TEST equipment",
        ...extra,
      } as never,
      req,
    );
  const freezer = await make("TSEED-FZ-01", "Walk-in Freezer (TEST)", "walk_in_freezer", {
    lengthM: "3.5",
    widthM: "2.4",
    heightM: "2.5",
    setPointC: "-20",
    tempMinC: "-25",
    tempMaxC: "-15",
    defaultChannels: "9",
    readingIntervalMinutes: "10",
    studyDurationHours: "24",
    cycles: ["empty", "loaded"],
  });
  const coldRoom = await make("TSEED-CR-01", "Cold Room 2-8 (TEST)", "cold_room", {
    lengthM: "4",
    widthM: "3",
    heightM: "2.8",
    setPointC: "5",
    tempMinC: "2",
    tempMaxC: "8",
    defaultChannels: "9",
    readingIntervalMinutes: "10",
    studyDurationHours: "24",
    cycles: [],
  });
  const warehouse = await make("TSEED-WH-01", "FG Warehouse Area A (TEST)", "warehouse", {
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
  });
  log(
    "TEST client TEST Seed Pharma Pvt Ltd (TESTSEED): 3 equipment; client sign-in test.seed.clientqa@ and test.seed.clienthead@qtech-demo.example.com",
  );
  return {
    db,
    blobs,
    p,
    companyId: company.id,
    siteId,
    equipment: { freezer: freezer.id, coldRoom: coldRoom.id, warehouse: warehouse.id },
    log,
  };
}

type Plan = {
  stage: DemoStage;
  start: string;
  items: ("freezer" | "coldRoom" | "warehouse")[];
  /** A logger fails post-cal: a deviation for the client to decide. */
  failPostCal?: boolean;
};

const reach = (stage: DemoStage, step: DemoStage) =>
  DEMO_STAGES.indexOf(stage) >= DEMO_STAGES.indexOf(step);

/** The job status each demo stage stops at. */
const FINAL_STATUS: Record<DemoStage, string> = {
  created: "created",
  ready: "ready",
  field_work: "field_work",
  data_received: "data_received",
  analysis: "analysis",
  with_checker: "report_draft",
  with_client: "sent_to_client",
  invoiced: "invoiced",
  closed: "closed",
};

/**
 * Masters for post-cal: checked today, so they must be valid today (a master
 * booked for an August study may have run out since). TL-65 and TL-38 when
 * they are in the register, else the ones booked.
 */
async function postCalMasters(c: Ctx, booked: { id: string; type: string; tier: string }[]) {
  const rows = await c.db
    .select({ id: instruments.id, code: instruments.code })
    .from(instruments)
    .where(
      and(
        eq(instruments.organisationId, c.p.lead.user.organisationId),
        inArray(instruments.code, ["QATM/CAL/TL-65", "QATM/CAL/TL-38"]),
      ),
    );
  const masters = booked.filter((b) => b.tier === "master");
  return {
    temp:
      rows.find((r) => r.code === "QATM/CAL/TL-65")?.id ??
      (masters.find((m) => m.type !== "humidity_indicator") ?? masters[0]!).id,
    rh:
      rows.find((r) => r.code === "QATM/CAL/TL-38")?.id ??
      (masters.find((m) => m.type === "humidity_indicator") ?? masters[0]!).id,
  };
}

type Kind = keyof Ctx["equipment"];
const kindOf = (c: Ctx, equipmentId: string) =>
  (Object.entries(c.equipment).find(([, id]) => id === equipmentId)?.[0] ?? "freezer") as Kind;

/** Post-cal for each logger not yet checked after the study, then data received. */
async function postCalAndReceive(
  c: Ctx,
  plan: Plan,
  studyId: string,
  kind: Kind,
  loggers: { id: string; code: string }[],
  masters: { temp: string; rh: string },
) {
  const { db, p } = c;
  const done = await db
    .select({ instrumentId: studyPrecal.instrumentId, quantity: studyPrecal.quantity })
    .from(studyPrecal)
    .where(and(eq(studyPrecal.studyId, studyId), eq(studyPrecal.phase, "post")));
  const has = (id: string, q: string) =>
    done.some((d) => d.instrumentId === id && d.quantity === q);
  const rh = kind === "warehouse";
  for (const [i, l] of loggers.entries()) {
    const fails = plan.failPostCal && kind === "freezer" && i === 4;
    const ref = kind === "freezer" ? "-20.05" : kind === "coldRoom" ? "5.08" : "21.02";
    const reading = (Number(ref) + (fails ? 0.85 : 0.05)).toFixed(2);
    const check = (quantity: string, masterId: string, reference: string, value: string) =>
      recordPrecal(
        db,
        p.lab.user,
        studyId,
        {
          id: randomUUID(),
          code: l.code,
          masterId,
          quantity,
          phase: "post",
          reference,
          reading: value,
        },
        req,
      );
    if (!has(l.id, "temperature")) await check("temperature", masters.temp, ref, reading);
    if (rh && !has(l.id, "humidity")) await check("humidity", masters.rh, "50.2", "51.0");
  }
  await markReceived(db, p.lead.user, studyId, req);
}

async function seedJob(c: Ctx, plan: Plan, n: number) {
  const { db, p } = c;
  const title = `TEST demo: ${plan.stage.replace(/_/g, " ")}`;
  const end = addDays(plan.start, 3);
  const now = ist(`${addDays(end, 1)}T12:00:00`);

  const [existing] = await db
    .select({ id: jobs.id, number: jobs.number, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.companyId, c.companyId), eq(jobs.title, title)));
  if (existing) {
    if (existing.status === FINAL_STATUS[plan.stage]) {
      c.log(`${existing.number}: ${plan.stage.replace(/_/g, " ")} (already there)`);
      return;
    }
    // Stopped after the data was uploaded, before post-cal: finish from there.
    const detail = (await getJob(db, p.lead.user, existing.id))!;
    const masters = await postCalMasters(c, detail.booked);
    for (const s of detail.studies) {
      const d = (await getStudyData(db, p.lead.user, s.id))!;
      const placed = d.positions.flatMap((x) =>
        x.logger ? [detail.booked.find((b) => b.code === x.logger!.code)!] : [],
      );
      if (s.dataStatus !== "received")
        await postCalAndReceive(c, plan, s.id, kindOf(c, s.equipment.id), placed, masters);
    }
    return afterData(c, plan, existing.id, existing.number, n);
  }

  const job = await createJob(
    db,
    p.lead.user,
    {
      companyId: c.companyId,
      clientSiteId: c.siteId,
      poNumber: reach(plan.stage, "ready") ? `TESTSEED/PO/${String(n).padStart(3, "0")}` : "",
      poValue: reach(plan.stage, "ready") ? "85000" : "",
      title,
      notes: "TEST job made by scripts/seed-demo.ts. Not real.",
      plannedStart: plan.start,
      plannedEnd: end,
      team: [
        { userId: p.lead.user.id, role: "team_leader" },
        { userId: p.engineer.user.id, role: "field_engineer" },
        { userId: p.preparer.user.id, role: "report_preparer" },
      ],
      items: plan.items.map((k) => ({ equipmentId: c.equipment[k] })),
    },
    req,
  );
  const jobId = job.id;
  const done = () => c.log(`${job.number}: ${plan.stage.replace(/_/g, " ")}`);
  if (!reach(plan.stage, "ready")) return done();

  const booked = await autoBook(db, p.lead.user, jobId, req, { loggers: true });
  if (booked.short.length) {
    throw new Error(
      `${job.number}: short of ${booked.short.map((s) => `${s.count} ${s.type}`).join(", ")} for ${plan.start}–${end}. Are the loggers and masters in the register with certificates covering these dates?`,
    );
  }
  for (const key of ["site_access", "previous_report"]) {
    await setReadiness(db, p.lead.user, jobId, { key, state: "ready", note: "TEST" }, req);
  }
  if (!reach(plan.stage, "field_work")) return done();

  // Field work: layout, loggers placed, cycles timed.
  const detail = (await getJob(db, p.lead.user, jobId))!;
  const loggers = detail.booked.filter((b) => b.tier !== "master");
  const masters = await postCalMasters(c, detail.booked);
  let next = 0;
  const from = ist(`${plan.start}T09:50:00`);
  const to = ist(`${addDays(plan.start, 2)}T12:10:00`);
  for (const s of detail.studies) {
    const kind = kindOf(c, s.equipment.id);
    const tpl = await layoutTemplate(db, p.engineer.user, s.id);
    await saveLayout(db, p.engineer.user, s.id, tpl, req);
    const mine = loggers.slice(next, next + tpl.length);
    next += tpl.length;
    for (const l of mine) await placeLogger(db, p.engineer.user, s.id, { code: l.code }, req);
    const ev = (cycle: string, k: string, at: string) =>
      recordEvent(
        db,
        p.engineer.user,
        s.id,
        { id: randomUUID(), cycle, kind: k, at: ist(at) },
        req,
        now,
      );
    const day1 = `${plan.start}T10:00:00`;
    const day2 = `${addDays(plan.start, 1)}T10:05:00`;
    const day2b = `${addDays(plan.start, 1)}T11:00:00`;
    const day3 = `${addDays(plan.start, 2)}T11:05:00`;
    if (kind === "freezer") {
      await ev("empty", "start", day1);
      if (!reach(plan.stage, "data_received")) continue;
      await ev("empty", "end", day2);
      await ev("loaded", "start", day2b);
      await ev("loaded", "end", day3);
    } else {
      await ev("routine", "start", day1);
      if (!reach(plan.stage, "data_received")) continue;
      await ev("routine", "end", kind === "warehouse" ? day3 : day2);
    }

    // Data, as exported from Testo; then post-cal.
    const rh = kind === "warehouse";
    const base = kind === "freezer" ? -20.4 : kind === "coldRoom" ? 5 : 21;
    const bytes = await testoExport(
      mine.map((l) => l.serialNo),
      from,
      to,
      rh,
      (i, t) => {
        const wave = Math.sin(t.getTime() / 5_400_000 + i);
        const door =
          kind === "freezer" &&
          i === 2 &&
          t >= ist(`${addDays(plan.start, 1)}T14:00:00`) &&
          t < ist(`${addDays(plan.start, 1)}T14:40:00`);
        return {
          c: door ? -14.2 : Math.round((base + 0.3 * wave) * 10) / 10,
          rh: Math.round((50 + 3 * wave) * 10) / 10,
        };
      },
    );
    const fileId = await store(c, `${s.equipment.code} raw data.xlsx`, bytes);
    await addDataFile(db, c.blobs, p.engineer.user, s.id, { fileId }, req);
    await postCalAndReceive(c, plan, s.id, kind, mine, masters);
  }
  if (!reach(plan.stage, "data_received")) return done();
  return afterData(c, plan, jobId, job.number, n);
}

/** From analysis to closing, as far as the plan's stage. */
async function afterData(c: Ctx, plan: Plan, jobId: string, number: string, n: number) {
  const { db, p } = c;
  const done = () => c.log(`${number}: ${plan.stage.replace(/_/g, " ")}`);
  const detail = (await getJob(db, p.lead.user, jobId))!;
  if (!reach(plan.stage, "analysis")) return done();
  // Analysis: run; past "analysis", excursions reviewed, deviations decided, approved.
  for (const s of detail.studies) {
    await runAnalysis(db, p.preparer.user, s.id, req);
    if (!reach(plan.stage, "with_checker")) continue;
    const v = (await getStudyAnalysis(db, p.lead.user, s.id))!;
    for (const x of v.excursions)
      await reviewExcursion(
        db,
        p.lead.user,
        s.id,
        {
          fingerprint: x.fingerprint,
          decision: "accepted",
          reason: "TEST: door held open for loading, logged on FT-12",
        },
        req,
      );
    for (const d of v.deviations) {
      await assessDeviation(
        db,
        p.lead.user,
        d.id,
        {
          assessment:
            "TEST: the logger read 0.85 °C high at post-cal; with the error applied its readings still meet the limits.",
        },
        req,
      );
      const r = await clientDecideDeviation(
        db,
        p.head.user,
        d.id,
        { decision: "no_impact", note: "TEST" },
        p.head.password,
        req,
      );
      if (!r.ok) throw new Error(`Deviation decision: ${r.message}`);
      const capa = await createCapa(
        db,
        p.manager.user,
        d.id,
        {
          kind: "corrective",
          rootCause: "TEST: logger drifted between yearly calibrations.",
          action: "TEST: check loggers at 6 months against the SSPRT.",
          ownerUserId: p.lab.user.id,
          dueOn: addDays(todayIst(), 30),
        },
        req,
      );
      await completeCapa(
        db,
        p.lab.user,
        capa.id,
        "TEST: 6-monthly check added to the lab's schedule.",
        req,
      );
      await verifyCapa(
        db,
        p.manager.user,
        capa.id,
        "TEST: 10 loggers checked, all within ±0.3 °C.",
        req,
      );
    }
    const run = (await getStudyAnalysis(db, p.lead.user, s.id))!.run!;
    await approveAnalysis(db, p.lead.user, s.id, run.id, req);
  }
  if (!reach(plan.stage, "with_checker")) return done();

  // Reports: drafted and frozen for checking; past that, signed for QA Tech and released.
  const reportIds: string[] = [];
  for (const s of detail.studies) {
    const id = (await createReport(db, p.preparer.user, s.id, req)).id;
    const f = await freezeReport(db, c.blobs, p.preparer.user, id, req);
    if (!f.ok) throw new Error(`Freeze: ${f.message}`);
    reportIds.push(id);
  }
  if (!reach(plan.stage, "with_client")) return done();
  for (const id of reportIds) {
    const r = await checkReport(db, p.manager.user, id, { password: p.manager.password }, req);
    if (!r.ok) throw new Error(`Checked By: ${r.message}`);
    await releaseReport(db, p.lead.user, id, { to: [p.qa.user.id, p.head.user.id] }, "", req);
  }
  if (!reach(plan.stage, "invoiced")) return done();

  // The client signs; the WCR, the invoice and payments.
  for (const id of reportIds) {
    const b = await clientApprove(db, c.blobs, p.head.user, id, { password: p.head.password }, req);
    if (!b.ok) throw new Error(`Client signature: ${b.message}`);
  }
  const wcr = await issueWcr(db, c.blobs, p.lead.user, jobId, req);
  const acc = await acceptWcr(db, p.head.user, wcr.id, p.head.password, req);
  if (!acc.ok) throw new Error(`WCR: ${acc.message}`);
  const today = todayIst();
  const inv = await recordInvoice(
    db,
    p.accounts.user,
    jobId,
    {
      number: `TS/26-27/${String(n).padStart(3, "0")}`,
      invoiceDate: today,
      taxable: 85000,
      gst: 15300,
    },
    req,
  );
  await recordPayment(
    db,
    p.accounts.user,
    inv.id,
    { paidOn: today, received: 50000, tds: 0, mode: "neft", reference: `TESTUTR${n}A` },
    req,
  );
  if (!reach(plan.stage, "closed")) return done();
  await recordPayment(
    db,
    p.accounts.user,
    inv.id,
    { paidOn: today, received: 48600, tds: 1700, mode: "neft", reference: `TESTUTR${n}B` },
    req,
  );
  await closeJob(db, p.manager.user, jobId, req);
  return done();
}

/**
 * One TEST job stopped at each stage. Field dates run in August 2026, a few
 * days apart, so no two jobs want the same loggers or masters.
 */
export async function seedDemoJobs(
  db: Database,
  blobs: BlobStore,
  staff: DemoStaff,
  clientPassword: string,
  log: (line: string) => void = () => {},
) {
  const c = await client(db, blobs, staff, clientPassword, log);
  const plans: Plan[] = [
    { stage: "created", start: "2026-08-01", items: ["coldRoom"] },
    { stage: "ready", start: "2026-08-05", items: ["freezer"] },
    { stage: "field_work", start: "2026-08-09", items: ["freezer"] },
    { stage: "data_received", start: "2026-08-13", items: ["coldRoom"] },
    { stage: "analysis", start: "2026-08-17", items: ["freezer"], failPostCal: true },
    { stage: "with_checker", start: "2026-08-21", items: ["coldRoom"] },
    { stage: "with_client", start: "2026-08-25", items: ["freezer"] },
    { stage: "invoiced", start: "2026-08-29", items: ["coldRoom"] },
    { stage: "closed", start: "2026-09-02", items: ["freezer", "warehouse"], failPostCal: true },
  ];
  for (const [i, plan] of plans.entries()) await seedJob(c, plan, i + 1);
  return { companyId: c.companyId };
}
