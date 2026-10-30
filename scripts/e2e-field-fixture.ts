/**
 * A job ready for field work, for the phase 5 end-to-end test: its own client
 * (so other tests are untouched), a walk-in freezer the size of BE-WF-02,
 * nine calibrated loggers F-TRH0001…0009 booked for it, and the field
 * engineer on the team. Only for the e2e database (see e2e-prepare.ts).
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { clientCompanies, sites, users } from "@/db/schema";
import { toSessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments } from "@/domain/instruments/instrument-service";
import { listModels } from "@/domain/instruments/queries";
import { layoutTemplate, placeLogger, recordEvent, saveLayout } from "@/domain/field/field-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";

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
  for (const key of ["protocol", "site_access", "previous_report"]) {
    await setReadiness(db, lead, job.id, { key, state: "ready", note: "" }, req);
  }
  await autoBook(db, lead, job.id, req);
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
  for (const key of ["protocol", "site_access", "previous_report"]) {
    await setReadiness(db, lead, job.id, { key, state: "ready", note: "" }, req);
  }
  await autoBook(db, lead, job.id, req);
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
