/**
 * A job ready for field work, for the phase 5 end-to-end test: its own client
 * (so other tests are untouched), a walk-in freezer the size of BE-WF-02,
 * nine calibrated loggers F-TRH0001…0009 booked for it, and the field
 * engineer on the team. Only for the e2e database (see e2e-prepare.ts).
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

import { choosePeriodsAsLogged } from "@/db/seed/choose-period";
import type { Database } from "@/db/client-factory";
import {
  certificates,
  clientCompanies,
  instruments,
  sites,
  studies,
  studyPositions,
  users,
} from "@/db/schema";
import { approveAnalysis, reviewExcursion, runAnalysis } from "@/domain/analysis/analysis-service";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import { toSessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { addDataFile, markReceived } from "@/domain/data/data-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments } from "@/domain/instruments/instrument-service";
import { listModels } from "@/domain/instruments/queries";
import {
  layoutTemplate,
  placeLogger,
  recordEvent,
  recordPrecal,
  saveLayout,
} from "@/domain/field/field-service";
import { autoBook, bookByCodes, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function seedFieldJob(
  db: Database,
  emails: { manager: string; lead: string; engineer: string },
) {
  const who = async (email: string) => {
    const [row] = await db.select().from(users).where(eq(users.email, email));
    const u = row ? toSessionUser(row) : null;
    if (!u) throw new Error(`No user ${email}`);
    return u;
  };
  const manager = await who(emails.manager);
  const lead = await who(emails.lead);
  const engineer = await who(emails.engineer);
  const req = { userAgent: "e2e-prepare" };

  const company = await createCompany(
    db,
    manager,
    {
      name: "Field E2E Pharma",
      code: "FE2E",
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
  );
  const siteId = (await getCompany(db, manager, company.id))!.sites[0]!.id;
  const freezer = await createEquipment(
    db,
    manager,
    company.id,
    {
      siteId,
      departmentId: null,
      code: "FE-WF-02",
      name: "Cold Storage (Walk In Freezer)",
      type: "walk_in_freezer",
      location: "",
      make: "Blue Star",
      model: "",
      serialNo: "",
      lengthM: "3.36",
      widthM: "6.4",
      heightM: "2.4",
      setPointC: "-24",
      tempMinC: "-30",
      tempMaxC: "-15",
      rhMinPct: "",
      rhMaxPct: "",
      defaultChannels: "9",
      readingIntervalMinutes: "10",
      studyDurationHours: "24",
      requalificationMonths: "",
      lastStudyOn: "",
      notes: "",
    },
    req,
  );
  const [bhw] = await db.select().from(sites).where(eq(sites.code, "BHW"));
  const model = (await listModels(db, manager)).find((m) => m.model === "EBI 20-TH1");
  if (!model) throw new Error("ebro EBI 20-TH1 is not seeded");
  const loggers = await bulkAddInstruments(
    db,
    manager,
    {
      modelId: model.id,
      homeSiteId: bhw?.id ?? "",
      codePrefix: "F-TRH",
      serials: Array.from({ length: 9 }, (_, i) => `7710${String(i + 1).padStart(4, "0")}`).join(
        "\n",
      ),
    },
    req,
  );
  const today = new Date();
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/E2E/PDL-01",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(new Date(today.getTime() - 30 * 86_400_000)),
      validUntil: iso(new Date(today.getTime() + 330 * 86_400_000)),
      instrumentIds: loggers.map((l) => l.id),
    },
    req,
  );
  const job = await createJob(
    db,
    lead,
    {
      companyId: company.id,
      clientSiteId: siteId,
      siteId: bhw?.id ?? "",
      poNumber: "E2E-PO-5",
      plannedStart: iso(today),
      plannedEnd: iso(new Date(today.getTime() + 2 * 86_400_000)),
      team: [
        { userId: lead.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
      ],
      items: [{ equipmentId: freezer.id, loggerCount: "9" }],
    },
    req,
  );
  for (const key of ["site_access", "previous_report"]) {
    await setReadiness(db, lead, job.id, { key, state: "ready", note: "" }, req);
  }
  await autoBook(db, lead, job.id, req, { loggers: true });
  return job;
}

/**
 * For the phase 6 test: a second freezer whose 24 h study ended two hours
 * ago, nine loggers F-TRH0011…0019 (serials 77200001…) placed, job in Field
 * work, waiting for its data.
 */
export async function seedDataJob(
  db: Database,
  emails: { manager: string; lead: string; engineer: string },
) {
  const who = async (email: string) => {
    const [row] = await db.select().from(users).where(eq(users.email, email));
    const u = row ? toSessionUser(row) : null;
    if (!u) throw new Error(`No user ${email}`);
    return u;
  };
  const manager = await who(emails.manager);
  const lead = await who(emails.lead);
  const engineer = await who(emails.engineer);
  const req = { userAgent: "e2e-prepare" };
  const [company] = await db.select().from(clientCompanies).where(eq(clientCompanies.code, "FE2E"));
  if (!company) throw new Error("Run seedFieldJob first");
  const siteId = (await getCompany(db, manager, company.id))!.sites[0]!.id;
  const freezer = await createEquipment(
    db,
    manager,
    company.id,
    {
      siteId,
      departmentId: null,
      code: "FE-WF-03",
      name: "Cold Storage (Walk In Freezer 3)",
      type: "walk_in_freezer",
      location: "",
      make: "Blue Star",
      model: "",
      serialNo: "",
      lengthM: "3",
      widthM: "4",
      heightM: "2.4",
      setPointC: "-24",
      tempMinC: "-30",
      tempMaxC: "-15",
      rhMinPct: "",
      rhMaxPct: "",
      defaultChannels: "9",
      readingIntervalMinutes: "10",
      studyDurationHours: "24",
      requalificationMonths: "",
      lastStudyOn: "",
      notes: "",
    },
    req,
  );
  const [bhw] = await db.select().from(sites).where(eq(sites.code, "BHW"));
  const model = (await listModels(db, manager)).find((m) => m.model === "EBI 20-TH1")!;
  const loggers = await bulkAddInstruments(
    db,
    manager,
    {
      modelId: model.id,
      homeSiteId: bhw?.id ?? "",
      codePrefix: "F-TRH",
      serials: Array.from({ length: 9 }, (_, i) => `7720${String(i + 1).padStart(4, "0")}`).join(
        "\n",
      ),
    },
    req,
  );
  const now = new Date();
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/E2E/PDL-02",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(new Date(now.getTime() - 30 * 86_400_000)),
      validUntil: iso(new Date(now.getTime() + 330 * 86_400_000)),
      instrumentIds: loggers.map((l) => l.id),
    },
    req,
  );
  const job = await createJob(
    db,
    lead,
    {
      companyId: company.id,
      clientSiteId: siteId,
      siteId: bhw?.id ?? "",
      poNumber: "E2E-PO-6",
      plannedStart: iso(new Date(now.getTime() - 86_400_000)),
      plannedEnd: iso(now),
      team: [
        { userId: lead.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
      ],
      items: [{ equipmentId: freezer.id, loggerCount: "9" }],
    },
    req,
  );
  for (const key of ["site_access", "previous_report"]) {
    await setReadiness(db, lead, job.id, { key, state: "ready", note: "" }, req);
  }
  // This fixture's own loggers first; auto-booking adds the masters.
  await bookByCodes(db, lead, job.id, loggers.map((l) => l.code).join("\n"), req);
  await autoBook(db, lead, job.id, req, { loggers: true });
  const studyId = (await getJob(db, lead, job.id))!.studies[0]!.id;
  await saveLayout(db, engineer, studyId, await layoutTemplate(db, engineer, studyId), req);
  for (const l of loggers) await placeLogger(db, engineer, studyId, { code: l.serialNo }, req);
  const step = 10 * 60_000;
  const end = new Date(Math.floor((now.getTime() - 2 * 3600_000) / step) * step);
  const start = new Date(end.getTime() - 24 * 3600_000);
  for (const [kind, at] of [
    ["start", start],
    ["end", end],
  ] as const) {
    await recordEvent(db, engineer, studyId, { id: randomUUID(), cycle: "routine", kind, at }, req);
  }
  return job;
}

/**
 * A job at Data received, for the phase 7 end-to-end test: FE-WF-04 with nine
 * loggers G-TRH0001…0009, a finished 24 h study, and its logger data uploaded
 * and confirmed. L-05 runs warmest and goes above −15 °C for 30 minutes.
 * Post-calibration is required.
 */
export async function seedAnalysisJob(
  db: Database,
  blobs: BlobStore,
  emails: { manager: string; lead: string; engineer: string },
  o: { code: string; prefix: string; serial: string; cert: string; po: string } = {
    code: "FE-WF-04",
    prefix: "G-TRH",
    serial: "7730",
    cert: "QATECH/BHIWANDI/E2E/PDL-03",
    po: "E2E-PO-7",
  },
) {
  const who = async (email: string) => {
    const [row] = await db.select().from(users).where(eq(users.email, email));
    const u = row ? toSessionUser(row) : null;
    if (!u) throw new Error(`No user ${email}`);
    return u;
  };
  const manager = await who(emails.manager);
  const lead = await who(emails.lead);
  const engineer = await who(emails.engineer);
  const req = { userAgent: "e2e-prepare" };
  const [company] = await db.select().from(clientCompanies).where(eq(clientCompanies.code, "FE2E"));
  if (!company) throw new Error("Run seedFieldJob first");
  const siteId = (await getCompany(db, manager, company.id))!.sites[0]!.id;
  const freezer = await createEquipment(
    db,
    manager,
    company.id,
    {
      siteId,
      departmentId: null,
      code: o.code,
      name: "Cold Storage (Walk In Freezer 4)",
      type: "walk_in_freezer",
      location: "",
      make: "Blue Star",
      model: "",
      serialNo: "",
      lengthM: "3",
      widthM: "4",
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
    },
    req,
  );
  const [bhw] = await db.select().from(sites).where(eq(sites.code, "BHW"));
  const model = (await listModels(db, manager)).find((m) => m.model === "EBI 20-TH1")!;
  const serials = Array.from(
    { length: 9 },
    (_, i) => `${o.serial}${String(i + 1).padStart(4, "0")}`,
  );
  const loggers = await bulkAddInstruments(
    db,
    manager,
    {
      modelId: model.id,
      homeSiteId: bhw?.id ?? "",
      codePrefix: o.prefix,
      serials: serials.join("\n"),
    },
    req,
  );
  const now = new Date();
  await createExternalCertificate(
    db,
    manager,
    {
      number: o.cert,
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: iso(new Date(now.getTime() - 30 * 86_400_000)),
      validUntil: iso(new Date(now.getTime() + 330 * 86_400_000)),
      instrumentIds: loggers.map((l) => l.id),
    },
    req,
  );
  const job = await createJob(
    db,
    lead,
    {
      companyId: company.id,
      clientSiteId: siteId,
      siteId: bhw?.id ?? "",
      poNumber: o.po,
      plannedStart: iso(new Date(now.getTime() - 86_400_000)),
      plannedEnd: iso(now),
      team: [
        { userId: lead.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
      ],
      items: [{ equipmentId: freezer.id, loggerCount: "9" }],
    },
    req,
  );
  for (const key of ["site_access", "previous_report"]) {
    await setReadiness(db, lead, job.id, { key, state: "ready", note: "" }, req);
  }
  // This fixture's own loggers first; auto-booking adds the masters.
  await bookByCodes(db, lead, job.id, loggers.map((l) => l.code).join("\n"), req);
  await autoBook(db, lead, job.id, req, { loggers: true });
  const studyId = (await getJob(db, lead, job.id))!.studies[0]!.id;
  await saveLayout(db, engineer, studyId, await layoutTemplate(db, engineer, studyId), req);
  for (const l of loggers) await placeLogger(db, engineer, studyId, { code: l.serialNo }, req);
  const step = 10 * 60_000;
  const end = new Date(Math.floor((now.getTime() - 2 * 3600_000) / step) * step);
  const start = new Date(end.getTime() - 24 * 3600_000);
  for (const [kind, at] of [
    ["start", start],
    ["end", end],
  ] as const) {
    await recordEvent(db, engineer, studyId, { id: randomUUID(), cycle: "routine", kind, at }, req);
  }
  // The client asked for post-calibration (set after field work: the fixture books no master).
  await db.update(studies).set({ postCalRequired: true }).where(eq(studies.id, studyId));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Date", "Time", ...serials.map(Number)]);
  ws.addRow([null, null, ...serials.map(() => "°C")]);
  let k = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += step, k += 1) {
    const local = new Date(t + 330 * 60_000);
    ws.addRow([
      new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())),
      new Date(Date.UTC(1899, 11, 30, local.getUTCHours(), local.getUTCMinutes())),
      ...serials.map((_, i) =>
        i === 4
          ? k >= 70 && k < 73
            ? -14.2
            : Math.round((-17 + (k % 4) * 0.2) * 10) / 10
          : Math.round((-22 + i * 0.1 + (k % 5) * 0.1) * 10) / 10,
      ),
    ]);
  }
  const stored = await storeFile(db, blobs, {
    organisationId: lead.organisationId,
    actor: { type: "user", userId: lead.id },
    fileName: `${o.code} raw data.xlsx`,
    bytes: new Uint8Array(await wb.xlsx.writeBuffer()),
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  await addDataFile(db, blobs, lead, studyId, { fileId: stored.file.id }, req);
  await choosePeriodsAsLogged(db, lead, studyId, req);
  await markReceived(db, lead, studyId, req);
  return { job, studyId, lead };
}

/**
 * A job at Report draft's door, for the phase 8 end-to-end test: FE-WF-05 like
 * FE-WF-04, post-calibrated, analysed and approved, with the loggers'
 * certificate PDF on file so a report can be frozen.
 */
export async function seedReportJob(
  db: Database,
  blobs: BlobStore,
  emails: { manager: string; lead: string; engineer: string },
) {
  const { studyId, lead } = await seedAnalysisJob(db, blobs, emails, {
    code: "FE-WF-05",
    prefix: "H-TRH",
    serial: "7740",
    cert: "QATECH/BHIWANDI/E2E/PDL-04",
    po: "E2E-PO-8",
  });
  const req = { userAgent: "e2e-prepare" };
  const [eng] = await db.select().from(users).where(eq(users.email, emails.engineer));
  const engineer = toSessionUser(eng!)!;
  const placed = await db
    .select({ code: instruments.code })
    .from(studyPositions)
    .innerJoin(instruments, eq(instruments.id, studyPositions.instrumentId))
    .where(eq(studyPositions.studyId, studyId));
  for (const p of placed) {
    await recordPrecal(
      db,
      engineer,
      studyId,
      {
        id: randomUUID(),
        code: p.code,
        masterId: "",
        phase: "post",
        reference: "-20.0",
        reading: "-20.1",
      },
      req,
    );
  }
  const run = await runAnalysis(db, lead, studyId, req);
  // L-05's 30-minute excursion, accepted as on site.
  const a = (await getStudyAnalysis(db, lead, studyId))!;
  for (const e of a.excursions) {
    await reviewExcursion(
      db,
      lead,
      studyId,
      {
        fingerprint: e.fingerprint,
        decision: "accepted",
        reason: "Door opened for loading, logged on site",
      },
      req,
    );
  }
  await approveAnalysis(db, lead, studyId, run.runId, req);
  // The lab's certificate PDF for the loggers.
  const pdf = await PDFDocument.create();
  pdf
    .addPage([595.28, 841.89])
    .drawText("QATECH/BHIWANDI/E2E/PDL-04 (e2e certificate)", { x: 60, y: 760 });
  const stored = await storeFile(db, blobs, {
    organisationId: lead.organisationId,
    actor: { type: "user", userId: lead.id },
    fileName: "PDL-04.pdf",
    bytes: await pdf.save(),
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  await db
    .update(certificates)
    .set({ fileId: stored.file.id })
    .where(eq(certificates.number, "QATECH/BHIWANDI/E2E/PDL-04"));
  return studyId;
}
