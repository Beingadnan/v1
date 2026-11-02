/**
 * Builds QA Tech's BE-WF-02 study on a test database from the real logger
 * export (fixtures/client, git-ignored): Watson Pharma, the report's nine
 * loggers placed L-01…L-09, the study times of 22–23 May 2026, the data
 * uploaded and confirmed. For tests only.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { jobs, sites, studies, studyEvents, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { hashPassword } from "@/domain/auth/password";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { createEquipment } from "@/domain/clients/equipment-service";
import { getCompany } from "@/domain/clients/queries";
import { addDataFile, markReceived } from "@/domain/data/data-service";
import { layoutTemplate, placeLogger, saveLayout } from "@/domain/field/field-service";
import { createExternalCertificate } from "@/domain/instruments/certificate-service";
import { bulkAddInstruments, saveModel } from "@/domain/instruments/instrument-service";
import { autoBook, createJob, setReadiness } from "@/domain/jobs/job-service";
import { getJob } from "@/domain/jobs/queries";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

/** Everyone the seed makes signs with this password. */
export const BE_WF_02_PASSWORD = "correct horse battery staple 9";

export const BE_WF_02_FILE = path.resolve(
  __dirname,
  "../../fixtures/client/BE-WF-02 raw data.xlsx",
);
export const BE_WF_02_SERIALS = [
  "62281257",
  "62230434",
  "62283621",
  "62220170",
  "62283645",
  "62273014",
  "62219287",
  "62283553",
  "62283563",
];
const SERIALS = BE_WF_02_SERIALS;
const FILE = BE_WF_02_FILE;
const req = { ipAddress: "203.0.113.92" };

export async function seedBeWf02(
  db: Database,
  slug: string,
): Promise<{
  lead: SessionUser;
  manager: SessionUser;
  studyId: string;
  jobId: string;
  companyId: string;
  blobs: BlobStore;
}> {
  const blobs: BlobStore = new LocalBlobStore(
    await mkdtemp(path.join(tmpdir(), "qtech-be-wf-02-")),
  );
  const org = (await ensureOrganisation(db, { slug, name: "QA Tech Real" })).organisation;
  // A real (cheap) hash, so these people can sign (phase 9).
  const passwordHash = await hashPassword(BE_WF_02_PASSWORD, { N: 1024, r: 8, p: 1 });
  const make = async (email: string, role: string, name: string) => {
    const [row] = await db
      .insert(users)
      .values({ organisationId: org.id, email, name, role, status: "active", passwordHash })
      .returning();
    return toSessionUser(row!)!;
  };
  const manager = await make(`mgr@${slug}.test`, "manager", "Manager");
  const lead = await make(`tl@${slug}.test`, "team_leader", "Lead");
  const engineer = await make(`fe@${slug}.test`, "field_engineer", "Engineer");
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
    { modelId, homeSiteId: bhw!.id, codePrefix: "T-TRH", serials: SERIALS.join("\n") },
    req,
  );
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  await createExternalCertificate(
    db,
    manager,
    {
      number: "QATECH/BHIWANDI/04/26/PDL-77",
      ulrNo: "",
      labName: "QA Tech Lab",
      calibratedOn: "2026-04-15",
      validUntil: iso(new Date(now.getTime() + 300 * 86_400_000)),
      instrumentIds: added.map((a) => a.id),
    },
    req,
  );
  const job = await createJob(
    db,
    lead,
    {
      companyId,
      clientSiteId: siteId,
      siteId: bhw!.id,
      poNumber: "4500011111",
      plannedStart: "2026-05-22",
      plannedEnd: "2026-05-23",
      team: [
        { userId: lead.id, role: "team_leader" },
        { userId: engineer.id, role: "field_engineer" },
      ],
      items: [{ equipmentId }],
    },
    req,
  );
  const studyId = (await getJob(db, lead, job.id))!.studies[0]!.id;
  for (const key of ["protocol", "site_access", "previous_report"]) {
    await setReadiness(db, lead, job.id, { key, state: "ready", note: "" }, req);
  }
  await autoBook(db, lead, job.id, req);
  await saveLayout(db, engineer, studyId, await layoutTemplate(db, engineer, studyId), req);
  // Placed in the report's order: L-01 is 62281257 … L-09 is 62283563.
  for (const s of SERIALS) await placeLogger(db, engineer, studyId, { code: s }, req);
  // The report's study: 22 May 2026 22:30 to 23 May 22:30 (Indian time). The phone
  // refuses times over 30 days old, so this past study's times are written directly.
  for (const [kind, at] of [
    ["start", new Date("2026-05-22T22:30:00+05:30")],
    ["end", new Date("2026-05-23T22:30:00+05:30")],
  ] as const) {
    await db.insert(studyEvents).values({
      id: randomUUID(),
      organisationId: org.id,
      studyId,
      cycle: "routine",
      kind,
      at,
      byUserId: engineer.id,
    });
  }
  await db.update(studies).set({ status: "completed" }).where(eq(studies.id, studyId));
  await db.update(jobs).set({ status: "field_work" }).where(eq(jobs.id, job.id));
  const stored = await storeFile(db, blobs, {
    organisationId: lead.organisationId,
    actor: { type: "user", userId: lead.id },
    fileName: "BE-WF-02 raw data.xlsx",
    bytes: new Uint8Array(readFileSync(FILE)),
    maxBytes: 10 * 1024 * 1024,
  });
  if (!stored.ok) throw new Error(stored.message);
  await addDataFile(db, blobs, lead, studyId, { fileId: stored.file.id }, req);
  await markReceived(db, lead, studyId, req);
  return { lead, manager, studyId, jobId: job.id, companyId, blobs };
}
