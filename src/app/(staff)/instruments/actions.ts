"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import {
  createCalibration,
  returnCalibration,
  saveCalibration,
  signCalibrationStep,
  type CalibrationSave,
} from "@/domain/instruments/calibration-service";
import {
  cancelCertificate,
  createExternalCertificate,
} from "@/domain/instruments/certificate-service";
import { InstrumentsError } from "@/domain/instruments/errors";
import {
  applyInstrumentImport,
  previewInstrumentImport,
  type ImportChoices,
  type InstrumentImportPreview,
} from "@/domain/instruments/instrument-import-service";
import {
  bulkAddInstruments,
  createInstrument,
  saveModel,
  updateInstrument,
} from "@/domain/instruments/instrument-service";
import { resolveInstrumentList } from "@/domain/instruments/queries";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/**
 * Server actions for the Instruments screens. Each re-checks the session and
 * hands raw strings to a domain service, which validates them and checks the
 * person's permission.
 */

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const fields = <K extends string>(formData: FormData, names: readonly K[]) =>
  Object.fromEntries(names.map((n) => [n, field(formData, n)])) as Record<K, string>;
const all = (formData: FormData, name: string) =>
  formData.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");

function refresh(...paths: string[]) {
  revalidatePath("/instruments");
  for (const p of paths) revalidatePath(p);
}

const MODEL_FIELDS = [
  "type",
  "make",
  "model",
  "equipmentName",
  "rangeText",
  "resolutionText",
  "accuracyText",
  "calibrationSop",
  "intervalMonths",
] as const;
const ACCURACY_FIELDS = [
  "temperature",
  "temperatureBandFrom",
  "temperatureBandTo",
  "temperatureBandTolerance",
  "humidity",
  "pressure",
] as const;

export async function saveModelAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const modelId = field(formData, "modelId") || null;
  const result = await runAction(
    async () => {
      let points: unknown = [];
      try {
        points = JSON.parse(field(formData, "defaultPoints") || "[]");
      } catch {
        throw new InstrumentsError("The test points could not be read. Reload and try again.");
      }
      await saveModel(
        db,
        actor,
        modelId,
        {
          ...fields(formData, MODEL_FIELDS),
          quantities: all(formData, "quantities"),
          accuracy: Object.fromEntries(
            ACCURACY_FIELDS.map((k) => [k, field(formData, `accuracy.${k}`)]),
          ),
          defaultPoints: points,
        },
        await getRequestInfo(),
      );
    },
    modelId ? "Model saved." : "Model added.",
  );
  if (result.ok) refresh("/instruments/models");
  return result;
}

const INSTRUMENT_FIELDS = [
  "modelId",
  "type",
  "tier",
  "code",
  "serialNo",
  "make",
  "model",
  "equipmentName",
  "rangeText",
  "resolutionText",
  "accuracyText",
  "homeSiteId",
  "ownerCompanyId",
  "status",
  "intervalMonths",
  "notes",
] as const;

export async function saveInstrumentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  const instrumentId = field(formData, "instrumentId");
  const values = fields(formData, INSTRUMENT_FIELDS);
  const result = await runAction(async () => {
    if (instrumentId) {
      const { changed } = await updateInstrument(
        db,
        actor,
        instrumentId,
        { ...values, reason: field(formData, "reason") },
        await getRequestInfo(),
      );
      return { id: instrumentId, changed: changed.length };
    }
    const created = await createInstrument(db, actor, values, await getRequestInfo());
    return { id: created.id, changed: 1 };
  });
  if (!result.ok) return result;
  refresh(`/instruments/${result.data.id}`);
  return {
    ok: true,
    data: { id: result.data.id },
    message: instrumentId
      ? result.data.changed
        ? "Saved."
        : "Nothing changed."
      : "Instrument added.",
  };
}

export async function bulkAddAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ codes: string[] }>> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const added = await bulkAddInstruments(
      db,
      actor,
      fields(formData, ["modelId", "homeSiteId", "serials", "codePrefix", "tier"] as const),
      await getRequestInfo(),
    );
    return { codes: added.map((i) => i.code) };
  });
  if (!result.ok) return result;
  refresh();
  const codes = result.data.codes;
  return {
    ...result,
    message: `Added ${codes.length} instrument${codes.length === 1 ? "" : "s"}: ${codes[0]}${codes.length > 1 ? ` to ${codes.at(-1)}` : ""}.`,
  };
}

const EXTERNAL_FIELDS = [
  "number",
  "ulrNo",
  "labName",
  "labAccreditation",
  "calibratedOn",
  "calibratedUntil",
  "validUntil",
  "issuedOn",
  "remarks",
] as const;

export async function recordExternalCertificateAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const instrumentIds = all(formData, "instrumentIds");
  const result = await runAction(async () => {
    await createExternalCertificate(
      db,
      actor,
      {
        ...fields(formData, EXTERNAL_FIELDS),
        instrumentIds,
        fileId: field(formData, "fileId") || null,
      },
      await getRequestInfo(),
    );
  }, "Certificate recorded.");
  if (result.ok)
    refresh(...instrumentIds.map((id) => `/instruments/${id}`), "/instruments/certificates");
  return result;
}

const HEADER_FIELDS = [
  "siteId",
  "certificateKind",
  "calibratedOn",
  "validUntil",
  "customerCompanyId",
  "title",
  "location",
  "department",
  "equipmentName",
  "make",
  "model",
  "rangeText",
  "resolutionText",
  "accuracyText",
  "sopNo",
  "conditionOnReceipt",
  "environmentTemperature",
  "environmentHumidity",
  "remarks",
] as const;

/** Starts a calibration from a pasted list of instrument IDs or serials. */
export async function createCalibrationAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const pasted = await resolveInstrumentList(db, actor, field(formData, "instruments"));
    if (pasted.unknown.length > 0) {
      throw new InstrumentsError(
        `Not registered: ${pasted.unknown.slice(0, 10).join(", ")}${pasted.unknown.length > 10 ? "…" : ""}. Add them to the register first.`,
      );
    }
    if (pasted.ambiguous.length > 0) {
      throw new InstrumentsError(
        `${pasted.ambiguous.join(", ")} match more than one instrument. Use QA Tech's ID instead.`,
      );
    }
    // Only what the form sent: anything else comes from the model or the copied certificate.
    const header = Object.fromEntries(
      HEADER_FIELDS.filter((n) => formData.has(n)).map((n) => [n, field(formData, n)]),
    ) as Partial<Record<(typeof HEADER_FIELDS)[number], string>> & {
      siteId: string;
      calibratedOn: string;
    };
    const cert = await createCalibration(
      db,
      actor,
      {
        header: { ...header, certificateKind: header.certificateKind || undefined },
        instrumentIds: pasted.ids,
        masterIds: all(formData, "masterIds"),
        fromCertificateId: field(formData, "fromCertificateId") || undefined,
      },
      await getRequestInfo(),
    );
    return cert.id;
  });
  if (!result.ok) return result;
  refresh("/instruments/certificates");
  redirect(`/instruments/certificates/${result.data}`);
}

export async function saveCalibrationAction(
  certificateId: string,
  input: CalibrationSave,
): Promise<ActionResult<{ missing: number; failed: number }>> {
  const actor = await requireUser();
  const result = await runAction(async () =>
    saveCalibration(db, actor, certificateId, input, await getRequestInfo()),
  );
  if (result.ok) refresh(`/instruments/certificates/${certificateId}`);
  return result;
}

export async function signStepAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  const actor = await requireUser();
  const certificateId = field(formData, "certificateId");
  const step = field(formData, "step");
  if (step !== "submit" && step !== "check" && step !== "approve") {
    return { ok: false, error: "Unknown step." };
  }
  const result = await runAction(async () => {
    const signed = await signCalibrationStep(
      db,
      actor,
      { certificateId, step, password: field(formData, "password") },
      await getRequestInfo(),
    );
    if (!signed.ok) throw new InstrumentsError(signed.message);
    return { status: signed.status };
  });
  if (result.ok) refresh(`/instruments/certificates/${certificateId}`, "/instruments/certificates");
  return result;
}

export async function returnCalibrationAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const certificateId = field(formData, "certificateId");
  const result = await runAction(
    async () =>
      returnCalibration(
        db,
        actor,
        { certificateId, reason: field(formData, "reason") },
        await getRequestInfo(),
      ),
    "Returned for correction.",
  );
  if (result.ok) refresh(`/instruments/certificates/${certificateId}`);
  return result;
}

export async function cancelCertificateAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const certificateId = field(formData, "certificateId");
  const result = await runAction(
    async () =>
      cancelCertificate(
        db,
        actor,
        { certificateId, reason: field(formData, "reason") },
        await getRequestInfo(),
      ),
    "Certificate cancelled.",
  );
  if (result.ok) refresh(`/instruments/certificates/${certificateId}`, "/instruments/certificates");
  return result;
}

export async function previewInstrumentImportAction(
  fileId: string,
  choices: ImportChoices,
): Promise<ActionResult<InstrumentImportPreview>> {
  const actor = await requireUser();
  return runAction(() => previewInstrumentImport(db, blobStore, actor, fileId, choices));
}

export async function applyInstrumentImportAction(
  fileId: string,
  choices: ImportChoices,
): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const s = await applyInstrumentImport(
      db,
      blobStore,
      actor,
      fileId,
      choices,
      await getRequestInfo(),
    );
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
    return `Imported ${n(s.instruments, "instrument")} and ${n(s.certificates, "certificate")}${s.readings ? ` with ${n(s.readings, "reading")}` : ""}${s.skipped ? `; ${n(s.skipped, "row")} skipped` : ""}.`;
  });
  if (!result.ok) return result;
  refresh("/instruments/certificates");
  return { ok: true, data: undefined, message: result.data };
}
