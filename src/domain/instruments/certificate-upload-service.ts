import "server-only";

import { and, eq, inArray, ne, or, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/client-factory";
import {
  certificateItems,
  certificateScanReadings,
  certificates,
  instruments,
  storedFiles,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { SketchReadError, type SketchReader } from "@/lib/ai/sketch-reader";
import { runAction } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";

import { attachCertificateFile, createExternalCertificate } from "./certificate-service";
import {
  findInstrument,
  fromFileName,
  normaliseCode,
  parseCertificateReading,
  type ReadCertificate,
} from "./certificate-scan";
import { InstrumentsError } from "./errors";

/**
 * Uploading certificate scans in bulk (ADR 0024): each file is read (by the
 * vision model, or from its name), matched to the register and to a
 * certificate already on record, shown for checking, then saved: the scan is
 * attached to the matching certificate, or recorded as a new one.
 */

const SCAN_TYPES: Record<string, string | undefined> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
};

/** One certificate in an uploaded file, as the person checks and edits it. */
export type UploadDraft = {
  fileId: string;
  fileName: string;
  page: number;
  number: string;
  ulrNo: string;
  labName: string;
  calibratedOn: string;
  validUntil: string;
  /** The IDs or serials read off it, one per instrument. */
  codes: string[];
};

export type UploadAction = "attach" | "create" | "on_file" | "incomplete";

export type UploadRow = UploadDraft & {
  key: string;
  source: "reader" | "file_name" | "none";
  notes: string;
  instruments: { code: string; id: string | null; label: string }[];
  /** The certificate on record it belongs to, if any. */
  target: { id: string; number: string; hasFile: boolean } | null;
  action: UploadAction;
  /** Why it can't be saved yet, or what to know. */
  problems: string[];
};

const QA_TECH = /^(qa ?tech|qatech|gmp technical)/i;

async function loadFile(db: DbExecutor, actor: SessionUser, fileId: string) {
  if (!isUuid(fileId)) throw new InstrumentsError("That file was not uploaded. Upload it again.");
  const [file] = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, actor.organisationId)));
  if (!file) throw new InstrumentsError("That file was not uploaded. Upload it again.");
  if (!SCAN_TYPES[file.fileType])
    throw new InstrumentsError(
      `${file.firstFileName}: upload certificates as PDF, or a PNG or JPEG photo.`,
    );
  return file;
}

/**
 * Reads an uploaded scan into its certificates (one or more) and matches
 * each. With a reader, the file is sent once and its reading kept; without
 * one, the file name gives the IDs and date. Nothing is saved to a
 * certificate here.
 */
export async function readCertificateUpload(
  db: Database,
  blobs: BlobStore,
  reader: SketchReader | null,
  actor: SessionUser,
  fileId: string,
  request?: RequestInfo,
): Promise<UploadRow[]> {
  assertCan(actor, "instruments.manage");
  const file = await loadFile(db, actor, fileId);
  const [cached] = await db
    .select({ reading: certificateScanReadings.reading })
    .from(certificateScanReadings)
    .where(eq(certificateScanReadings.fileId, file.id));

  let read: ReadCertificate[] = cached?.reading ?? [];
  let source: UploadRow["source"] = cached ? "reader" : "none";
  let notes = "";
  if (!cached && reader) {
    try {
      const bytes = await blobs.get(file.storageKey);
      read = parseCertificateReading(
        await reader({ bytes: new Uint8Array(bytes), mime: SCAN_TYPES[file.fileType]! }),
      );
      source = "reader";
      await db.transaction(async (tx) => {
        await tx
          .insert(certificateScanReadings)
          .values({
            fileId: file.id,
            organisationId: actor.organisationId,
            model: reader.model ?? "unknown",
            reading: read,
          })
          .onConflictDoNothing();
        await recordAudit(tx, {
          organisationId: actor.organisationId,
          actor: { type: "user", userId: actor.id },
          action: "certificate.scan_read",
          entityType: "stored_file",
          entityId: file.id,
          summary: `${actor.name} had the certificate scan ${file.firstFileName} read: ${read.length} certificate${read.length === 1 ? "" : "s"}`,
          after: { fileId: file.id, model: reader.model, certificates: read.length },
          request,
        });
      });
    } catch (error) {
      if (!(error instanceof SketchReadError)) throw error;
      notes = `${error.message} The file name was used instead.`;
      read = [];
      source = "none";
    }
  }
  if (read.length === 0) {
    const named = fromFileName(file.firstFileName);
    if (named) {
      read = [named];
      source = "file_name";
    }
  }
  if (read.length === 0) {
    read = [
      {
        page: 1,
        number: "",
        ulrNo: "",
        labName: "",
        calibratedOn: "",
        validUntil: "",
        instruments: [],
        notes: "",
      },
    ];
  }
  const rows: UploadRow[] = [];
  for (const [i, c] of read.entries()) {
    const draft: UploadDraft = {
      fileId: file.id,
      fileName: file.firstFileName,
      page: c.page,
      number: c.number,
      ulrNo: c.ulrNo,
      labName: c.labName,
      calibratedOn: c.calibratedOn,
      validUntil: c.validUntil,
      codes: c.instruments.map((x) => x.id || x.serial),
    };
    const row = await checkCertificateUpload(db, actor, draft, c.instruments);
    rows.push({
      ...row,
      key: `${file.id}:${i}`,
      source,
      notes: [notes, c.notes].filter(Boolean).join(" "),
    });
  }
  return rows;
}

/**
 * Matches a draft to the register and to the certificates on record, and
 * says what saving it would do. Run again whenever the person edits a row.
 */
export async function checkCertificateUpload(
  db: DbExecutor,
  actor: SessionUser,
  draft: UploadDraft,
  /** The serials read alongside each code, when the reader gave them. */
  read?: { id: string; serial: string }[],
): Promise<Omit<UploadRow, "key" | "source" | "notes">> {
  assertCan(actor, "instruments.view");
  const codes = [...new Set(draft.codes.map((c) => c.trim()).filter(Boolean))].slice(0, 200);
  const register = codes.length
    ? await db
        .select({
          id: instruments.id,
          code: instruments.code,
          serialNo: instruments.serialNo,
          equipmentName: instruments.equipmentName,
        })
        .from(instruments)
        .where(eq(instruments.organisationId, actor.organisationId))
    : [];
  const found = codes.map((code) => {
    const serial = read?.find((r) => (r.id || r.serial) === code)?.serial ?? "";
    const hit =
      findInstrument(register, { id: code, serial }) ??
      findInstrument(register, { id: "", serial: code });
    return { code, id: hit?.id ?? null, label: hit ? hit.code : code };
  });
  const ids = [...new Set(found.flatMap((f) => (f.id ? [f.id] : [])))];

  // Certificates it could be: the same number, or one of these instruments'.
  const tail = draft.number ? normaliseCode(draft.number).split("/").at(-1)! : "";
  const tails = [tail, ...(draft.number ? [] : codes.map((c) => normaliseCode(c)))].filter(
    (t) => t.length >= 3,
  );
  const candidates =
    tails.length || ids.length
      ? await db
          .select({
            id: certificates.id,
            number: certificates.number,
            kind: certificates.kind,
            fileId: certificates.fileId,
            calibratedOn: certificates.calibratedOn,
            validUntil: certificates.validUntil,
          })
          .from(certificates)
          .where(
            and(
              eq(certificates.organisationId, actor.organisationId),
              ne(certificates.status, "cancelled"),
              or(
                ...tails.map(
                  (t) =>
                    sql`upper(regexp_replace(${certificates.number}, '\\s', '', 'g')) like ${`%${t.replace(/[%_]/g, "")}%`}`,
                ),
                ids.length
                  ? inArray(
                      certificates.id,
                      db
                        .select({ id: certificateItems.certificateId })
                        .from(certificateItems)
                        .where(
                          and(
                            eq(certificateItems.organisationId, actor.organisationId),
                            inArray(certificateItems.instrumentId, ids),
                          ),
                        ),
                    )
                  : undefined,
              ),
            ),
          )
          .limit(500)
      : [];
  const sameNumber = draft.number
    ? candidates.filter((c) => normaliseCode(c.number) === normaliseCode(draft.number))
    : [];
  const sameDate = (c: (typeof candidates)[number]) =>
    draft.calibratedOn
      ? c.calibratedOn === draft.calibratedOn
      : !!draft.validUntil && c.validUntil === draft.validUntil;
  let target = sameNumber.length === 1 ? sameNumber[0]! : null;
  if (!target && !draft.number) {
    // No number read: the certificate of these instruments on that date, or
    // one numbered by an ID in the file name ("…RTD-02").
    const byTail = candidates.filter(
      (c) => sameDate(c) && tails.some((t) => normaliseCode(c.number).split("/").at(-1) === t),
    );
    const byDate = candidates.filter((c) => sameDate(c) && !byTail.includes(c));
    target = byTail.length === 1 ? byTail[0]! : byDate.length === 1 ? byDate[0]! : null;
  }

  const problems: string[] = [];
  let action: UploadAction;
  if (target) {
    action = target.fileId || target.kind === "internal" ? "on_file" : "attach";
    if (target.kind === "internal")
      problems.push(`${target.number} is made in QTech; its PDF prints from the record.`);
  } else {
    const missing = found.filter((f) => !f.id).map((f) => f.code);
    if (!draft.number) problems.push("Type the certificate number.");
    if (!draft.labName) problems.push("Type the lab that issued it.");
    if (!draft.calibratedOn) problems.push("Enter the calibration date.");
    if (ids.length === 0 && missing.length === 0) problems.push("Enter the instrument ID(s).");
    if (missing.length)
      problems.push(
        `Not in the register: ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} first, or remove ${missing.length === 1 ? "it" : "them"} here.`,
      );
    action = problems.length ? "incomplete" : "create";
  }
  return {
    ...draft,
    codes,
    instruments: found,
    target: target ? { id: target.id, number: target.number, hasFile: !!target.fileId } : null,
    action,
    problems,
  };
}

export type UploadResult = { key: string; ok: boolean; message: string; certificateId?: string };

/**
 * Saves the checked rows, each on its own: a scan is attached to its
 * certificate on record, or a new certificate is recorded with it. A row
 * that fails says why and leaves the others saved.
 */
export async function saveCertificateUploads(
  db: Database,
  actor: SessionUser,
  drafts: (UploadDraft & { key: string })[],
  request: RequestInfo,
): Promise<UploadResult[]> {
  assertCan(actor, "instruments.manage");
  if (drafts.length > 200) throw new InstrumentsError("Save at most 200 certificates at a time.");
  const results: UploadResult[] = [];
  for (const draft of drafts) {
    const done = await runAction(async (): Promise<Omit<UploadResult, "key">> => {
      await loadFile(db, actor, draft.fileId);
      const row = await checkCertificateUpload(db, actor, draft);
      if (row.action === "attach" && row.target) {
        await attachCertificateFile(
          db,
          actor,
          { certificateId: row.target.id, fileId: draft.fileId },
          request,
        );
        return {
          ok: true,
          message: `Attached to ${row.target.number}.`,
          certificateId: row.target.id,
        };
      }
      if (row.action === "create") {
        const ownLab = QA_TECH.test(draft.labName);
        const cert = await createExternalCertificate(
          db,
          actor,
          {
            number: draft.number,
            ulrNo: draft.ulrNo,
            labName: ownLab ? "QA Tech" : draft.labName,
            calibratedOn: draft.calibratedOn,
            validUntil: draft.validUntil || undefined,
            instrumentIds: row.instruments.flatMap((i) => (i.id ? [i.id] : [])),
            fileId: draft.fileId,
            kind: ownLab ? "imported" : "external",
          },
          request,
        );
        return { ok: true, message: `Recorded ${cert.number}.`, certificateId: cert.id };
      }
      if (row.action === "on_file" && row.target) {
        return {
          ok: true,
          message: `${row.target.number} already has its PDF.`,
          certificateId: row.target.id,
        };
      }
      return { ok: false, message: row.problems.join(" ") };
    });
    results.push(
      done.ok
        ? { key: draft.key, ...done.data }
        : { key: draft.key, ok: false, message: done.error },
    );
  }
  return results;
}
