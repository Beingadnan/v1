import "server-only";

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  equipment,
  reportComments,
  storedFiles,
  studies,
  studyReports,
  users,
  type Job,
  type Study,
} from "@/db/schema";
import { approvalBlockers } from "@/domain/analysis/analysis-service";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { signRecordTx } from "@/domain/auth/signature-service";
import { isUuid } from "@/domain/clients/shared";
import { lockJob, setStatus } from "@/domain/jobs/job-service";
import { JOB_STATUS_LABELS, type JobStatus } from "@/domain/jobs/types";
import { jobLeads, notify } from "@/domain/notifications/notify";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { ReportsError } from "./errors";
import { syncJobToReports } from "./job-sync";
import { buildReportPdf } from "./report-data";
import { revLabel, unprintable, type ReportStatus } from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

/** Job statuses in which a report can be drafted and frozen. */
const REPORT_OPEN: readonly JobStatus[] = ["analysis", "report_draft", "rework"];
/** A revision can also be started once the reports have moved on (the job goes to Rework). */
const REVISABLE_JOB: readonly JobStatus[] = ["checked", "sent_to_client", "client_signed"];

type Loaded = { study: Study; job: Job; code: string };

async function load(tx: Transaction, actor: SessionUser, studyId: string): Promise<Loaded> {
  if (!isUuid(studyId)) throw new ReportsError("That study does not exist.");
  const [row] = await tx
    .select({ study: studies, code: equipment.code })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .where(and(eq(studies.id, studyId), eq(studies.organisationId, actor.organisationId)));
  if (!row) throw new ReportsError("That study does not exist.");
  const job = await lockJob(tx, actor, row.study.jobId);
  await tx.select({ id: studies.id }).from(studies).where(eq(studies.id, studyId)).for("update");
  return { study: row.study, job, code: row.code };
}

function assertOpen(l: Loaded, what: string) {
  const s = l.job.status as JobStatus;
  if (!REPORT_OPEN.includes(s)) {
    throw new ReportsError(
      `${what} isn't possible while job ${l.job.number} is ${JOB_STATUS_LABELS[s]?.toLowerCase() ?? s}.`,
    );
  }
}

/** The approved run the report is built from, or why there is none. */
async function approvedRun(tx: Transaction | Database, organisationId: string, study: Study) {
  if (!study.analysisApprovedAt || !study.analysisRunId) {
    throw new ReportsError("The analysis isn't approved yet (Analysis tab).");
  }
  const { run, out } = await approvalBlockers(tx, organisationId, study);
  if (!run || run.id !== study.analysisRunId) {
    throw new ReportsError("A newer analysis was run after the approval. Approve it first.");
  }
  if (out.length > 0)
    throw new ReportsError(`The analysis can't be reported yet: ${out.join(" ")}`);
  return run;
}

async function latest(tx: Transaction | Database, studyId: string) {
  const [r] = await tx
    .select()
    .from(studyReports)
    .where(eq(studyReports.studyId, studyId))
    .orderBy(desc(studyReports.rev))
    .limit(1);
  return r ?? null;
}

/** When every study on the job has its analysis approved, the job moves on to Report draft. */
async function syncJob(tx: Transaction, actor: SessionUser, l: Loaded, request?: RequestInfo) {
  if (l.job.status !== "analysis") return;
  const all = await tx
    .select({ approved: studies.analysisApprovedAt })
    .from(studies)
    .where(eq(studies.jobId, l.job.id));
  if (all.every((s) => s.approved)) {
    await setStatus(
      tx,
      actor,
      l.job,
      "report_draft",
      "Every study's analysis approved; report drafted",
      request,
    );
  }
}

/** Starts Rev 00 of a study's report from its approved analysis. */
export async function createReport(
  db: Database,
  actor: SessionUser,
  studyId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.prepare");
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    await approvedRun(tx, actor.organisationId, l.study);
    assertOpen(l, "Drafting the report");
    const last = await latest(tx, l.study.id);
    if (last) {
      throw new ReportsError(
        last.status === "draft"
          ? `${revLabel(last.rev)} is already being drafted.`
          : `${revLabel(last.rev)} is frozen. Start a new revision to change it.`,
      );
    }
    const [r] = await tx
      .insert(studyReports)
      .values({
        organisationId: actor.organisationId,
        studyId: l.study.id,
        rev: 0,
        createdByUserId: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.created",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} started the report ${l.study.reportNumber} Rev 00 for ${l.code} (job ${l.job.number})`,
      after: { reportId: r!.id, rev: 0 },
      request,
    });
    await syncJob(tx, actor, l, request);
    return { id: r!.id };
  });
}

const textSchema = z.object({
  section: z.enum(["observation", "conclusion"]),
  /** null: back to the template. */
  text: z
    .string()
    .trim()
    .max(6000)
    .nullable()
    .refine(
      (v) => v === null || v.length >= 10,
      "Write at least a sentence (or reset to the template).",
    ),
});

/** Edits the observation or conclusion of a draft; every edit is audited with before and after. */
export async function editReportText(
  db: Database,
  actor: SessionUser,
  reportId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.prepare");
  const v = textSchema.parse(input);
  const bad = v.text ? unprintable(v.text) : [];
  if (bad.length) {
    throw new ReportsError(
      `The report can't print ${bad.slice(0, 6).join(" ")}${bad.length > 6 ? " …" : ""}. Write it in English letters and figures.`,
    );
  }
  return db.transaction(async (tx) => {
    const r = await draftOf(tx, actor, reportId);
    const l = await load(tx, actor, r.studyId);
    assertOpen(l, "Editing the report");
    const before = r[v.section];
    if (before === v.text) return;
    await tx
      .update(studyReports)
      .set({ [v.section]: v.text })
      .where(eq(studyReports.id, r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.text_edited",
      entityType: "study",
      entityId: r.studyId,
      summary: `${actor.name} ${v.text === null ? "reset" : "edited"} the ${v.section} of ${l.study.reportNumber} ${revLabel(r.rev)}`,
      before: { [v.section]: before ?? "(template)" },
      after: { [v.section]: v.text ?? "(template)" },
      request,
    });
  });
}

async function draftOf(tx: Transaction, actor: SessionUser, reportId: string) {
  if (!isUuid(reportId)) throw new ReportsError("That report does not exist.");
  const [r] = await tx
    .select()
    .from(studyReports)
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    )
    .for("update");
  if (!r) throw new ReportsError("That report does not exist.");
  if (r.status !== "draft")
    throw new ReportsError(`${revLabel(r.rev)} is frozen and can't be changed.`);
  return r;
}

/** Who prepared the draft (Done By on the report). */
async function nameOf(db: Database | Transaction, id: string | null) {
  if (!id) return "";
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id));
  return u?.name ?? "";
}

/** The draft as it would print now, marked DRAFT. */
export async function previewReport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  reportId: string,
) {
  assertCan(actor, "jobs.view");
  if (!isUuid(reportId)) return null;
  const [r] = await db
    .select()
    .from(studyReports)
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    );
  if (!r) return null;
  const [study] = await db.select().from(studies).where(eq(studies.id, r.studyId));
  if (!study) return null;
  const runId = r.runId ?? study.analysisRunId;
  if (!runId) throw new ReportsError("The analysis isn't approved yet (Analysis tab).");
  return buildReportPdf(db, blobs, actor, study, runId, {
    label: revLabel(r.rev),
    observation: r.observation,
    conclusion: r.conclusion,
    watermark: "DRAFT",
    doneBy: await nameOf(db, r.createdByUserId),
    checkedBy: "",
  });
}

/** Comments on any revision of the study that the preparer hasn't answered. */
export async function openComments(tx: Transaction | Database, studyId: string) {
  return tx
    .select()
    .from(reportComments)
    .where(and(eq(reportComments.studyId, studyId), isNull(reportComments.answer)))
    .orderBy(reportComments.createdAt);
}

/** Revisions a new frozen revision replaces. */
const REPLACED: ReportStatus[] = [
  "checking",
  "checked",
  "released",
  "reviewed",
  "signed",
  "returned",
];

export type SignOutcome<T> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Submits a draft for checking: renders it once, keeps the PDF with its
 * SHA-256, records the run it was built from, supersedes the revision before
 * it, and signs Done By (the preparer re-enters their password) over that
 * hash, all in one transaction. Refused if the analysis approval no longer
 * stands, a certificate's PDF is missing, or a review comment is unanswered.
 */
export async function freezeReport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  reportId: string,
  input: { password: string },
  request?: RequestInfo,
): Promise<SignOutcome<{ rev: number; sha256: string; pages: number }>> {
  assertCan(actor, "reports.prepare");
  if (!isUuid(reportId)) throw new ReportsError("That report does not exist.");
  if (!input.password) throw new ReportsError("Enter your password to sign Done By.");
  // Render outside the transaction (it reads only), then check nothing moved while it did.
  const [r0] = await db
    .select()
    .from(studyReports)
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    );
  if (!r0) throw new ReportsError("That report does not exist.");
  if (r0.status !== "draft") throw new ReportsError(`${revLabel(r0.rev)} is already frozen.`);
  const open0 = await openComments(db, r0.studyId);
  if (open0.length) {
    throw new ReportsError(
      `Answer the ${open0.length === 1 ? "review comment" : `${open0.length} review comments`} first (what was fixed).`,
    );
  }
  const [study0] = await db.select().from(studies).where(eq(studies.id, r0.studyId));
  const run0 = await approvedRun(db, actor.organisationId, study0!);
  const built = await buildReportPdf(db, blobs, actor, study0!, run0.id, {
    label: revLabel(r0.rev),
    observation: r0.observation,
    conclusion: r0.conclusion,
    watermark: null,
    // Names and times are stamped from the signatures (phase 9).
    doneBy: "",
    checkedBy: "",
  });
  if (built.missing.length > 0) {
    throw new ReportsError(
      `These certificates have no PDF on file: ${built.missing.join(", ")}. Open each one under Instruments > Certificates and attach its PDF, then freeze.`,
    );
  }
  const fileName = `${study0!.reportNumber} ${revLabel(r0.rev)}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  const stored = await storeFile(db, blobs, {
    organisationId: actor.organisationId,
    actor: user(actor),
    fileName,
    bytes: built.bytes,
    maxBytes: 60 * 1024 * 1024,
  });
  if (!stored.ok) throw new ReportsError(`The PDF couldn't be stored: ${stored.message}`);

  return db.transaction(async (tx) => {
    const r = await draftOf(tx, actor, reportId);
    const l = await load(tx, actor, r.studyId);
    assertOpen(l, "Freezing the report");
    const run = await approvedRun(tx, actor.organisationId, l.study);
    if (run.id !== run0.id || r.observation !== r0.observation || r.conclusion !== r0.conclusion) {
      throw new ReportsError("The report changed while it was being frozen. Freeze it again.");
    }
    if ((await openComments(tx, r.studyId)).length) {
      throw new ReportsError("A review comment came in while you were signing. Answer it first.");
    }
    const signed = await signRecordTx(
      tx,
      actor,
      {
        meaning: "done_by",
        entityType: "report",
        entityId: r.id,
        recordHash: stored.file.sha256,
        password: input.password,
      },
      request ?? {},
    );
    if (!signed.ok) return { ok: false as const, message: signed.message };
    const now = new Date();
    await tx
      .update(studyReports)
      .set({ status: "superseded", supersededAt: now })
      .where(
        and(
          eq(studyReports.studyId, r.studyId),
          ne(studyReports.id, r.id),
          inArray(studyReports.status, REPLACED),
        ),
      );
    await tx
      .update(studyReports)
      .set({
        status: "checking",
        runId: run.id,
        fileId: stored.file.id,
        sha256: stored.file.sha256,
        pages: built.pages,
        layout: built.layout,
        frozenByUserId: actor.id,
        frozenAt: now,
      })
      .where(eq(studyReports.id, r.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.frozen",
      entityType: "study",
      entityId: r.studyId,
      summary: `${actor.name} froze ${l.study.reportNumber} ${revLabel(r.rev)} (${built.pages} pages, from analysis run ${run.runNo}), signed Done By and sent it for checking`,
      after: { rev: r.rev, sha256: stored.file.sha256, runId: run.id, pages: built.pages },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: await jobLeads(tx, actor.organisationId, l.job.id),
      except: actor.id,
      kind: "report_to_check",
      title: `${l.code} ${revLabel(r.rev)} to check`,
      body: `${actor.name} signed Done By on ${l.study.reportNumber} (job ${l.job.number}).`,
      href: `/studies/${r.studyId}?tab=report`,
    });
    return { ok: true as const, rev: r.rev, sha256: stored.file.sha256, pages: built.pages };
  });
}

/** Starts the next revision of a frozen report; the reason prints in the revision history. */
export async function newRevision(
  db: Database,
  actor: SessionUser,
  studyId: string,
  reason: string,
  request?: RequestInfo,
) {
  assertCan(actor, "reports.prepare");
  const why = z.string().trim().min(5, "Say why the report is revised.").max(1000).parse(reason);
  return db.transaction(async (tx) => {
    const l = await load(tx, actor, studyId);
    if (!REVISABLE_JOB.includes(l.job.status as JobStatus)) assertOpen(l, "Revising the report");
    const last = await latest(tx, l.study.id);
    if (!last) throw new ReportsError("There's no report to revise yet.");
    if (last.status === "draft")
      throw new ReportsError(`${revLabel(last.rev)} is already being drafted.`);
    if (last.status === "checking") {
      throw new ReportsError(
        `${revLabel(last.rev)} is with the checker. The checker returns it if it needs changes.`,
      );
    }
    const [r] = await tx
      .insert(studyReports)
      .values({
        organisationId: actor.organisationId,
        studyId: l.study.id,
        rev: last.rev + 1,
        reason: why,
        // The wording carries over; the numbers come from the approved run.
        observation: last.observation,
        conclusion: last.conclusion,
        createdByUserId: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "report.revision_started",
      entityType: "study",
      entityId: l.study.id,
      summary: `${actor.name} started ${l.study.reportNumber} ${revLabel(last.rev + 1)}`,
      reason: why,
      after: { reportId: r!.id, rev: last.rev + 1 },
      request,
    });
    await syncJobToReports(tx, actor, l.job, `${l.study.reportNumber} is being revised`, request, {
      rework: true,
    });
    return { id: r!.id, rev: last.rev + 1 };
  });
}

/** Reports of a study, newest first. */
export async function reportsOf(db: Database, actor: SessionUser, studyId: string) {
  assertCan(actor, "jobs.view");
  if (!isUuid(studyId)) return [];
  return db
    .select({ r: studyReports, by: users.name })
    .from(studyReports)
    .leftJoin(users, eq(users.id, studyReports.createdByUserId))
    .where(
      and(eq(studyReports.studyId, studyId), eq(studyReports.organisationId, actor.organisationId)),
    )
    .orderBy(desc(studyReports.rev));
}

/** The frozen PDF of a revision, byte-identical to what was frozen. */
export async function frozenReport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  reportId: string,
) {
  assertCan(actor, "jobs.view");
  if (!isUuid(reportId)) return null;
  const [row] = await db
    .select({ r: studyReports, key: storedFiles.storageKey, name: storedFiles.firstFileName })
    .from(studyReports)
    .innerJoin(storedFiles, eq(storedFiles.id, studyReports.fileId))
    .where(
      and(eq(studyReports.id, reportId), eq(studyReports.organisationId, actor.organisationId)),
    );
  if (!row) return null;
  return {
    bytes: await blobs.get(row.key),
    fileName: row.name,
    sha256: row.r.sha256!,
    status: row.r.status,
  };
}
