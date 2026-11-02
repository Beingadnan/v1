import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientCompanies,
  equipment,
  jobs,
  organisationSettings,
  reportComments,
  reportPaperSignoffs,
  signatures,
  storedFiles,
  studies,
  studyReports,
  users,
  type Job,
  type Study,
  type StudyReport,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import { isClientRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { signRecordTx } from "@/domain/auth/signature-service";
import { isUuid } from "@/domain/clients/shared";
import { lockJob } from "@/domain/jobs/job-service";
import { JOB_STATUS_LABELS, type JobStatus } from "@/domain/jobs/types";
import { jobLeads, notify } from "@/domain/notifications/notify";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { ReportsError } from "./errors";
import { syncJobToReports } from "./job-sync";
import type { SignOutcome } from "./report-service";
import { signedCopy, type PrintedSignature } from "./signed-copy";
import {
  REPORT_SECTIONS,
  REPORT_STATUS_LABELS,
  revLabel,
  type CommentSide,
  type ReportStatus,
} from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

type Loaded = { r: StudyReport; study: Study; job: Job; code: string; company: string };

/** Loads and locks a frozen revision with its study and job. Client users see only their company's. */
async function loadReport(tx: Transaction, actor: SessionUser, reportId: string): Promise<Loaded> {
  if (!isUuid(reportId)) throw new ReportsError("That report does not exist.");
  const [head] = await tx
    .select({ studyId: studyReports.studyId, jobId: studies.jobId })
    .from(studyReports)
    .innerJoin(studies, eq(studies.id, studyReports.studyId))
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    );
  if (!head) throw new ReportsError("That report does not exist.");
  const job = await lockJob(tx, actor, head.jobId);
  if (isClientRole(actor.role) && actor.clientCompanyId !== job.companyId) {
    throw new ReportsError("That report does not exist.");
  }
  const [r] = await tx
    .select()
    .from(studyReports)
    .where(eq(studyReports.id, reportId))
    .for("update");
  const [row] = await tx
    .select({ study: studies, code: equipment.code, company: clientCompanies.name })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, job.companyId))
    .where(eq(studies.id, head.studyId));
  if (!r || !row) throw new ReportsError("That report does not exist.");
  if (["on_hold", "cancelled"].includes(job.status)) {
    throw new ReportsError(
      `Job ${job.number} is ${JOB_STATUS_LABELS[job.status as JobStatus].toLowerCase()}.`,
    );
  }
  return { r, study: row.study, job, code: row.code, company: row.company };
}

function assertStatus(l: Loaded, allowed: ReportStatus[], what: string) {
  const s = l.r.status as ReportStatus;
  if (!allowed.includes(s)) {
    throw new ReportsError(
      `${what} isn't possible: ${revLabel(l.r.rev)} is ${REPORT_STATUS_LABELS[s].toLowerCase()}.`,
    );
  }
}

/** A client user acts only on their own company's reports. */
function assertClient(actor: SessionUser) {
  if (!isClientRole(actor.role) || !actor.clientCompanyId) {
    throw new ReportsError("Only the client's QA can do this.");
  }
}

/** The signatures given on the revision's current frozen PDF, oldest first. */
export async function reportSignatures(db: Database | Transaction, r: StudyReport) {
  if (!r.sha256) return [];
  return db
    .select({
      id: signatures.id,
      userId: signatures.userId,
      meaning: signatures.meaning,
      name: signatures.signerName,
      role: signatures.signerRole,
      signedAt: signatures.signedAt,
      clientCompanyId: users.clientCompanyId,
    })
    .from(signatures)
    .innerJoin(users, eq(users.id, signatures.userId))
    .where(
      and(
        eq(signatures.entityType, "report"),
        eq(signatures.entityId, r.id),
        eq(signatures.recordHash, r.sha256),
      ),
    )
    .orderBy(asc(signatures.signedAt));
}

async function sign(
  tx: Transaction,
  actor: SessionUser,
  l: Loaded,
  meaning: "checked_by" | "reviewed_by" | "approved_by",
  password: string,
  request?: RequestInfo,
) {
  if (!password) throw new ReportsError("Enter your password to sign.");
  return signRecordTx(
    tx,
    actor,
    { meaning, entityType: "report", entityId: l.r.id, recordHash: l.r.sha256!, password },
    request ?? {},
  );
}

// --------------------------------------------------------------- comments

const commentSchema = z.object({
  section: z.enum(REPORT_SECTIONS),
  page: z.coerce.number().int().min(1).max(2000).nullable().default(null),
  body: z.string().trim().min(5, "Say what needs changing.").max(2000),
});
const returnSchema = z.object({
  comments: z.array(commentSchema).min(1, "Add at least one comment: what needs changing.").max(50),
});

async function addComments(
  tx: Transaction,
  actor: SessionUser,
  l: Loaded,
  comments: z.infer<typeof commentSchema>[],
  side: CommentSide,
) {
  await tx.insert(reportComments).values(
    comments.map((c) => ({
      organisationId: actor.organisationId,
      studyId: l.study.id,
      reportId: l.r.id,
      section: c.section,
      page: c.page,
      body: c.body,
      side,
      byUserId: actor.id,
    })),
  );
}

/**
 * QA Tech's checker sends a revision back to the preparer, with comments
 * pinned to sections. The same revision goes back to draft: the frozen PDF
 * and its Done By signature stay on record, and the next submit makes a new
 * PDF with a new hash.
 */
export async function returnForRework(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.check");
  const v = returnSchema.parse(input);
  return db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["checking"], "Returning it");
    await addComments(tx, actor, l, v.comments, "qa_tech");
    await tx
      .update(studyReports)
      .set({
        status: "draft",
        runId: null,
        fileId: null,
        sha256: null,
        pages: null,
        layout: null,
        frozenByUserId: null,
        frozenAt: null,
      })
      .where(eq(studyReports.id, l.r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.returned",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} returned ${l.study.reportNumber} ${revLabel(l.r.rev)} to the preparer with ${v.comments.length} comment${v.comments.length === 1 ? "" : "s"}`,
      before: { status: "checking", sha256: l.r.sha256 },
      after: { status: "draft", comments: v.comments },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: [l.r.createdByUserId, l.r.frozenByUserId],
      except: actor.id,
      kind: "report_returned",
      title: `${l.code} ${revLabel(l.r.rev)} came back from the checker`,
      body: `${actor.name}: ${v.comments.map((c) => c.body).join(" / ")}`,
      href: `/studies/${l.study.id}?tab=report`,
    });
    await syncJobToReports(
      tx,
      actor,
      l.job,
      `${l.study.reportNumber} returned for rework`,
      request,
      {
        rework: true,
      },
    );
  });
}

/** The preparer says what was done about a comment; every comment needs an answer before the next submit. */
export async function answerComment(
  db: Database,
  actor: SessionUser,
  commentId: string,
  answer: string,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.prepare");
  const text = z
    .string()
    .trim()
    .min(3, "Say what was done, e.g. Fixed: department name corrected.")
    .max(2000)
    .parse(answer);
  if (!isUuid(commentId)) throw new ReportsError("That comment does not exist.");
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(reportComments)
      .where(
        and(
          eq(reportComments.id, commentId),
          eq(reportComments.organisationId, actor.organisationId),
        ),
      )
      .for("update");
    if (!c) throw new ReportsError("That comment does not exist.");
    if (c.answer) throw new ReportsError("That comment was already answered.");
    await tx
      .update(reportComments)
      .set({ answer: text, answeredByUserId: actor.id, answeredAt: new Date() })
      .where(eq(reportComments.id, c.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.comment_answered",
      entityType: "study",
      entityId: c.studyId,
      summary: `${actor.name} answered a review comment: ${text.slice(0, 120)}`,
      before: { comment: c.body },
      after: { answer: text },
      request,
    });
  });
}

// ---------------------------------------------------------------- checker

/** QA Tech's checker signs Checked By. The preparer can't check their own report. */
export async function checkReport(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: { password: string },
  request?: RequestInfo,
): Promise<SignOutcome<object>> {
  assertCan(actor, "reports.check");
  return db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["checking"], "Checking it");
    const done = (await reportSignatures(tx, l.r)).find((s) => s.meaning === "done_by");
    if (done?.userId === actor.id) {
      throw new ReportsError(
        "You signed Done By on this revision. Another checker must sign Checked By.",
      );
    }
    const signed = await sign(tx, actor, l, "checked_by", input.password, request);
    if (!signed.ok) return { ok: false as const, message: signed.message };
    await tx
      .update(studyReports)
      .set({ status: "checked", checkedAt: new Date() })
      .where(eq(studyReports.id, l.r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.checked",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} checked ${l.study.reportNumber} ${revLabel(l.r.rev)} (signed Checked By)`,
      after: { sha256: l.r.sha256, signatureId: signed.signature.id },
      request,
    });
    await syncJobToReports(tx, actor, l.job, `${l.study.reportNumber} checked`, request);
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- release

/** Active client users of the job's company: who a report can be released to. */
export async function clientRecipients(db: Database | Transaction, companyId: string) {
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.clientCompanyId, companyId), eq(users.status, "active")))
    .orderBy(asc(users.name));
}

const releaseSchema = z.object({
  to: z.array(z.string().uuid()).min(1, "Pick who at the client gets it.").max(20),
});

/**
 * Releases a checked revision to chosen client users. The app has no mail
 * service yet (phase 11): the result carries a ready-written email with a
 * link to the report in the client area, which needs the client to sign in.
 */
export async function releaseReport(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: unknown,
  appUrl: string,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.release");
  const v = releaseSchema.parse(input);
  return db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["checked"], "Releasing it");
    const people = await clientRecipients(tx, l.job.companyId);
    const chosen = people.filter((p) => v.to.includes(p.id));
    if (chosen.length !== new Set(v.to).size) {
      throw new ReportsError(`Pick active client users of ${l.company}.`);
    }
    const now = new Date();
    await tx
      .update(studyReports)
      .set({
        status: "released",
        releasedAt: now,
        releasedByUserId: actor.id,
        releasedTo: chosen.map((p) => p.id),
      })
      .where(eq(studyReports.id, l.r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.released",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} released ${l.study.reportNumber} ${revLabel(l.r.rev)} to ${chosen.map((p) => p.name).join(", ")} (${l.company})`,
      after: { to: chosen.map((p) => ({ id: p.id, name: p.name, email: p.email })) },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: chosen.map((p) => p.id),
      kind: "report_released",
      title: `Report ${l.code} ${revLabel(l.r.rev)} for your review`,
      body: `${l.study.reportNumber}, from QA Tech.`,
      href: `/client/reports/${l.r.id}`,
    });
    await syncJobToReports(tx, actor, l.job, `${l.study.reportNumber} sent to the client`, request);
    const link = `${appUrl.replace(/\/$/, "")}/client/reports/${l.r.id}`;
    const subject = `Report ${l.study.reportNumber} ${revLabel(l.r.rev)} for review (${l.code})`;
    const first = (n: string) => n.split(/\s+/)[0] ?? n;
    const body = [
      `Dear ${chosen.length === 1 ? first(chosen[0]!.name) : "Sir/Madam"},`,
      "",
      `The ${l.r.rev === 0 ? "" : "revised "}report ${l.study.reportNumber} ${revLabel(l.r.rev)} for ${l.code} is ready for your review and approval.`,
      "",
      `Open it here (sign in with your QTech account): ${link}`,
      "",
      "You can sign Reviewed By and Approved By in the app, or send it back with comments.",
      "",
      "Regards,",
      actor.name,
    ].join("\n");
    return { to: chosen.map((p) => p.email), subject, body, link };
  });
}

// ----------------------------------------------------------------- client

/** The client's QA signs Reviewed By. */
export async function clientReview(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: { password: string },
  request?: RequestInfo,
): Promise<SignOutcome<object>> {
  assertCan(actor, "reports.client_review");
  assertClient(actor);
  return db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["released"], "Reviewing it");
    const signed = await sign(tx, actor, l, "reviewed_by", input.password, request);
    if (!signed.ok) return { ok: false as const, message: signed.message };
    await tx.update(studyReports).set({ status: "reviewed" }).where(eq(studyReports.id, l.r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.client_reviewed",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} (${l.company}) reviewed ${l.study.reportNumber} ${revLabel(l.r.rev)} (signed Reviewed By)`,
      after: { signatureId: signed.signature.id, sha256: l.r.sha256 },
      request,
    });
    return { ok: true as const };
  });
}

/**
 * The client's QA head signs Approved By: the report is issued. The signed
 * copy (signatures stamped in) is stored with its own SHA-256, and the study
 * goes to the company archive.
 */
export async function clientApprove(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  reportId: string,
  input: { password: string },
  request?: RequestInfo,
): Promise<SignOutcome<object>> {
  assertCan(actor, "reports.client_approve");
  assertClient(actor);
  const out = await db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["reviewed"], "Approving it");
    const reviewed = (await reportSignatures(tx, l.r)).find((s) => s.meaning === "reviewed_by");
    if (reviewed?.userId === actor.id) {
      throw new ReportsError(
        "You signed Reviewed By on this revision. Another person signs Approved By.",
      );
    }
    const signed = await sign(tx, actor, l, "approved_by", input.password, request);
    if (!signed.ok) return { ok: false as const, message: signed.message };
    const now = new Date();
    await tx
      .update(studyReports)
      .set({ status: "signed", signedAt: now, signedVia: "app" })
      .where(eq(studyReports.id, l.r.id));
    await tx.update(studies).set({ archivedAt: now }).where(eq(studies.id, l.study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.client_approved",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} (${l.company}) approved ${l.study.reportNumber} ${revLabel(l.r.rev)} (signed Approved By); the report is issued`,
      after: { signatureId: signed.signature.id, sha256: l.r.sha256 },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: [...(await jobLeads(tx, actor.organisationId, l.job.id)), l.r.createdByUserId],
      kind: "report_client_signed",
      title: `${l.code} ${revLabel(l.r.rev)} signed by ${l.company}`,
      body: `${actor.name} signed Approved By.`,
      href: `/studies/${l.study.id}?tab=report`,
    });
    await syncJobToReports(
      tx,
      actor,
      l.job,
      `${l.study.reportNumber} signed by the client`,
      request,
    );
    return { ok: true as const };
  });
  if (out.ok) await issueSignedCopy(db, blobs, actor, reportId, request);
  return out;
}

/** The client sends a released revision back with comments; the next revision answers them. */
export async function clientReturn(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.client_review");
  assertClient(actor);
  const v = returnSchema.parse(input);
  return db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["released", "reviewed"], "Returning it");
    await addComments(tx, actor, l, v.comments, "client");
    await tx
      .update(studyReports)
      .set({ status: "returned", returnedAt: new Date() })
      .where(eq(studyReports.id, l.r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.client_returned",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} (${l.company}) returned ${l.study.reportNumber} ${revLabel(l.r.rev)} with ${v.comments.length} comment${v.comments.length === 1 ? "" : "s"}`,
      after: { comments: v.comments },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: [...(await jobLeads(tx, actor.organisationId, l.job.id)), l.r.createdByUserId],
      kind: "report_client_returned",
      title: `${l.company} sent back ${l.code} ${revLabel(l.r.rev)}`,
      body: `${actor.name}: ${v.comments.map((c) => c.body).join(" / ")}`,
      href: `/studies/${l.study.id}?tab=report`,
    });
    await syncJobToReports(
      tx,
      actor,
      l.job,
      `${l.study.reportNumber} returned by the client`,
      request,
      {
        rework: true,
      },
    );
  });
}

// ------------------------------------------------------------------ paper

const paperSchema = z
  .object({
    fileId: z.string().uuid("Upload the scan of the signed report."),
    reviewedByName: z.string().trim().min(2, "Who signed Reviewed By?").max(200),
    reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of Reviewed By."),
    approvedByName: z.string().trim().min(2, "Who signed Approved By?").max(200),
    approvedByTitle: z.string().trim().max(200).default(""),
    approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of Approved By."),
  })
  .refine((v) => v.approvedOn >= v.reviewedOn, {
    message: "Approved By can't be dated before Reviewed By.",
    path: ["approvedOn"],
  });

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/**
 * The paper route: QA Tech uploads the scan of the report the client signed
 * in ink and records who signed and when. The scan's SHA-256 is kept next to
 * the frozen PDF's, which links the paper to the electronic record.
 */
export async function recordPaperSignoff(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.release");
  const v = paperSchema.parse(input);
  return db.transaction(async (tx) => {
    const l = await loadReport(tx, actor, reportId);
    assertStatus(l, ["checked", "released", "reviewed"], "Recording the paper sign-off");
    const [f] = await tx
      .select()
      .from(storedFiles)
      .where(
        and(eq(storedFiles.id, v.fileId), eq(storedFiles.organisationId, actor.organisationId)),
      );
    if (!f) throw new ReportsError("That file was not uploaded.");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(f.mimeType)) {
      throw new ReportsError("The scan must be a PDF, JPEG or PNG.");
    }
    if (f.sha256 === l.r.sha256) {
      throw new ReportsError(
        "That is the unsigned report itself. Upload the scan of the signed paper.",
      );
    }
    const today = todayIst();
    if (v.approvedOn > today || v.reviewedOn > today) {
      throw new ReportsError("A signature date is in the future.");
    }
    const checkedOn = l.r.checkedAt
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(l.r.checkedAt)
      : null;
    if (checkedOn && v.reviewedOn < checkedOn) {
      throw new ReportsError(
        `Reviewed By is dated before QA Tech checked the report (${checkedOn.split("-").reverse().join(".")}).`,
      );
    }
    await tx.insert(reportPaperSignoffs).values({
      organisationId: actor.organisationId,
      reportId: l.r.id,
      fileId: f.id,
      scanSha256: f.sha256,
      reportSha256: l.r.sha256!,
      reviewedByName: v.reviewedByName,
      reviewedOn: v.reviewedOn,
      approvedByName: v.approvedByName,
      approvedByTitle: v.approvedByTitle,
      approvedOn: v.approvedOn,
      recordedByUserId: actor.id,
    });
    const now = new Date();
    await tx
      .update(studyReports)
      .set({ status: "signed", signedAt: now, signedVia: "paper" })
      .where(eq(studyReports.id, l.r.id));
    await tx.update(studies).set({ archivedAt: now }).where(eq(studies.id, l.study.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.paper_signed",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} recorded the client's paper sign-off of ${l.study.reportNumber} ${revLabel(l.r.rev)}: reviewed by ${v.reviewedByName} (${v.reviewedOn}), approved by ${v.approvedByName} (${v.approvedOn})`,
      after: { ...v, scanSha256: f.sha256, reportSha256: l.r.sha256 },
      request,
    });
    await syncJobToReports(
      tx,
      actor,
      l.job,
      `${l.study.reportNumber} signed by the client (paper)`,
      request,
    );
  });
}

// ------------------------------------------------------------ signed copy

async function printed(db: Database | Transaction, organisationId: string, r: StudyReport) {
  const sigs = await reportSignatures(db, r);
  const [settings] = await db
    .select({ shortName: organisationSettings.shortName })
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, organisationId));
  const companyIds = [...new Set(sigs.map((s) => s.clientCompanyId).filter(Boolean))] as string[];
  const companies = new Map(
    companyIds.length
      ? (
          await db
            .select({ id: clientCompanies.id, name: clientCompanies.name })
            .from(clientCompanies)
            .where(inArray(clientCompanies.id, companyIds))
        ).map((c) => [c.id, c.name])
      : [],
  );
  return sigs
    .filter((s): s is typeof s & { meaning: PrintedSignature["meaning"] } =>
      ["done_by", "checked_by", "reviewed_by", "approved_by"].includes(s.meaning),
    )
    .map((s): PrintedSignature => ({
      id: s.id,
      meaning: s.meaning,
      name: s.name,
      role: s.role,
      organisation: s.clientCompanyId
        ? (companies.get(s.clientCompanyId) ?? "Client")
        : (settings?.shortName ?? "QA Tech"),
      signedAt: s.signedAt,
    }));
}

/** Builds the signed copy of a frozen revision from its frozen PDF and its signatures. */
export async function buildSignedCopy(
  db: Database | Transaction,
  blobs: BlobStore,
  organisationId: string,
  r: StudyReport,
  reportNumber: string,
) {
  if (!r.fileId || !r.sha256) throw new ReportsError(`${revLabel(r.rev)} isn't frozen.`);
  const [f] = await db.select().from(storedFiles).where(eq(storedFiles.id, r.fileId));
  if (!f) throw new ReportsError("The frozen PDF is missing.");
  const sigs = await printed(db, organisationId, r);
  const at = sigs.at(-1)?.signedAt ?? r.frozenAt ?? new Date(0);
  return signedCopy({
    frozen: await blobs.get(f.storageKey),
    frozenSha256: r.sha256,
    layout: r.layout,
    reportNumber,
    revision: revLabel(r.rev),
    frozenPages: r.pages ?? 0,
    signatures: sigs,
    at,
  });
}

/** Stores the issued copy of a signed revision once, with its SHA-256. */
export async function issueSignedCopy(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  reportId: string,
  request?: RequestInfo,
) {
  const [row] = await db
    .select({ r: studyReports, number: studies.reportNumber })
    .from(studyReports)
    .innerJoin(studies, eq(studies.id, studyReports.studyId))
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    );
  if (!row || row.r.signedVia !== "app" || row.r.signedFileId) return;
  const bytes = await buildSignedCopy(db, blobs, actor.organisationId, row.r, row.number);
  const stored = await storeFile(db, blobs, {
    organisationId: actor.organisationId,
    actor: user(actor),
    fileName: `${row.number} ${revLabel(row.r.rev)} signed.pdf`.replace(/[\\/:*?"<>|]+/g, "-"),
    bytes,
    maxBytes: 80 * 1024 * 1024,
  });
  if (!stored.ok) throw new ReportsError(`The signed copy couldn't be stored: ${stored.message}`);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(studyReports)
      .set({ signedFileId: stored.file.id, signedSha256: stored.file.sha256 })
      .where(and(eq(studyReports.id, reportId), eq(studyReports.signedVia, "app")))
      .returning({ id: studyReports.id });
    if (!updated.length) return;
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.issued_copy_stored",
      entityType: "study",
      entityId: row.r.studyId,
      summary: `Issued copy of ${row.number} ${revLabel(row.r.rev)} stored (SHA-256 ${stored.file.sha256.slice(0, 12)}…)`,
      after: { sha256: stored.file.sha256, frozenSha256: row.r.sha256 },
      request,
    });
  });
}

/**
 * The PDF to hand out for a frozen revision: the issued copy once signed in
 * the app, the scan when signed on paper, otherwise the frozen PDF with the
 * signatures given so far stamped in. Client users get only their company's
 * released revisions.
 */
export async function reportDownload(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  reportId: string,
  kind: "signed" | "frozen" | "scan" = "signed",
) {
  if (!isUuid(reportId)) return null;
  const [row] = await db
    .select({ r: studyReports, number: studies.reportNumber, companyId: jobs.companyId })
    .from(studyReports)
    .innerJoin(studies, eq(studies.id, studyReports.studyId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    );
  if (!row || !row.r.sha256) return null;
  if (isClientRole(actor.role)) {
    if (actor.clientCompanyId !== row.companyId || !row.r.releasedAt) return null;
  } else {
    assertCan(actor, "jobs.view");
  }
  const name = `${row.number} ${revLabel(row.r.rev)}`.replace(/[\\/:*?"<>|]+/g, "-");
  const fileOf = async (id: string) => {
    const [f] = await db.select().from(storedFiles).where(eq(storedFiles.id, id));
    return f ? { bytes: await blobs.get(f.storageKey), sha256: f.sha256, mime: f.mimeType } : null;
  };
  if (kind === "scan") {
    const [p] = await db
      .select()
      .from(reportPaperSignoffs)
      .where(eq(reportPaperSignoffs.reportId, row.r.id));
    if (!p) return null;
    const f = await fileOf(p.fileId);
    return f
      ? {
          ...f,
          fileName: `${name} signed scan.${f.mime === "application/pdf" ? "pdf" : f.mime.split("/")[1]}`,
        }
      : null;
  }
  if (kind === "frozen") {
    const f = await fileOf(row.r.fileId!);
    return f ? { ...f, fileName: `${name}.pdf` } : null;
  }
  if (row.r.signedFileId) {
    const f = await fileOf(row.r.signedFileId);
    if (f) return { ...f, fileName: `${name} signed.pdf` };
  }
  const bytes = await buildSignedCopy(db, blobs, actor.organisationId, row.r, row.number);
  return {
    bytes: Buffer.from(bytes),
    sha256: null as string | null,
    mime: "application/pdf",
    fileName: `${name}${row.r.status === "signed" ? " signed" : ""}.pdf`,
  };
}
