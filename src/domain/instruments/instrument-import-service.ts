import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/client-factory";
import {
  certificateItems,
  certificates,
  instrumentModels,
  instruments,
  organisationSettings,
  sites,
  storedFiles,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid, rethrowUnique } from "@/domain/clients/shared";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";

import { InstrumentsError } from "./errors";
import {
  planInstrumentImport,
  planSummary,
  readInstrumentList,
  type ImportPlan,
  type Snapshot,
} from "./instrument-import";
import { isInstrumentType, type InstrumentType } from "./types";

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
  defaultType: string,
): Promise<InstrumentImportPreview> {
  assertCan(actor, "instruments.manage");
  const { file, bytes } = await loadFile(db, blobs, actor, fileId);
  const read = await readInstrumentList(bytes);
  if (read.rows.length === 0) {
    throw new InstrumentsError(read.problems[0] ?? "No instruments found in this file.");
  }
  const plan = planInstrumentImport(read, await loadSnapshot(db, actor.organisationId), {
    defaultType: typeOption(defaultType),
  });
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
  defaultType: string,
  request: RequestInfo,
): Promise<ReturnType<typeof planSummary>> {
  assertCan(actor, "instruments.manage");
  const { file, bytes } = await loadFile(db, blobs, actor, fileId);
  const read = await readInstrumentList(bytes);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`instruments-import:${actor.organisationId}`}))`,
      );
      const snapshot = await loadSnapshot(tx, actor.organisationId);
      const plan = planInstrumentImport(read, snapshot, { defaultType: typeOption(defaultType) });
      const summary = planSummary(plan);
      if (summary.instruments === 0 && summary.certificateLinks === 0) {
        throw new InstrumentsError(
          "Nothing new to import: every instrument in the file is already registered.",
        );
      }

      const modelIds = new Map<string, string>();
      for (const m of snapshot.models)
        modelIds.set(`${m.make.toLowerCase().trim()}|${m.model.toLowerCase().trim()}`, m.id);
      for (const m of plan.models) {
        const [row] = await tx
          .insert(instrumentModels)
          .values({
            organisationId: actor.organisationId,
            type: m.type,
            make: m.make,
            model: m.model,
            equipmentName: m.equipmentName,
            quantities: m.quantities,
            rangeText: m.rangeText,
            createdByUserId: actor.id,
          })
          .returning({ id: instrumentModels.id });
        modelIds.set(m.key, row!.id);
      }

      const idByCode = new Map(snapshot.instruments.map((i) => [i.code.toLowerCase(), i.id]));
      for (const i of plan.instruments) {
        const [row] = await tx
          .insert(instruments)
          .values({
            organisationId: actor.organisationId,
            modelId: i.modelKey ? (modelIds.get(i.modelKey) ?? null) : null,
            type: i.type,
            tier: "working",
            code: i.code,
            serialNo: i.serialNo,
            make: i.make,
            model: i.model,
            equipmentName: i.equipmentName,
            rangeText: i.rangeText,
            createdByUserId: actor.id,
          })
          .returning({ id: instruments.id });
        idByCode.set(i.code.toLowerCase(), row!.id);
      }

      for (const c of plan.certificates) {
        let certId = c.existingId;
        if (!certId) {
          const [row] = await tx
            .insert(certificates)
            .values({
              organisationId: actor.organisationId,
              kind: "imported",
              status: "issued",
              number: c.number,
              labName: snapshot.labName,
              certificateKind: c.certificateKind,
              siteId: c.siteId,
              calibratedOn: c.calibratedOn,
              validUntil: c.validUntil,
              title: `${c.codes.length} instrument${c.codes.length === 1 ? "" : "s"} (imported)`,
              remarks: c.unnumbered
                ? `Imported from ${file.firstFileName}. The list gave no certificate number for these instruments.`
                : `Imported from ${file.firstFileName}.`,
              createdByUserId: actor.id,
            })
            .returning({ id: certificates.id });
          certId = row!.id;
        }
        const [{ next }] = (await tx
          .select({ next: sql<number>`coalesce(max(${certificateItems.position}) + 1, 0)::int` })
          .from(certificateItems)
          .where(eq(certificateItems.certificateId, certId))) as [{ next: number }];
        const ids = c.codes
          .map((code) => idByCode.get(code.toLowerCase()))
          .filter((id): id is string => !!id);
        if (ids.length > 0) {
          await tx.insert(certificateItems).values(
            ids.map((instrumentId, n) => ({
              organisationId: actor.organisationId,
              certificateId: certId!,
              instrumentId,
              position: next + n,
            })),
          );
        }
      }

      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: { type: "user", userId: actor.id },
        action: "instruments.imported",
        entityType: "stored_file",
        entityId: file.id,
        summary: `${actor.name} imported ${file.firstFileName}: ${summary.instruments} instruments, ${summary.models} models, ${summary.certificates} certificates (${summary.skipped} rows skipped)`,
        after: {
          ...summary,
          instruments: plan.instruments.map((i) => i.code),
          certificates: plan.certificates.map((c) => c.number),
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
