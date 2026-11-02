import "server-only";

import { and, desc, eq, ne } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientCompanies,
  clientSites,
  equipment,
  jobs,
  jobTeam,
  jobWcrs,
  organisationSettings,
  signatures,
  storedFiles,
  studies,
  studyEvents,
  studyReports,
  users,
  type Job,
  type JobWcr,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import { isClientRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { signRecordTx } from "@/domain/auth/signature-service";
import { isUuid } from "@/domain/clients/shared";
import { lockJob, setStatus } from "@/domain/jobs/job-service";
import { byRole, clientPeople, notify } from "@/domain/notifications/notify";
import {
  JOB_STATUS_LABELS,
  WORK_TYPE_LABELS,
  type JobStatus,
  type WorkType,
} from "@/domain/jobs/types";
import { istStamp } from "@/domain/reports/signed-copy";
import { revLabel, type ReportStatus } from "@/domain/reports/types";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";
import { storeFile } from "@/lib/storage/store-file";

import { BillingError } from "./errors";
import { renderWcr } from "./wcr-pdf";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });
const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const istDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Report statuses that count as "gone to the client" for the WCR. */
const WITH_CLIENT: ReportStatus[] = ["released", "reviewed", "signed"];
const CLIENT_LABEL: Partial<Record<ReportStatus, string>> = {
  released: "Sent for review",
  reviewed: "Reviewed",
  signed: "Signed",
};
/** Job statuses a signed WCR moves on to WCR signed. */
const TO_WCR_SIGNED: readonly JobStatus[] = ["sent_to_client", "client_signed"];

/** Each study of the job with its latest report, for the WCR and its readiness. */
async function studiesOf(db: Database | Transaction, jobId: string) {
  const rows = await db
    .select({
      studyId: studies.id,
      position: studies.position,
      workType: studies.workType,
      reportNumber: studies.reportNumber,
      code: equipment.code,
      name: equipment.name,
      rev: studyReports.rev,
      status: studyReports.status,
    })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .leftJoin(studyReports, eq(studyReports.studyId, studies.id))
    .where(eq(studies.jobId, jobId))
    .orderBy(studies.position, desc(studyReports.rev));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.studyId)) latest.set(r.studyId, r);
  return [...latest.values()];
}

/** Why the job's WCR can't be issued yet, in words (empty when it can). */
export async function wcrBlockers(db: Database | Transaction, jobId: string) {
  const list = await studiesOf(db, jobId);
  if (list.length === 0) return ["The job has no studies."];
  return list
    .filter((s) => !s.status || !WITH_CLIENT.includes(s.status as ReportStatus))
    .map(
      (s) =>
        `${s.code}: ${s.status ? `report ${revLabel(s.rev!)} isn't with the client yet` : "no report yet"}`,
    );
}

async function liveWcr(db: Database | Transaction, jobId: string) {
  const [w] = await db
    .select()
    .from(jobWcrs)
    .where(and(eq(jobWcrs.jobId, jobId), ne(jobWcrs.status, "void")));
  return w ?? null;
}

/**
 * Issues the job's WCR once every study's report has gone to the client: the
 * PDF is drawn from the job and frozen with its SHA-256.
 */
export async function issueWcr(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  jobId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "wcr.issue");
  if (!isUuid(jobId)) throw new BillingError("That job does not exist.");
  const [row] = await db
    .select({
      job: jobs,
      company: clientCompanies,
      site: clientSites.name,
    })
    .from(jobs)
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
    .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, actor.organisationId)));
  if (!row) throw new BillingError("That job does not exist.");
  if (["cancelled", "on_hold", "closed"].includes(row.job.status)) {
    throw new BillingError(
      `Job ${row.job.number} is ${JOB_STATUS_LABELS[row.job.status as JobStatus].toLowerCase()}.`,
    );
  }
  const blockers = await wcrBlockers(db, jobId);
  if (blockers.length) {
    throw new BillingError(
      `The WCR can be issued once every report is with the client. ${blockers.join("; ")}.`,
    );
  }
  if (await liveWcr(db, jobId)) throw new BillingError(`Job ${row.job.number} already has a WCR.`);

  const [settings] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
  if (!settings) throw new Error("Organisation settings missing");
  const letterhead = settings.letterheadFileId
    ? await (async () => {
        const [f] = await db
          .select({ key: storedFiles.storageKey })
          .from(storedFiles)
          .where(eq(storedFiles.id, settings.letterheadFileId!));
        return f ? Buffer.from(await blobs.get(f.key)) : null;
      })()
    : null;
  const list = await studiesOf(db, jobId);
  const events = await db
    .select({ kind: studyEvents.kind, at: studyEvents.at })
    .from(studyEvents)
    .innerJoin(studies, eq(studies.id, studyEvents.studyId))
    .where(and(eq(studies.jobId, jobId), eq(studyEvents.voided, false)));
  const times = events.map((e) => e.at.getTime()).sort((a, b) => a - b);
  const team = await db
    .selectDistinct({ name: users.name })
    .from(jobTeam)
    .innerJoin(users, eq(users.id, jobTeam.userId))
    .where(eq(jobTeam.jobId, jobId));
  const issuedOn = todayIst();
  const number = `WCR/${row.job.number}`;
  const { pdf, signBox } = await renderWcr({
    organisation: settings,
    letterhead,
    number,
    issuedOn,
    jobNumber: row.job.number,
    customer: {
      name: row.company.name,
      address: row.company.address,
      gstin: row.company.gstin,
      site: row.site,
    },
    po: { number: row.job.poNumber, date: row.job.poDate },
    period: {
      from: times.length ? istDate(new Date(times[0]!)) : row.job.plannedStart,
      to: times.length ? istDate(new Date(times.at(-1)!)) : row.job.plannedEnd,
    },
    studies: list.map((s) => ({
      code: s.code,
      name: s.name,
      work: WORK_TYPE_LABELS[s.workType as WorkType] ?? s.workType,
      reportNumber: `${s.reportNumber} ${revLabel(s.rev!)}`,
      reportStatus: CLIENT_LABEL[s.status as ReportStatus] ?? "",
    })),
    team: team.map((t) => t.name).sort(),
    issuedBy: actor.name,
  });
  const stored = await storeFile(db, blobs, {
    organisationId: actor.organisationId,
    actor: user(actor),
    fileName: `${number.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`,
    bytes: pdf,
    maxBytes: 20 * 1024 * 1024,
  });
  if (!stored.ok) throw new BillingError(`The WCR couldn't be stored: ${stored.message}`);

  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    if (await liveWcr(tx, jobId)) throw new BillingError(`Job ${job.number} already has a WCR.`);
    if ((await wcrBlockers(tx, jobId)).length) {
      throw new BillingError("A report went back while the WCR was being drawn. Try again.");
    }
    const [w] = await tx
      .insert(jobWcrs)
      .values({
        organisationId: actor.organisationId,
        jobId,
        fileId: stored.file.id,
        sha256: stored.file.sha256,
        signBox,
        issuedByUserId: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "wcr.issued",
      entityType: "job",
      entityId: jobId,
      summary: `${actor.name} issued ${number} (${list.length} item${list.length === 1 ? "" : "s"})`,
      after: { wcrId: w!.id, sha256: stored.file.sha256 },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: await clientPeople(tx, job.companyId, ["client_qa_head"]),
      kind: "wcr_to_accept",
      title: `${number} to accept`,
      body: `QA Tech's work completion report for job ${job.number}.`,
      href: `/client/wcr/${w!.id}`,
    });
    return { id: w!.id, number };
  });
}

/** Loads and locks a WCR with its job; client users only their own company's. */
async function loadWcr(tx: Transaction, actor: SessionUser, wcrId: string) {
  if (!isUuid(wcrId)) throw new BillingError("That WCR does not exist.");
  const [w0] = await tx
    .select()
    .from(jobWcrs)
    .where(and(eq(jobWcrs.id, wcrId), eq(jobWcrs.organisationId, actor.organisationId)));
  if (!w0) throw new BillingError("That WCR does not exist.");
  const job = await lockJob(tx, actor, w0.jobId);
  if (isClientRole(actor.role) && actor.clientCompanyId !== job.companyId) {
    throw new BillingError("That WCR does not exist.");
  }
  const [w] = await tx.select().from(jobWcrs).where(eq(jobWcrs.id, wcrId)).for("update");
  return { w: w!, job };
}

async function moveJob(tx: Transaction, actor: SessionUser, job: Job, request?: RequestInfo) {
  await notify(tx, {
    organisationId: actor.organisationId,
    to: await byRole(tx, actor.organisationId, ["accounts", "manager"]),
    except: actor.id,
    kind: "wcr_accepted",
    title: `WCR/${job.number} signed: invoice due`,
    body: "Raise the invoice in Tally and record it on the job (GST Rule 47: within 30 days).",
    href: `/jobs/${job.id}#money`,
  });
  if (TO_WCR_SIGNED.includes(job.status as JobStatus)) {
    await setStatus(
      tx,
      actor,
      job,
      "wcr_signed",
      "Work completion report signed by the client",
      request,
    );
  }
}

/** A wrong WCR is voided with a reason and issued again. A signed one stays. */
export async function voidWcr(
  db: Database,
  actor: SessionUser,
  wcrId: string,
  reason: string,
  request?: RequestInfo,
) {
  assertCan(actor, "wcr.issue");
  const why = z.string().trim().min(5, "Say why it is voided.").max(500).parse(reason);
  return db.transaction(async (tx) => {
    const { w, job } = await loadWcr(tx, actor, wcrId);
    if (w.status !== "issued") {
      throw new BillingError("A signed WCR can't be voided.");
    }
    await tx
      .update(jobWcrs)
      .set({ status: "void", voidReason: why, voidedAt: new Date() })
      .where(eq(jobWcrs.id, w.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "wcr.voided",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} voided WCR/${job.number}`,
      reason: why,
      request,
    });
  });
}

/** The client's QA head accepts the WCR in the app (password re-entered). */
export async function acceptWcr(
  db: Database,
  actor: SessionUser,
  wcrId: string,
  password: string,
  request?: RequestInfo,
): Promise<{ ok: true } | { ok: false; message: string }> {
  assertCan(actor, "wcr.accept");
  if (!isClientRole(actor.role)) throw new BillingError("Only the client accepts a WCR.");
  if (!password) throw new BillingError("Enter your password to sign.");
  return db.transaction(async (tx) => {
    const { w, job } = await loadWcr(tx, actor, wcrId);
    if (w.status !== "issued") throw new BillingError(`WCR/${job.number} is ${w.status}.`);
    const signed = await signRecordTx(
      tx,
      actor,
      { meaning: "accepted_by", entityType: "wcr", entityId: w.id, recordHash: w.sha256, password },
      request ?? {},
    );
    if (!signed.ok) return { ok: false as const, message: signed.message };
    await tx
      .update(jobWcrs)
      .set({
        status: "signed",
        signedVia: "app",
        signedAt: new Date(),
        signatureId: signed.signature.id,
      })
      .where(eq(jobWcrs.id, w.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "wcr.accepted",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} accepted WCR/${job.number} (signed in the app)`,
      after: { signatureId: signed.signature.id, sha256: w.sha256 },
      request,
    });
    await moveJob(tx, actor, job, request);
    return { ok: true as const };
  });
}

const paperSchema = z.object({
  fileId: z.string().uuid("Upload the scan of the signed WCR."),
  signedByName: z.string().trim().min(2, "Who signed it?").max(200),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was signed."),
});

/** The WCR signed on paper: the scan, who signed and when. */
export async function recordWcrPaper(
  db: Database,
  actor: SessionUser,
  wcrId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "wcr.issue");
  const v = paperSchema.parse(input);
  return db.transaction(async (tx) => {
    const { w, job } = await loadWcr(tx, actor, wcrId);
    if (w.status !== "issued") throw new BillingError(`WCR/${job.number} is ${w.status}.`);
    const [f] = await tx
      .select()
      .from(storedFiles)
      .where(
        and(eq(storedFiles.id, v.fileId), eq(storedFiles.organisationId, actor.organisationId)),
      );
    if (!f) throw new BillingError("That file was not uploaded.");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(f.mimeType)) {
      throw new BillingError("The scan must be a PDF, JPEG or PNG.");
    }
    if (f.sha256 === w.sha256) {
      throw new BillingError(
        "That is the unsigned WCR itself. Upload the scan of the signed paper.",
      );
    }
    if (v.signedOn > todayIst()) throw new BillingError("The signing date is in the future.");
    if (v.signedOn < istDate(w.issuedAt)) {
      throw new BillingError("The signing date is before the WCR was issued.");
    }
    await tx
      .update(jobWcrs)
      .set({
        status: "signed",
        signedVia: "paper",
        signedAt: new Date(),
        paperFileId: f.id,
        paperSignedByName: v.signedByName,
        paperSignedOn: v.signedOn,
      })
      .where(eq(jobWcrs.id, w.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "wcr.paper_signed",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} recorded WCR/${job.number} signed on paper by ${v.signedByName} on ${v.signedOn}`,
      after: { ...v, scanSha256: f.sha256 },
      request,
    });
    await moveJob(tx, actor, job, request);
  });
}

/** The job's live WCR and, for staff, why one can't be issued yet. */
export async function jobWcr(db: Database, jobId: string) {
  const w = await liveWcr(db, jobId);
  return { wcr: w, blockers: w ? [] : await wcrBlockers(db, jobId) };
}

/**
 * The WCR to hand out: the frozen PDF with the client's acceptance stamped in
 * (app route), the scan (paper route), or the frozen PDF as issued.
 */
export async function wcrDownload(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  wcrId: string,
  kind: "copy" | "frozen" | "scan" = "copy",
) {
  if (!isUuid(wcrId)) return null;
  const [row] = await db
    .select({ w: jobWcrs, number: jobs.number, companyId: jobs.companyId })
    .from(jobWcrs)
    .innerJoin(jobs, eq(jobs.id, jobWcrs.jobId))
    .where(and(eq(jobWcrs.id, wcrId), eq(jobWcrs.organisationId, actor.organisationId)));
  if (!row) return null;
  if (isClientRole(actor.role)) {
    if (actor.clientCompanyId !== row.companyId || row.w.status === "void") return null;
  } else {
    assertCan(actor, "jobs.view");
  }
  const name = `WCR ${row.number}`.replace(/[\\/:*?"<>|]+/g, "-");
  const fileOf = async (id: string) => {
    const [f] = await db.select().from(storedFiles).where(eq(storedFiles.id, id));
    return f
      ? { bytes: Buffer.from(await blobs.get(f.storageKey)), sha256: f.sha256, mime: f.mimeType }
      : null;
  };
  if (kind === "scan") {
    if (!row.w.paperFileId) return null;
    const f = await fileOf(row.w.paperFileId);
    return f
      ? {
          ...f,
          fileName: `${name} signed scan.${f.mime === "application/pdf" ? "pdf" : f.mime.split("/")[1]}`,
        }
      : null;
  }
  const frozen = await fileOf(row.w.fileId);
  if (!frozen) return null;
  if (kind === "frozen" || row.w.signedVia !== "app" || !row.w.signatureId || !row.w.signBox) {
    return { ...frozen, fileName: `${name}.pdf` };
  }
  const [g] = await db.select().from(signatures).where(eq(signatures.id, row.w.signatureId));
  if (!g) return { ...frozen, fileName: `${name}.pdf` };
  return {
    bytes: Buffer.from(await stampAcceptance(frozen.bytes, row.w, g)),
    sha256: null as string | null,
    mime: "application/pdf",
    fileName: `${name} signed.pdf`,
  };
}

/** The acceptance printed into the client's box (21 CFR 11.50: name, time, meaning, record hash). */
async function stampAcceptance(
  frozen: Uint8Array,
  w: JobWcr,
  g: { signerName: string; signerRole: string; signedAt: Date; id: string },
) {
  const pdf = await PDFDocument.load(frozen, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const b = w.signBox!;
  const page = pdf.getPages()[b.page - 1];
  if (page) {
    const blue = rgb(0.1, 0.23, 0.47);
    const latin = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, "?");
    const lines: [string, typeof font, number][] = [
      ["Accepted electronically", bold, 8],
      [latin(`${g.signerName}, ${g.signerRole}`), font, 8],
      [istStamp(g.signedAt), font, 8],
      [`Record SHA-256 ${w.sha256.slice(0, 16)}...`, font, 6],
    ];
    lines.forEach(([t, f, size], i) => {
      const width = f.widthOfTextAtSize(t, size);
      page.drawText(t, {
        x: b.x + (b.w - width) / 2,
        y: b.y + b.h - 14 - i * 12,
        size,
        font: f,
        color: blue,
      });
    });
  }
  pdf.setModificationDate(g.signedAt);
  return pdf.save({ useObjectStreams: false });
}
