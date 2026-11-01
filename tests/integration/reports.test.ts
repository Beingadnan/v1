/**
 * Phase 8: the report preparer drafts BE-WF-02's report (FT-09) from the
 * approved analysis, edits the conclusion, freezes Rev 00, and later issues
 * Rev 01. Runs on QA Tech's own export (fixtures/client; skipped without it).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, certificates, jobs, studyReports, users } from "@/db/schema";
import { approveAnalysis, runAnalysis } from "@/domain/analysis/analysis-service";
import { attachCertificateFile } from "@/domain/instruments/certificate-service";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import {
  createReport,
  editReportText,
  freezeReport,
  frozenReport,
  newRevision,
  previewReport,
} from "@/domain/reports/report-service";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { BE_WF_02_FILE, seedBeWf02 } from "../support/be-wf-02";
import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.93" };
let lead: SessionUser;
let preparer: SessionUser;
let accounts: SessionUser;
let studyId: string;
let jobId: string;
let blobs: BlobStore;
let reportId: string;

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
let seen = 0;
const textOf = (bytes: Uint8Array) => {
  const dir = mkdtempSync(path.join(tmpdir(), "qtech-report-"));
  const f = path.join(dir, "r.pdf");
  writeFileSync(f, bytes);
  // REPORT_OUT=/some/dir keeps each PDF for a look (report-1.pdf, report-2.pdf…).
  if (process.env.REPORT_OUT)
    writeFileSync(path.join(process.env.REPORT_OUT, `report-${(seen += 1)}.pdf`), bytes);
  return execFileSync("pdftotext", ["-layout", f, "-"]).toString();
};
const jobStatus = async () =>
  (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, jobId)))[0]!.s;

describe.skipIf(!existsSync(BE_WF_02_FILE))("phase 8: the BE-WF-02 report", () => {
  beforeAll(async () => {
    const seeded = await seedBeWf02(db, "reports-org");
    ({ lead, studyId, jobId, blobs } = seeded);
    const make = async (email: string, role: string, name: string) => {
      const [row] = await db
        .insert(users)
        .values({
          organisationId: lead.organisationId,
          email,
          name,
          role,
          status: "active",
          passwordHash: "x",
        })
        .returning();
      return toSessionUser(row!)!;
    };
    preparer = await make("rp@reports-org.test", "report_preparer", "Mangesh Phalskar");
    accounts = await make("acc@reports-org.test", "accounts", "Accounts");
  });

  afterAll(close);

  it("can't be drafted before the analysis is approved", async () => {
    await expect(createReport(db, preparer, studyId, req)).rejects.toThrow(
      "The analysis isn't approved yet (Analysis tab).",
    );
    const run = await runAnalysis(db, preparer, studyId, req);
    await approveAnalysis(db, lead, studyId, run.runId, req);
    await expect(createReport(db, accounts, studyId, req)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("drafts Rev 00 from the approved run and moves the job to Report draft", async () => {
    reportId = (await createReport(db, preparer, studyId, req)).id;
    expect(await jobStatus()).toBe("report_draft");
    await expect(createReport(db, preparer, studyId, req)).rejects.toThrow(
      "Rev 00 is already being drafted.",
    );
  });

  it.skipIf(!hasPdftotext)(
    "prints page 5's numbers, the hot and cold spots and the wording of page 6, marked DRAFT",
    async () => {
      const p = (await previewReport(db, blobs, preparer, reportId))!;
      const text = textOf(p.bytes);
      expect(text).toContain("DRAFT");
      expect(text).toContain("Equipment & Mapping Details");
      expect(text).toContain("Diagram Indicating Sensors Positions");
      expect(text).toContain("TEMPERATURE V/S TIME");
      // Page 5, row by row.
      for (const [pos, min, max, avg] of [
        ["L-01", "-22.9", "-17.9", "-21.0"],
        ["L-04", "-23.0", "-20.0", "-21.9"],
        ["L-05", "-17.6", "-15.0", "-16.7"],
        ["L-08", "-23.3", "-15.0", "-19.7"],
      ]) {
        expect(text).toMatch(new RegExp(`${pos}\\s+${min}\\s+${max}\\s+${avg}`));
      }
      expect(text).toMatch(/Average Minimum Temperature at\s+L-04\s+-21\.9/);
      expect(text).toMatch(/Average Maximum Temperature at\s+L-05\s+-16\.7/);
      expect(text).toContain("L-04 (62220170)");
      expect(text).toContain("L-05 (62283645)");
      expect(text.replace(/\s+/g, " ")).toContain("qualified for its further use");
      expect(text).toContain("-15°C To -25°C");
      expect(text).toContain("QATM/PVAL/FT-09");
      expect(text).toMatch(/Page 1 of \d+/);
      // Raw data: 145 rows, with the summary rows at the end.
      expect(text).toContain("22.05.2026");
      expect(text).toMatch(/MINIMUM/);
      // Index: page numbers worked out.
      expect(text).toMatch(/Diagram Indicating Sensor Positions\s+4/);
    },
  );

  it("audits edits to the conclusion and resets to the template", async () => {
    await expect(
      editReportText(db, preparer, reportId, { section: "conclusion", text: "ok" }, req),
    ).rejects.toThrow("Write at least a sentence");
    await editReportText(
      db,
      preparer,
      reportId,
      {
        section: "conclusion",
        text: "The Walk In Freezer (BE-WF-02) meets the acceptance criteria (-15°C To -25°C) and is qualified for its further use.",
      },
      req,
    );
    await editReportText(db, preparer, reportId, { section: "conclusion", text: null }, req);
    const rows = await db
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organisationId, lead.organisationId),
          eq(auditLog.action, "report.text_edited"),
        ),
      )
      .orderBy(auditLog.id);
    expect(rows.map((r) => r.summary)).toEqual([
      expect.stringMatching(/^Mangesh Phalskar edited the conclusion of .* Rev 00$/),
      expect.stringMatching(/^Mangesh Phalskar reset the conclusion of .* Rev 00$/),
    ]);
  });

  it("refuses to freeze while a certificate's PDF is missing", async () => {
    await expect(freezeReport(db, blobs, preparer, reportId, req)).rejects.toThrow(
      /These certificates have no PDF on file: QATECH\/BHIWANDI\/04\/26\/PDL-77/,
    );
  });

  it("freezes Rev 00 once: the stored PDF is byte-identical with its SHA-256, and can't be edited", async () => {
    // The lab's certificate PDF arrives.
    const cert = await PDFDocument.create();
    cert.addPage([595.28, 841.89]).drawText("PDL-77 certificate (test)");
    const stored = await storeFile(db, blobs, {
      organisationId: lead.organisationId,
      actor: { type: "user", userId: lead.id },
      fileName: "PDL-77.pdf",
      bytes: await cert.save(),
      maxBytes: 10 * 1024 * 1024,
    });
    if (!stored.ok) throw new Error(stored.message);
    const [pdl77] = await db
      .select({ id: certificates.id })
      .from(certificates)
      .where(eq(certificates.number, "QATECH/BHIWANDI/04/26/PDL-77"));
    await expect(
      attachCertificateFile(
        db,
        accounts,
        { certificateId: pdl77!.id, fileId: stored.file.id },
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await attachCertificateFile(
      db,
      lead,
      { certificateId: pdl77!.id, fileId: stored.file.id },
      req,
    );
    await expect(
      attachCertificateFile(db, lead, { certificateId: pdl77!.id, fileId: stored.file.id }, req),
    ).rejects.toThrow("QATECH/BHIWANDI/04/26/PDL-77 already has its PDF.");

    const f = await freezeReport(db, blobs, preparer, reportId, req);
    expect(f.rev).toBe(0);
    const pdf = (await frozenReport(db, blobs, preparer, reportId))!;
    expect(createHash("sha256").update(pdf.bytes).digest("hex")).toBe(f.sha256);
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBe(f.pages);
    if (hasPdftotext) {
      const text = textOf(pdf.bytes);
      expect(text).not.toContain("DRAFT");
      expect(text).toContain("PDL-77 certificate (test)");
      expect(text).toContain("MANGESH PHALSKAR");
    }
    await expect(
      editReportText(
        db,
        preparer,
        reportId,
        { section: "observation", text: "Changed after freezing." },
        req,
      ),
    ).rejects.toThrow("Rev 00 is frozen and can't be changed.");
    await expect(freezeReport(db, blobs, preparer, reportId, req)).rejects.toThrow(
      "Rev 00 is already frozen.",
    );
  });

  it("issues Rev 01 with a reason, and Rev 00 becomes superseded", async () => {
    await expect(newRevision(db, preparer, studyId, "no", req)).rejects.toThrow(
      "Say why the report is revised.",
    );
    const r1 = await newRevision(
      db,
      preparer,
      studyId,
      "Client asked to correct the department name",
      req,
    );
    expect(r1.rev).toBe(1);
    await freezeReport(db, blobs, preparer, r1.id, req);
    const rows = await db
      .select({ rev: studyReports.rev, status: studyReports.status, reason: studyReports.reason })
      .from(studyReports)
      .where(eq(studyReports.studyId, studyId))
      .orderBy(studyReports.rev);
    expect(rows).toEqual([
      { rev: 0, status: "superseded", reason: "" },
      { rev: 1, status: "frozen", reason: "Client asked to correct the department name" },
    ]);
    const actions = (
      await db
        .select({ a: auditLog.action })
        .from(auditLog)
        .where(
          sql`${auditLog.organisationId} = ${lead.organisationId} and ${auditLog.action} like 'report.%'`,
        )
    ).map((x) => x.a);
    expect(actions).toEqual(
      expect.arrayContaining([
        "report.created",
        "report.text_edited",
        "report.frozen",
        "report.revision_started",
      ]),
    );
  });
});
