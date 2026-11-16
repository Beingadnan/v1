/**
 * Seeds one TEST client whose company folder is full (ADR 0023), to look
 * around the folders: "TEST Folder Pharma Pvt Ltd" with two sites (regions),
 * departments, equipment, and studies whose reports the client signed in
 * different years and months, plus one study still in progress.
 *
 *   npm run db:seed-folder
 *
 * Acts as the one active admin. The reports are TEST placeholders (a one-page
 * PDF saying so), written straight to the database so they sit in the folder
 * without running field work; open them from the folder, not to re-sign.
 * Runs once: a second run stops without changing anything.
 */
import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createDatabase, createPool } from "@/db/client-factory";
import {
  clientCompanies,
  clientDepartments,
  clientSites,
  equipment,
  jobs,
  studies,
  studyAnalysisRuns,
  studyReports,
} from "@/db/schema";
import { LocalBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";
import { VercelBlobStore } from "@/lib/storage/vercel-blob-store";

import { importActor } from "./import-actor";

const CODE = "TFP";

type Eq = { code: string; name: string; type: string; min: string; max: string; dept: string };
const SITES: { name: string; code: string; city: string; depts: string[]; equipment: Eq[] }[] = [
  {
    name: "Taloja (West region)",
    code: "TLJ",
    city: "Navi Mumbai",
    depts: ["Quality Control", "Stores", "Microbiology"],
    equipment: [
      {
        code: "QC-RF-01",
        name: "QC Sample Refrigerator",
        type: "refrigerator",
        min: "2",
        max: "8",
        dept: "Quality Control",
      },
      {
        code: "QC-SC-02",
        name: "Stability Chamber 25/60",
        type: "stability_chamber",
        min: "23",
        max: "27",
        dept: "Quality Control",
      },
      {
        code: "ST-CR-01",
        name: "Cold Room",
        type: "cold_room",
        min: "2",
        max: "8",
        dept: "Stores",
      },
      {
        code: "ST-WH-01",
        name: "Finished Goods Warehouse",
        type: "warehouse",
        min: "15",
        max: "25",
        dept: "Stores",
      },
      {
        code: "MB-IN-01",
        name: "BOD Incubator",
        type: "incubator",
        min: "30",
        max: "35",
        dept: "Microbiology",
      },
      {
        code: "MB-DF-01",
        name: "Deep Freezer -20",
        type: "deep_freezer",
        min: "-25",
        max: "-15",
        dept: "Microbiology",
      },
    ],
  },
  {
    name: "Baddi (North region)",
    code: "BDI",
    city: "Baddi",
    depts: ["Production", "Warehouse"],
    equipment: [
      {
        code: "PR-CR-01",
        name: "Production Cold Room",
        type: "cold_room",
        min: "2",
        max: "8",
        dept: "Production",
      },
      {
        code: "WH-WF-01",
        name: "Walk-in Freezer",
        type: "walk_in_freezer",
        min: "-25",
        max: "-15",
        dept: "Warehouse",
      },
      {
        code: "WH-RM-02",
        name: "Raw Material Store",
        type: "warehouse",
        min: "15",
        max: "25",
        dept: "Warehouse",
      },
    ],
  },
];

/** When each equipment's report was signed: two years of yearly requalification. */
const SIGNED: Record<string, string[]> = {
  "QC-RF-01": ["2025-02-12", "2026-02-10"],
  "QC-SC-02": ["2025-05-20", "2026-05-18"],
  "ST-CR-01": ["2025-02-14", "2026-03-03"],
  "ST-WH-01": ["2025-06-02", "2025-11-21", "2026-06-05"],
  "MB-IN-01": ["2025-08-08", "2026-08-11"],
  "MB-DF-01": ["2026-02-10"],
  "PR-CR-01": ["2025-09-15", "2026-09-17"],
  "WH-WF-01": ["2025-12-04", "2026-10-06"],
  "WH-RM-02": ["2026-04-22"],
};
/** Mapped this month, report not signed yet: shows under In progress. */
const OPEN = ["ST-CR-01", "WH-WF-01"];

async function placeholderPdf(title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("TEST REPORT - placeholder for the company folder", {
    x: 50,
    y: 780,
    size: 14,
    font,
  });
  page.drawText(title, { x: 50, y: 750, size: 10, font });
  return doc.save();
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const blobs: BlobStore = token
    ? new VercelBlobStore(token)
    : new LocalBlobStore(process.env.STORAGE_LOCAL_DIR || "./.data/storage");
  const pool = createPool(url, 2);
  try {
    const db = createDatabase(pool);
    const actor = await importActor(db);
    const org = actor.organisationId;
    const [already] = await db
      .select({ id: clientCompanies.id })
      .from(clientCompanies)
      .where(and(eq(clientCompanies.organisationId, org), eq(clientCompanies.code, CODE)));
    if (already) {
      console.log(`TEST Folder Pharma is already there: /clients/${already.id}`);
      return;
    }

    const [company] = await db
      .insert(clientCompanies)
      .values({ organisationId: org, name: "TEST Folder Pharma Pvt Ltd", code: CODE })
      .returning();
    let jobNo = 0;
    let signedCount = 0;
    for (const s of SITES) {
      const [site] = await db
        .insert(clientSites)
        .values({
          organisationId: org,
          companyId: company!.id,
          name: s.name,
          code: s.code,
          city: s.city,
        })
        .returning();
      const deptId = new Map<string, string>();
      for (const d of s.depts) {
        const [row] = await db
          .insert(clientDepartments)
          .values({ organisationId: org, companyId: company!.id, siteId: site!.id, name: d })
          .returning();
        deptId.set(d, row!.id);
      }
      for (const e of s.equipment) {
        const dates = SIGNED[e.code] ?? [];
        const last = dates.at(-1) ?? null;
        const [eq_] = await db
          .insert(equipment)
          .values({
            organisationId: org,
            companyId: company!.id,
            siteId: site!.id,
            departmentId: deptId.get(e.dept)!,
            code: e.code,
            name: e.name,
            type: e.type,
            tempMinC: e.min,
            tempMaxC: e.max,
            lastStudyOn: last,
          })
          .returning();
        const visits = [...dates.map((d) => ({ on: d, signed: true }))];
        if (OPEN.includes(e.code)) visits.push({ on: "2026-11-10", signed: false });
        for (const v of visits) {
          jobNo += 1;
          const number = `TEST/${v.on.slice(0, 4)}/${String(jobNo).padStart(4, "0")}`;
          const [job] = await db
            .insert(jobs)
            .values({
              organisationId: org,
              number,
              companyId: company!.id,
              clientSiteId: site!.id,
              plannedStart: v.on,
              plannedEnd: v.on,
              status: v.signed ? "closed" : "field_work",
              title: "TEST",
            })
            .returning();
          const reportNumber = `${CODE}/${s.code}/${v.on.slice(5, 7)}/${v.on.slice(2, 4)}/${e.code}`;
          const [study] = await db
            .insert(studies)
            .values({
              organisationId: org,
              jobId: job!.id,
              equipmentId: eq_!.id,
              position: 1,
              workType: "temperature_mapping",
              reportNumber,
              loggerCount: 9,
              status: v.signed ? "completed" : "in_progress",
            })
            .returning();
          if (!v.signed) continue;
          const bytes = await placeholderPdf(`${reportNumber} · signed ${v.on}`);
          const stored = await storeFile(db, blobs, {
            organisationId: org,
            actor: { type: "user", userId: actor.id },
            fileName: `${e.code} report ${v.on}.pdf`,
            bytes,
            maxBytes: 10_000_000,
          });
          if (!stored.ok) throw new Error(stored.message);
          const [run] = await db
            .insert(studyAnalysisRuns)
            .values({
              organisationId: org,
              studyId: study!.id,
              runNo: 1,
              engineVersion: "test-seed",
              inputs: {} as never,
              inputHash: "test-seed",
              result: {} as never,
              byUserId: actor.id,
            })
            .returning();
          await db.insert(studyReports).values({
            organisationId: org,
            studyId: study!.id,
            rev: 0,
            status: "signed",
            fileId: stored.file.id,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            runId: run!.id,
            createdByUserId: actor.id,
            signedAt: new Date(`${v.on}T11:00:00+05:30`),
            signedVia: "paper",
          });
          signedCount += 1;
        }
      }
    }
    console.log(
      `TEST Folder Pharma: 2 sites, ${SITES.reduce((n, s) => n + s.equipment.length, 0)} equipment, ${signedCount} signed reports, ${OPEN.length} in progress.`,
    );
    console.log(`Open it: /clients/${company!.id}`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
