/**
 * Phase 7 exit test on QA Tech's own data: BE-WF-02's logger export
 * (fixtures/client, git-ignored; skipped without it) uploaded to a study
 * with the report's nine loggers, confirmed and analysed, gives page 5 of
 * the issued report: every minimum, maximum and average, L-05 the hot spot
 * (−16.7) and L-04 the cold spot (−21.9).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jobs, sites, studies, studyEvents, users } from "@/db/schema";
import { ensureOrganisation } from "@/db/seed/ensure-organisation";
import { runAnalysis } from "@/domain/analysis/analysis-service";
import { getStudyAnalysis } from "@/domain/analysis/queries";
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
import { LocalBlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { openTestDatabase } from "../support/test-db";

const FILE = path.resolve(__dirname, "../../fixtures/client/BE-WF-02 raw data.xlsx");
const SERIALS = [
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
// Page 5 of the issued report: position, min, max, average (°C).
const PAGE5: [string, number, number, number][] = [
  ["L-01", -22.9, -17.9, -21.0],
  ["L-02", -23.4, -18.7, -21.8],
  ["L-03", -22.8, -18.5, -21.7],
  ["L-04", -23.0, -20.0, -21.9],
  ["L-05", -17.6, -15.0, -16.7],
  ["L-06", -21.9, -19.0, -21.1],
  ["L-07", -23.0, -17.8, -21.1],
  ["L-08", -23.3, -15.0, -19.7],
  ["L-09", -22.9, -18.7, -21.3],
];
const r1 = (v: number) => Math.round(v * 10) / 10;

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.92" };
let lead: SessionUser;
let studyId: string;

describe.skipIf(!existsSync(FILE))("BE-WF-02, QA Tech's own export, end to end", () => {
  beforeAll(async () => {
    const blobs = new LocalBlobStore(await mkdtemp(path.join(tmpdir(), "qtech-be-wf-02-")));
    const org = (await ensureOrganisation(db, { slug: "real-file-org", name: "QA Tech Real" }))
      .organisation;
    const make = async (email: string, role: string, name: string) => {
      const [row] = await db
        .insert(users)
        .values({ organisationId: org.id, email, name, role, status: "active", passwordHash: "x" })
        .returning();
      return toSessionUser(row!)!;
    };
    const manager = await make("mgr@real.test", "manager", "Manager");
    lead = await make("tl@real.test", "team_leader", "Lead");
    const engineer = await make("fe@real.test", "field_engineer", "Engineer");
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
    studyId = (await getJob(db, lead, job.id))!.studies[0]!.id;
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
  });

  afterAll(close);

  it("matches every number on page 5, with L-05 hot and L-04 cold", async () => {
    await runAnalysis(db, lead, studyId, req);
    const a = (await getStudyAnalysis(db, lead, studyId))!;
    const c = a.run!.result.cycles[0]!;
    expect(c.positions.map((p) => p.temp!.count)).toEqual(Array(9).fill(145));
    expect(
      c.positions.map((p) => [p.label, r1(p.temp!.min), r1(p.temp!.max), r1(p.temp!.avg)]),
    ).toEqual(PAGE5);
    expect(c.hot).toMatchObject({ label: "L-05" });
    expect(r1(c.hot!.avg)).toBe(-16.7);
    expect(c.cold).toMatchObject({ label: "L-04" });
    expect(r1(c.cold!.avg)).toBe(-21.9);
    // −15.0 at L-05 and L-08 is on the limit, not over it: within limits, no excursion.
    expect(c.excursions).toEqual([]);
    expect(c.pass).toBe(true);
  });
});
