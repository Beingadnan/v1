import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/client-factory";
import {
  certificateItems,
  certificateMasters,
  certificatePoints,
  certificateReadings,
  certificates,
  instrumentModels,
  instruments,
  organisationSettings,
  sites,
  storedFiles,
  type InstrumentModel,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid, rethrowUnique } from "@/domain/clients/shared";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";

import { noteUsedNumber } from "@/domain/numbering/allocate";

import type { AccuracySpec } from "./calibration-math";
import { evaluate } from "./certificate-service";
import { InstrumentsError } from "./errors";
import {
  modelKey,
  planInstrumentImport,
  planSummary,
  readInstrumentList,
  type ImportOptions,
  type ImportPlan,
  type Snapshot,
} from "./instrument-import";
import { isInstrumentType, type InstrumentType } from "./types";

/** Rows per INSERT: well under Postgres's 65,535-parameter limit. */
const CHUNK = 500;
function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

async function loadFile(db: Database, blobs: BlobStore, actor: SessionUser, fileId: string) {
  if (!isUuid(fileId)) throw new InstrumentsError("Upload the file again.");
  const [file] = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, actor.organisationId)));
  if (!file) throw new InstrumentsError("Upload the file again.");
  if (file.fileType !== "xlsx") {
    throw new InstrumentsError(
      file.fileType === "xls"
        ? "This is an old .xls file. Open it in Excel, save it as .xlsx, and upload that."
        : "Upload the instrument list as an Excel (.xlsx) file.",
    );
  }
  return { file, bytes: await blobs.get(file.storageKey) };
}

/** Sequential queries: the executor may be a transaction (one connection). */
async function loadSnapshot(executor: DbExecutor, organisationId: string): Promise<Snapshot> {
  const models = await executor
    .select({ id: instrumentModels.id, make: instrumentModels.make, model: instrumentModels.model })
    .from(instrumentModels)
    .where(eq(instrumentModels.organisationId, organisationId));
  const list = await executor
    .select({
      id: instruments.id,
      code: instruments.code,
      serialNo: instruments.serialNo,
      make: instruments.make,
      tier: instruments.tier,
    })
    .from(instruments)
    .where(eq(instruments.organisationId, organisationId));
  const certs = await executor
    .select({
      id: certificates.id,
      number: certificates.number,
      labName: certificates.labName,
      itemIds: sql<
        string[]
      >`coalesce((select array_agg(${certificateItems.instrumentId}::text) from ${certificateItems} where ${certificateItems.certificateId} = ${certificates.id}), '{}')`,
    })
    .from(certificates)
    .where(eq(certificates.organisationId, organisationId));
  const siteRows = await executor
    .select({ id: sites.id, code: sites.code, name: sites.name })
    .from(sites)
    .where(eq(sites.organisationId, organisationId));
  const [settings] = await executor
    .select({ shortName: organisationSettings.shortName })
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, organisationId));
  return {
    models,
    instruments: list,
    certificates: certs,
    sites: siteRows,
    labName: settings?.shortName ?? "",
  };
}

function typeOption(value: string): InstrumentType {
  return isInstrumentType(value) ? value : "portable_logger";
}

/** What the person chose on the import screen. */
export type ImportChoices = {
  defaultType: string;
  /** Prefix for IDs given to serials that have none, e.g. "E-TRH"; blank = don't give IDs. */
  assignPrefix?: string;
  /** Model for those serials when the file doesn't say. */
  assignModelId?: string;
};

function importOptions(choices: ImportChoices): ImportOptions {
  const prefix = (choices.assignPrefix ?? "").trim();
  if (prefix && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$/.test(prefix)) {
    throw new InstrumentsError("The ID prefix can use letters, numbers and - _ . / (up to 20).");
  }
  return {
    defaultType: typeOption(choices.defaultType),
    assign: prefix
      ? {
          prefix,
          modelId:
            choices.assignModelId && isUuid(choices.assignModelId) ? choices.assignModelId : null,
        }
      : null,
  };
}

export type InstrumentImportPreview = {
  fileId: string;
  fileName: string;
  summary: ReturnType<typeof planSummary>;
  plan: ImportPlan;
};

export async function previewInstrumentImport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  fileId: string,
  choices: ImportChoices,
): Promise<InstrumentImportPreview> {
  assertCan(actor, "instruments.manage");
  const options = importOptions(choices);
  const { file, bytes } = await loadFile(db, blobs, actor, fileId);
  const read = await readInstrumentList(bytes);
  if (read.rows.length === 0 && read.workbookCertificates.length === 0) {
    throw new InstrumentsError(read.problems[0] ?? "No instruments found in this file.");
  }
  const plan = planInstrumentImport(read, await loadSnapshot(db, actor.organisationId), options);
  return { fileId, fileName: file.firstFileName, summary: planSummary(plan), plan };
}

/**
 * Applies the import in one transaction, everything or nothing. The plan is
 * rebuilt inside the transaction, so it matches the database at that moment.
 */
export async function applyInstrumentImport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  fileId: string,
  choices: ImportChoices,
  request: RequestInfo,
): Promise<ReturnType<typeof planSummary>> {
  assertCan(actor, "instruments.manage");
  const options = importOptions(choices);
  const { file, bytes } = await loadFile(db, blobs, actor, fileId);
  const read = await readInstrumentList(bytes);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`instruments-import:${actor.organisationId}`}))`,
      );
      if (options.assign) {
        // Same lock as "Add a batch", so the two can't hand out the same IDs.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`instrument-codes:${actor.organisationId}:${options.assign.prefix.toLowerCase()}`}))`,
        );
      }
      const snapshot = await loadSnapshot(tx, actor.organisationId);
      const plan = planInstrumentImport(read, snapshot, options);
      const summary = planSummary(plan);
      if (summary.instruments === 0 && summary.certificateLinks === 0) {
        if (summary.unassigned > 0) {
          throw new InstrumentsError(
            `${summary.unassigned} serial number${summary.unassigned === 1 ? " has" : "s have"} no QA Tech ID. Enter an ID prefix to give ${summary.unassigned === 1 ? "it an ID" : "them IDs"}.`,
          );
        }
        throw new InstrumentsError(
          "Nothing new to import: every instrument in the file is already registered.",
        );
      }

      // Bulk inserts: one statement per table, so a 200-row list is a few
      // round trips to the database instead of hundreds.
      const [settings] = await tx
        .select({
          legalName: organisationSettings.legalName,
          address: organisationSettings.address,
          certificateNumberFormat: organisationSettings.certificateNumberFormat,
        })
        .from(organisationSettings)
        .where(eq(organisationSettings.organisationId, actor.organisationId));
      const existingModels = await tx
        .select()
        .from(instrumentModels)
        .where(eq(instrumentModels.organisationId, actor.organisationId));
      const modelByKey = new Map<string, InstrumentModel>(
        existingModels.map((m) => [modelKey(m.make, m.model), m]),
      );
      if (plan.models.length > 0) {
        const created = await tx
          .insert(instrumentModels)
          .values(
            plan.models.map((m) => ({
              organisationId: actor.organisationId,
              type: m.type,
              make: m.make,
              model: m.model,
              equipmentName: m.equipmentName,
              quantities: m.quantities,
              rangeText: m.rangeText,
              createdByUserId: actor.id,
            })),
          )
          .returning();
        for (const m of created) modelByKey.set(modelKey(m.make, m.model), m);
      }

      const idByCode = new Map(snapshot.instruments.map((i) => [i.code.toLowerCase(), i.id]));
      for (const part of chunks(plan.instruments)) {
        const created = await tx
          .insert(instruments)
          .values(
            part.map((i) => {
              // Details the list doesn't give come from the model, as when adding by hand.
              const model = i.modelKey ? modelByKey.get(i.modelKey) : undefined;
              return {
                organisationId: actor.organisationId,
                modelId: model?.id ?? null,
                type: i.type,
                tier: "working",
                code: i.code,
                serialNo: i.serialNo,
                make: i.make,
                model: i.model,
                equipmentName: i.equipmentName || model?.equipmentName || "",
                rangeText: i.rangeText || model?.rangeText || "",
                resolutionText: model?.resolutionText ?? "",
                accuracyText: model?.accuracyText ?? "",
                createdByUserId: actor.id,
              };
            }),
          )
          .returning({ id: instruments.id, code: instruments.code });
        for (const row of created) idByCode.set(row.code.toLowerCase(), row.id);
      }

      const certIdByNumber = new Map<string, string>();
      const fresh = plan.certificates.filter((c) => !c.existingId);
      if (fresh.length > 0) {
        const created = await tx
          .insert(certificates)
          .values(
            fresh.map((c) => ({
              organisationId: actor.organisationId,
              kind: "imported",
              status: "issued",
              number: c.number,
              labName: snapshot.labName,
              certificateKind: c.certificateKind,
              siteId: c.siteId,
              calibratedOn: c.calibratedOn,
              validUntil: c.validUntil,
              // QA Tech's own loggers: QA Tech is the customer, as on the paper index.
              customerName: settings?.legalName ?? "",
              customerAddress: settings?.address ?? "",
              title: `${c.codes.length} instrument${c.codes.length === 1 ? "" : "s"} (imported)`,
              remarks: c.unnumbered
                ? `Imported from ${file.firstFileName}. The list gave no certificate number for these instruments.`
                : `Imported from ${file.firstFileName}.`,
              createdByUserId: actor.id,
            })),
          )
          .returning({ id: certificates.id, number: certificates.number });
        for (const row of created) certIdByNumber.set(row.number.toLowerCase(), row.id);
      }
      // Existing certificates keep their instruments; new ones are added after them.
      const existingIds = plan.certificates
        .map((c) => c.existingId)
        .filter((id): id is string => !!id);
      const nextPosition = new Map<string, number>();
      if (existingIds.length > 0) {
        const rows = await tx
          .select({
            certificateId: certificateItems.certificateId,
            next: sql<number>`coalesce(max(${certificateItems.position}) + 1, 0)::int`,
          })
          .from(certificateItems)
          .where(inArray(certificateItems.certificateId, existingIds))
          .groupBy(certificateItems.certificateId);
        for (const r of rows) nextPosition.set(r.certificateId, r.next);
      }
      const items = plan.certificates.flatMap((c) => {
        const certId = c.existingId ?? certIdByNumber.get(c.number.toLowerCase());
        if (!certId) return [];
        const start = nextPosition.get(certId) ?? 0;
        return c.codes
          .map((code) => idByCode.get(code.toLowerCase()))
          .filter((id): id is string => !!id)
          .map((instrumentId, n) => ({
            organisationId: actor.organisationId,
            certificateId: certId,
            instrumentId,
            position: start + n,
          }));
      });
      for (const part of chunks(items)) await tx.insert(certificateItems).values(part);

      // Full certificates from FT-05 workbooks: header, points, readings, masters.
      for (const c of plan.fullCertificates) {
        const model = c.modelKey ? modelByKey.get(c.modelKey) : undefined;
        const unlinked = c.masters.filter((m) => !m.certificateId);
        const [cert] = await tx
          .insert(certificates)
          .values({
            organisationId: actor.organisationId,
            kind: "imported",
            status: "issued",
            number: c.number,
            labName: snapshot.labName,
            certificateKind: c.certificateKind,
            siteId: c.siteId,
            calibratedOn: c.calibratedOn!,
            validUntil: c.validUntil,
            issuedOn: null,
            customerName: c.customerName || settings?.legalName || "",
            customerAddress: c.customerAddress || (c.customerName ? "" : (settings?.address ?? "")),
            title: `${c.make} ${c.equipmentName} (${c.codes.length})`.replace(/\s+/g, " ").trim(),
            location: c.location,
            department: c.department,
            equipmentName: c.equipmentName,
            make: c.make,
            model: c.model,
            rangeText: c.rangeText,
            resolutionText: c.resolutionText,
            accuracy: model?.accuracy ?? {},
            accuracyText: c.accuracyText,
            sopNo: c.sopNo,
            conditionOnReceipt: c.conditionOnReceipt,
            environmentTemperature: c.environmentTemperature,
            environmentHumidity: c.environmentHumidity,
            remarks: [
              `Imported from ${file.firstFileName} (${c.sheets.join(", ")}).`,
              ...unlinked.map(
                (m) =>
                  `Reference standard as printed: ${m.label}, certificate ${m.certificateNo}${m.validUntil ? `, due ${m.validUntil}` : ""}.`,
              ),
            ].join("\n"),
            createdByUserId: actor.id,
          })
          .returning({ id: certificates.id });
        const certId = cert!.id;
        const ids = c.codes.map((code) => idByCode.get(code.toLowerCase())!);
        const points = c.points.map((p, i) => ({
          seq: i + 1,
          quantity: p.quantity,
          reference: p.reference,
        }));
        const readings = c.points.flatMap((_, pi) =>
          ids.flatMap((instrumentId, ii) => {
            const reading = c.readings[pi]?.[ii] ?? "";
            return reading ? [{ seq: pi + 1, instrumentId, reading }] : [];
          }),
        );
        const evaluated = evaluate((model?.accuracy ?? {}) as AccuracySpec, points, readings);
        await tx.insert(certificateItems).values(
          ids.map((instrumentId, position) => ({
            organisationId: actor.organisationId,
            certificateId: certId,
            instrumentId,
            position,
            result:
              readings.filter((r) => r.instrumentId === instrumentId).length === points.length
                ? (evaluated.results.get(instrumentId) ?? null)
                : null,
          })),
        );
        await tx.insert(certificatePoints).values(
          c.points.map((p, i) => ({
            organisationId: actor.organisationId,
            certificateId: certId,
            seq: i + 1,
            quantity: p.quantity,
            reference: p.reference,
            condition: p.condition,
          })),
        );
        for (const part of chunks(evaluated.readings)) {
          await tx.insert(certificateReadings).values(
            part.map((r) => ({
              organisationId: actor.organisationId,
              certificateId: certId,
              seq: r.seq,
              instrumentId: r.instrumentId,
              reading: r.reading,
              deviation: r.deviation,
              tolerance: r.tolerance === null ? null : String(r.tolerance),
              judgement: r.judgement,
            })),
          );
        }
        const linked = c.masters.filter((m) => m.instrumentId && m.certificateId);
        if (linked.length > 0) {
          await tx.insert(certificateMasters).values(
            linked.map((m, position) => ({
              organisationId: actor.organisationId,
              certificateId: certId,
              instrumentId: m.instrumentId!,
              masterCertificateId: m.certificateId!,
              position,
            })),
          );
        }
      }

      // Numbers issued before QTech are never handed out again: each series continues after them.
      if (settings) {
        for (const number of [
          ...plan.certificates.filter((c) => !c.unnumbered).map((c) => c.number),
          ...plan.fullCertificates.map((c) => c.number),
        ]) {
          await noteUsedNumber(tx, {
            organisationId: actor.organisationId,
            kind: "certificate",
            format: settings.certificateNumberFormat,
            number,
            sites: snapshot.sites,
          });
        }
      }

      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: { type: "user", userId: actor.id },
        action: "instruments.imported",
        entityType: "stored_file",
        entityId: file.id,
        summary: `${actor.name} imported ${file.firstFileName}: ${summary.instruments} instruments${summary.idsGiven ? ` (${summary.idsGiven} given new IDs)` : ""}, ${summary.models} models, ${summary.certificates} certificates${summary.readings ? ` with ${summary.readings} readings` : ""} (${summary.skipped} rows skipped)`,
        after: {
          ...summary,
          instruments: plan.instruments.map((i) =>
            i.generated ? `${i.code}=${i.serialNo}` : i.code,
          ),
          certificates: [...plan.certificates, ...plan.fullCertificates].map((c) => c.number),
          skipped: plan.skipped,
        },
        request,
      });
      return summary;
    });
  } catch (error) {
    rethrowUnique(error, {
      instruments_org_code_key:
        "An instrument in the file was just added by someone else. Preview again.",
      instruments_org_serial_key:
        "A serial number in the file is already registered. Preview again.",
      instrument_models_org_make_model_key: "A model in the file was just added. Preview again.",
      certificates_org_lab_number_key:
        "A certificate in the file was just recorded. Preview again.",
    });
  }
}
