/**
 * A job ready for field work, for the phase 5 end-to-end test: its own client
 * (so other tests are untouched), a walk-in freezer the size of BE-WF-02,
 * nine calibrated loggers F-TRH0001…0009 booked for it, and the field
 * engineer on the team. Only for the e2e database (see e2e-prepare.ts).
 */
import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { sites, users } from "@/db/schema";
import { toSessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments } from "@/domain/instruments/instrument-service";
import { listModels } from "@/domain/instruments/queries";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";

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
