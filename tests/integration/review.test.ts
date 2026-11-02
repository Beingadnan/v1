/**
 * Phase 9 exit test: BE-WF-02's report goes Rev 00 → QA Tech's checker sends
 * it back → Done By and Checked By → released → the client returns it →
 * Rev 01 → the client's QA and QA head sign in the app. A second job closes
 * on paper. Every revision stays downloadable. Runs on QA Tech's own export
 * (fixtures/client; skipped without it).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditLog,
  certificates,
  deviations,
  jobs,
  signatures,
  studies,
  studyReports,
  users,
} from "@/db/schema";
import {
  approveAnalysis,
  assessDeviation,
  clientDecideDeviation,
  openDeviation,
  runAnalysis,
} from "@/domain/analysis/analysis-service";
import { clientDeviations, getClientDeviation } from "@/domain/analysis/client-deviations";
import { hashPassword } from "@/domain/auth/password";
import { ForbiddenError } from "@/domain/auth/permissions";
import { toSessionUser, type SessionUser } from "@/domain/auth/session-service";
import { createCompany } from "@/domain/clients/company-service";
import { attachCertificateFile } from "@/domain/instruments/certificate-service";
import {
  createReport,
  freezeReport,
  newRevision,
  openComments,
} from "@/domain/reports/report-service";
import {
  answerComment,
  checkReport,
  clientApprove,
  clientReturn,
  clientReview,
  recordPaperSignoff,
  releaseReport,
  reportDownload,
  returnForRework,
} from "@/domain/reports/review-service";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { BE_WF_02_FILE, BE_WF_02_PASSWORD, seedBeWf02 } from "../support/be-wf-02";
import { openTestDatabase } from "../support/test-db";

const { db, close } = openTestDatabase();
afterAll(close);
const req = { ipAddress: "203.0.113.99" };
const pw = { password: BE_WF_02_PASSWORD };
const APP = "https://qtech.example";

const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const textOf = (bytes: Uint8Array) => {
  const dir = mkdtempSync(path.join(tmpdir(), "qtech-review-"));
  const f = path.join(dir, "r.pdf");
  writeFileSync(f, bytes);
  return execFileSync("pdftotext", ["-layout", f, "-"]).toString();
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type World = {
  lead: SessionUser;
  manager: SessionUser;
  preparer: SessionUser;
  qa: SessionUser;
  head: SessionUser;
  stranger: SessionUser;
  studyId: string;
  jobId: string;
  blobs: BlobStore;
};

/** BE-WF-02 seeded, analysed and approved, the logger certificate's PDF attached, Rev 00 drafted. */
async function world(slug: string): Promise<World & { reportId: string }> {
  const seeded = await seedBeWf02(db, slug);
  const { lead, manager, studyId, jobId, companyId, blobs } = seeded;
  const passwordHash = await hashPassword(BE_WF_02_PASSWORD, { N: 1024, r: 8, p: 1 });
  const make = async (email: string, role: string, name: string, clientCompanyId?: string) => {
    const [row] = await db
      .insert(users)
      .values({
        organisationId: lead.organisationId,
        email,
        name,
        role,
        status: "active",
        passwordHash,
        clientCompanyId: clientCompanyId ?? null,
      })
      .returning();
    return toSessionUser(row!)!;
  };
  const preparer = await make(`rp@${slug}.test`, "report_preparer", "Mangesh Phalskar");
  const qa = await make(`qa@${slug}.test`, "client_qa", "Priya Nair", companyId);
  const head = await make(`head@${slug}.test`, "client_qa_head", "Sunil Deshmukh", companyId);
  const other = await createCompany(
    db,
    manager,
    {
      name: `Other Pharma ${slug}`,
      code: "Other",
      gstin: "",
      address: "",
      notes: "",
      postCalRequired: false,
      requalificationMonths: 12,
      reportNumberFormat: "{CLIENT}/{EQUIPMENT_ID}",
    },
    req,
  );
  const stranger = await make(`qa@other-${slug}.test`, "client_qa_head", "Other QA", other.id);

  const run = await runAnalysis(db, preparer, studyId, req);
  await approveAnalysis(db, lead, studyId, run.runId, req);
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
    .where(
      and(
        eq(certificates.number, "QATECH/BHIWANDI/04/26/PDL-77"),
        eq(certificates.organisationId, lead.organisationId),
      ),
    );
  await attachCertificateFile(db, lead, { certificateId: pdl77!.id, fileId: stored.file.id }, req);
  const reportId = (await createReport(db, preparer, studyId, req)).id;
  return {
    lead,
    manager,
    preparer,
    qa,
    head,
    stranger,
    studyId,
    jobId,
    blobs,
    reportId,
  };
}

const statusOf = async (id: string) =>
  (
    await db.select({ s: studyReports.status }).from(studyReports).where(eq(studyReports.id, id))
  )[0]!.s;
const jobStatusOf = async (id: string) =>
  (await db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, id)))[0]!.s;

describe.skipIf(!existsSync(BE_WF_02_FILE))("phase 9: review and sign-off in the app", () => {
  let w: World & { reportId: string };
  let rev1: string;

  beforeAll(async () => {
    w = await world("review-org");
  });

  it("signs Done By when the preparer freezes; a wrong password signs nothing", async () => {
    const bad = await freezeReport(db, w.blobs, w.preparer, w.reportId, { password: "nope" }, req);
    expect(bad).toEqual({ ok: false, message: "That password is incorrect. Nothing was signed." });
    expect(await statusOf(w.reportId)).toBe("draft");
    const failed = await db
      .select({ a: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, w.preparer.id), eq(auditLog.action, "signature.failed")));
    expect(failed).toHaveLength(1);

    const ok = await freezeReport(db, w.blobs, w.preparer, w.reportId, pw, req);
    expect(ok.ok).toBe(true);
    expect(await statusOf(w.reportId)).toBe("checking");
    const sig = await db
      .select()
      .from(signatures)
      .where(and(eq(signatures.entityType, "report"), eq(signatures.entityId, w.reportId)));
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({
      meaning: "done_by",
      signerName: "Mangesh Phalskar",
      signerRole: "Report preparer",
      recordHash: ok.ok ? ok.sha256 : "",
    });
  });

  it("the checker sends it back with comments pinned to sections; the preparer must answer them", async () => {
    await expect(
      returnForRework(db, w.preparer, w.reportId, { comments: [] }, req),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(returnForRework(db, w.lead, w.reportId, { comments: [] }, req)).rejects.toThrow(
      "Add at least one comment",
    );
    await returnForRework(
      db,
      w.lead,
      w.reportId,
      {
        comments: [
          { section: "details", page: 3, body: "Department should be Stores, not Warehouse." },
        ],
      },
      req,
    );
    expect(await statusOf(w.reportId)).toBe("draft");
    expect(await jobStatusOf(w.jobId)).toBe("rework");
    await expect(freezeReport(db, w.blobs, w.preparer, w.reportId, pw, req)).rejects.toThrow(
      "Answer the review comment first",
    );
    const [c] = await openComments(db, w.studyId);
    await answerComment(db, w.preparer, c!.id, "Fixed: department corrected in equipment.", req);
    await expect(answerComment(db, w.preparer, c!.id, "Again", req)).rejects.toThrow(
      "already answered",
    );
  });

  it("no one checks their own report: the lead who signed Done By can't sign Checked By", async () => {
    // This time the team leader prepares it.
    const done = await freezeReport(db, w.blobs, w.lead, w.reportId, pw, req);
    expect(done.ok).toBe(true);
    await expect(checkReport(db, w.lead, w.reportId, pw, req)).rejects.toThrow(
      "You signed Done By on this revision.",
    );
    const bad = await checkReport(db, w.manager, w.reportId, { password: "wrong" }, req);
    expect(bad.ok).toBe(false);
    expect((await checkReport(db, w.manager, w.reportId, pw, req)).ok).toBe(true);
    expect(await statusOf(w.reportId)).toBe("checked");
    expect(await jobStatusOf(w.jobId)).toBe("checked");
  });

  it("releases to the client's QA and QA head with a ready email; other companies can't be picked", async () => {
    await expect(
      releaseReport(db, w.lead, w.reportId, { to: [w.stranger.id] }, APP, req),
    ).rejects.toThrow(/Pick active client users of/);
    const mail = await releaseReport(
      db,
      w.lead,
      w.reportId,
      { to: [w.qa.id, w.head.id] },
      APP,
      req,
    );
    expect(mail.to).toHaveLength(2);
    expect(mail.to).toEqual(expect.arrayContaining([w.qa.email, w.head.email]));
    expect(mail.link).toBe(`${APP}/client/reports/${w.reportId}`);
    expect(mail.subject).toMatch(/Rev 00 for review \(BE-WF-02\)/);
    expect(await statusOf(w.reportId)).toBe("released");
    expect(await jobStatusOf(w.jobId)).toBe("sent_to_client");
  });

  it("another company's QA can't see or sign it; client QA can't approve", async () => {
    await expect(clientReview(db, w.stranger, w.reportId, pw, req)).rejects.toThrow(
      "That report does not exist.",
    );
    expect(await reportDownload(db, w.blobs, w.stranger, w.reportId)).toBeNull();
    await expect(clientApprove(db, w.blobs, w.qa, w.reportId, pw, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // QA Tech staff can't sign for the client.
    await expect(clientReview(db, w.lead, w.reportId, pw, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("the client returns Rev 00; Rev 01 answers it and goes through the same steps", async () => {
    await clientReturn(
      db,
      w.head,
      w.reportId,
      {
        comments: [
          { section: "conclusion", page: null, body: "Please mention the door-open excursion." },
        ],
      },
      req,
    );
    expect(await statusOf(w.reportId)).toBe("returned");
    expect(await jobStatusOf(w.jobId)).toBe("rework");
    const r1 = await newRevision(
      db,
      w.preparer,
      w.studyId,
      "Client asked to mention the door excursion",
      req,
    );
    rev1 = r1.id;
    await expect(freezeReport(db, w.blobs, w.preparer, rev1, pw, req)).rejects.toThrow(
      "Answer the review comment first",
    );
    const [c] = await openComments(db, w.studyId);
    expect(c!.side).toBe("client");
    await answerComment(db, w.preparer, c!.id, "Fixed: conclusion now names the excursion.", req);
    expect((await freezeReport(db, w.blobs, w.preparer, rev1, pw, req)).ok).toBe(true);
    expect(await statusOf(w.reportId)).toBe("superseded");
    expect((await checkReport(db, w.lead, rev1, pw, req)).ok).toBe(true);
    await releaseReport(db, w.lead, rev1, { to: [w.qa.id, w.head.id] }, APP, req);
    expect(await jobStatusOf(w.jobId)).toBe("sent_to_client");
  });

  it("the client's QA reviews and the QA head approves: the issued copy is stored and the study archived", async () => {
    await expect(clientApprove(db, w.blobs, w.head, rev1, pw, req)).rejects.toThrow(
      "Approving it isn't possible: Rev 01 is with the client.",
    );
    expect((await clientReview(db, w.qa, rev1, pw, req)).ok).toBe(true);
    expect((await clientApprove(db, w.blobs, w.head, rev1, pw, req)).ok).toBe(true);
    const [r] = await db.select().from(studyReports).where(eq(studyReports.id, rev1));
    expect(r).toMatchObject({ status: "signed", signedVia: "app" });
    expect(r!.signedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await jobStatusOf(w.jobId)).toBe("client_signed");
    const [s] = await db
      .select({ a: studies.archivedAt })
      .from(studies)
      .where(eq(studies.id, w.studyId));
    expect(s!.a).not.toBeNull();

    const issued = (await reportDownload(db, w.blobs, w.qa, rev1))!;
    expect(sha(issued.bytes)).toBe(r!.signedSha256);
    const frozen = (await reportDownload(db, w.blobs, w.qa, rev1, "frozen"))!;
    expect(sha(frozen.bytes)).toBe(r!.sha256);
    // REPORT_OUT=/some/dir keeps the issued copy for a look.
    if (process.env.REPORT_OUT)
      writeFileSync(path.join(process.env.REPORT_OUT, "issued.pdf"), issued.bytes);
    const issuedDoc = await PDFDocument.load(issued.bytes);
    expect(issuedDoc.getPageCount()).toBe(r!.pages! + 1);
    if (hasPdftotext) {
      const text = textOf(issued.bytes);
      expect(text).toContain("Electronic signatures");
      expect(text).toContain(r!.sha256!);
      for (const name of ["MANGESH PHALSKAR", "LEAD", "PRIYA NAIR", "SUNIL DESHMUKH"]) {
        expect(text).toContain(name);
      }
      expect(text).toContain("Signed electronically");
      expect(text).toMatch(/Approved By\s+Sunil Deshmukh/);
      expect(text).toContain("Client QA head");
    }
  });

  it("keeps both revisions downloadable, each with its own signatures", async () => {
    const old = (await reportDownload(db, w.blobs, w.lead, w.reportId))!;
    const [r0] = await db.select().from(studyReports).where(eq(studyReports.id, w.reportId));
    expect(r0!.status).toBe("superseded");
    expect(sha((await reportDownload(db, w.blobs, w.lead, w.reportId, "frozen"))!.bytes)).toBe(
      r0!.sha256,
    );
    if (hasPdftotext) {
      const text = textOf(old.bytes);
      expect(text).toContain("Checked By");
      expect(text).not.toContain("Sunil Deshmukh");
    }
    // The same signatures always make the same copy.
    const again = (await reportDownload(db, w.blobs, w.lead, w.reportId))!;
    expect(sha(again.bytes)).toBe(sha(old.bytes));
  });

  it("audits every step", async () => {
    const actions = (
      await db
        .select({ a: auditLog.action })
        .from(auditLog)
        .where(
          sql`${auditLog.organisationId} = ${w.lead.organisationId} and ${auditLog.action} like 'report.%'`,
        )
    ).map((x) => x.a);
    expect(actions).toEqual(
      expect.arrayContaining([
        "report.frozen",
        "report.returned",
        "report.comment_answered",
        "report.checked",
        "report.released",
        "report.client_returned",
        "report.client_reviewed",
        "report.client_approved",
        "report.issued_copy_stored",
      ]),
    );
  });
});

describe.skipIf(!existsSync(BE_WF_02_FILE))("phase 9: the paper route", () => {
  let w: World & { reportId: string };

  beforeAll(async () => {
    w = await world("paper-org");
    expect((await freezeReport(db, w.blobs, w.preparer, w.reportId, pw, req)).ok).toBe(true);
    expect((await checkReport(db, w.lead, w.reportId, pw, req)).ok).toBe(true);
  });

  it("records the client's ink signatures with the scan, linked by hash", async () => {
    const scanDoc = await PDFDocument.create();
    scanDoc.addPage([595.28, 841.89]).drawText("Signed scan (test)");
    const scan = await storeFile(db, w.blobs, {
      organisationId: w.lead.organisationId,
      actor: { type: "user", userId: w.lead.id },
      fileName: "signed.pdf",
      bytes: await scanDoc.save(),
      maxBytes: 10 * 1024 * 1024,
    });
    if (!scan.ok) throw new Error(scan.message);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const base = {
      fileId: scan.file.id,
      reviewedByName: "Priya Nair",
      reviewedOn: today,
      approvedByName: "Sunil Deshmukh",
      approvedByTitle: "QA Head",
      approvedOn: today,
    };
    await expect(recordPaperSignoff(db, w.preparer, w.reportId, base, req)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      recordPaperSignoff(db, w.lead, w.reportId, { ...base, approvedOn: "2099-01-01" }, req),
    ).rejects.toThrow("A signature date is in the future.");
    await expect(
      recordPaperSignoff(db, w.lead, w.reportId, { ...base, reviewedOn: "2020-01-01" }, req),
    ).rejects.toThrow("Reviewed By is dated before QA Tech checked the report");
    const [r] = await db.select().from(studyReports).where(eq(studyReports.id, w.reportId));
    const [frozenFile] = await db
      .select({ id: sql<string>`id` })
      .from(sql`stored_files`)
      .where(sql`sha256 = ${r!.sha256}`);
    await expect(
      recordPaperSignoff(db, w.lead, w.reportId, { ...base, fileId: frozenFile!.id }, req),
    ).rejects.toThrow("That is the unsigned report itself.");

    await recordPaperSignoff(db, w.lead, w.reportId, base, req);
    const [after] = await db.select().from(studyReports).where(eq(studyReports.id, w.reportId));
    expect(after).toMatchObject({ status: "signed", signedVia: "paper", signedFileId: null });
    expect(await jobStatusOf(w.jobId)).toBe("client_signed");
    const got = (await reportDownload(db, w.blobs, w.lead, w.reportId, "scan"))!;
    expect(got.sha256).toBe(scan.file.sha256);
    expect(got.fileName).toMatch(/signed scan\.pdf$/);
    await expect(recordPaperSignoff(db, w.lead, w.reportId, base, req)).rejects.toThrow(
      "isn't possible: Rev 00 is signed.",
    );
  });
});

describe.skipIf(!existsSync(BE_WF_02_FILE))(
  "phase 9: the client QA head decides a deviation",
  () => {
    let w: World & { reportId: string };
    let deviationId: string;

    beforeAll(async () => {
      w = await world("deviation-org");
      const d = await openDeviation(
        db,
        w.lead,
        w.studyId,
        { title: "Door left open during loading", description: "Seen on the site log." },
        req,
      );
      deviationId = d.id;
    });

    it("isn't shown to the client before QA Tech's assessment", async () => {
      expect(await clientDeviations(db, w.head)).toEqual([]);
      expect(await getClientDeviation(db, w.head, deviationId)).toBeNull();
      await assessDeviation(
        db,
        w.lead,
        deviationId,
        { assessment: "Door open 20 min during loading; all loggers stayed within limits." },
        req,
      );
      expect((await clientDeviations(db, w.head)).map((d) => d.id)).toEqual([deviationId]);
      expect(await clientDeviations(db, w.stranger)).toEqual([]);
    });

    it("is signed by the QA head, not by client QA or another company", async () => {
      await expect(
        clientDecideDeviation(
          db,
          w.qa,
          deviationId,
          { decision: "no_impact" },
          BE_WF_02_PASSWORD,
          req,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        clientDecideDeviation(
          db,
          w.stranger,
          deviationId,
          { decision: "no_impact" },
          BE_WF_02_PASSWORD,
          req,
        ),
      ).rejects.toThrow("That deviation does not exist.");
      await expect(
        clientDecideDeviation(
          db,
          w.head,
          deviationId,
          { decision: "exclude_probe" },
          BE_WF_02_PASSWORD,
          req,
        ),
      ).rejects.toThrow("no probe can be excluded");
      const bad = await clientDecideDeviation(
        db,
        w.head,
        deviationId,
        { decision: "no_impact" },
        "wrong",
        req,
      );
      expect(bad.ok).toBe(false);
      const ok = await clientDecideDeviation(
        db,
        w.head,
        deviationId,
        { decision: "no_impact", note: "Accepted per door log." },
        BE_WF_02_PASSWORD,
        req,
      );
      expect(ok.ok).toBe(true);
      const [d] = await db.select().from(deviations).where(eq(deviations.id, deviationId));
      expect(d).toMatchObject({
        decision: "no_impact",
        decidedByName: "Sunil Deshmukh",
        decidedByTitle: "Client QA head",
        decisionNote: "Accepted per door log.",
      });
      expect(d!.closedAt).not.toBeNull();
      const [g] = await db
        .select()
        .from(signatures)
        .where(eq(signatures.id, d!.decisionSignatureId!));
      expect(g).toMatchObject({ meaning: "deviation_decision", entityId: deviationId });
      await expect(
        clientDecideDeviation(
          db,
          w.head,
          deviationId,
          { decision: "no_impact" },
          BE_WF_02_PASSWORD,
          req,
        ),
      ).rejects.toThrow("was already closed");
    });
  },
);
