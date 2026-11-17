import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  certificateItems,
  certificateMasters,
  certificatePoints,
  certificateReadings,
  certificates,
  clientCompanies,
  instrumentModels,
  instruments,
  organisationSettings,
  signatures,
  sites,
  type Certificate,
  type DefaultPoint,
  type Instrument,
} from "@/db/schema";
import { assertCan, can, type Action } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { signRecord, type SignatureMeaning } from "@/domain/auth/signature-service";
import { isUuid } from "@/domain/clients/shared";
import { nextDueDate, todayInIndia } from "@/domain/clients/requalification";
import { allocateNumber } from "@/domain/numbering/allocate";
import { recordAudit } from "@/lib/audit";
import { move } from "@/lib/state-machine";
import { shortList } from "@/lib/text";

import { cleanDecimal, deviation, type AccuracySpec } from "./calibration-math";
import { certificatesOf, evaluate, lockInstruments } from "./certificate-service";
import { InstrumentsError } from "./errors";
import { calibrationHeaderSchema, pointSchema, type Loose } from "./schemas";
import {
  CERTIFICATE_FLOW,
  INSTRUMENT_TYPE_INFO,
  TYPE_MEASURES,
  type CertificateStatus,
  type InstrumentType,
  type Quantity,
} from "./types";
import { usableOn } from "./validity";

/** Most loggers QA Tech calibrates in one batch (two FT-05 pages of 10). */
export const MAX_BATCH = 40;

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

/** A calibration can't be dated in the future, and is due after it was done. */
export function checkCalibrationDates(calibratedOn: string, validUntil: string | null | undefined) {
  if (calibratedOn > todayInIndia()) {
    throw new InstrumentsError(
      "The date of calibration is in the future. Enter the day the readings were taken.",
    );
  }
  if (validUntil && validUntil <= calibratedOn) {
    throw new InstrumentsError("The due date must be after the date of calibration.");
  }
}

async function lockCertificate(
  tx: Transaction,
  actor: SessionUser,
  id: string,
): Promise<Certificate> {
  if (!isUuid(id)) throw new InstrumentsError("That certificate does not exist.");
  const [cert] = await tx
    .select()
    .from(certificates)
    .where(and(eq(certificates.id, id), eq(certificates.organisationId, actor.organisationId)))
    .for("update");
  if (!cert || cert.kind !== "internal")
    throw new InstrumentsError("That certificate does not exist.");
  return cert;
}

/**
 * Checks the masters are usable on the calibration date and returns, for each,
 * the certificate that covered that day — the next link in the traceability chain.
 */
async function resolveMasters(
  tx: Transaction,
  organisationId: string,
  masterIds: string[],
  calibratedOn: string,
): Promise<{ instrument: Instrument; certificateId: string }[]> {
  const masters = await lockInstruments(tx, organisationId, masterIds);
  const certs = await certificatesOf(tx, organisationId, masterIds);
  return masters.map((master) => {
    if (master.tier !== "master") {
      throw new InstrumentsError(`${master.code} is a working instrument, not a master standard.`);
    }
    const usable = usableOn(master, certs.get(master.id) ?? [], calibratedOn);
    if (!usable.ok) throw new InstrumentsError(`Master ${usable.message}`);
    return { instrument: master, certificateId: usable.certificate.id };
  });
}

/** All instruments on one certificate share a make and model (FT-05 prints one). */
async function modelOf(tx: Transaction, organisationId: string, uucs: Instrument[]) {
  const first = uucs[0];
  if (!first) throw new InstrumentsError("Add the instruments to calibrate.");
  // The same model from different Excel files is spelt "EBRO EBI20-TH1" and
  // "ebro EBI 20-TH1": the register's model decides, else make and model with
  // case, spaces and punctuation ignored.
  const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = (i: Instrument) => i.modelId ?? `${flat(i.make)}|${flat(i.model)}`;
  const odd = uucs.find((i) => key(i) !== key(first));
  if (odd) {
    throw new InstrumentsError(
      `${odd.code} is ${`${odd.make} ${odd.model}`.trim() || "another model"}, the others are ${`${first.make} ${first.model}`.trim() || "a different model"}. Put each model on its own certificate.`,
    );
  }
  const bad = uucs.find((i) => i.status === "retired" || i.status === "lost");
  if (bad) throw new InstrumentsError(`${bad.code} is ${bad.status}; it can't be calibrated.`);
  if (!first.modelId) return null;
  const [model] = await tx
    .select()
    .from(instrumentModels)
    .where(
      and(
        eq(instrumentModels.id, first.modelId),
        eq(instrumentModels.organisationId, organisationId),
      ),
    );
  return model ?? null;
}

const createSchema = z.object({
  header: calibrationHeaderSchema.partial({ certificateKind: true, equipmentName: true }),
  instrumentIds: z
    .array(z.string())
    .min(1, "Add the instruments to calibrate.")
    .max(MAX_BATCH, `Calibrate at most ${MAX_BATCH} instruments on one certificate.`),
  masterIds: z.array(z.string()).max(10),
  /** Start from an earlier certificate: same points, masters still valid, same texts. */
  fromCertificateId: z.string().uuid().optional(),
});

/**
 * Starts a QA Tech calibration certificate (FT-05) as a draft: the number is
 * taken now from the site's series for this month and kind, and everything
 * that can be known is filled in from the model, the masters and the previous
 * certificate.
 */
export async function createCalibration(
  db: Database,
  actor: SessionUser,
  input: {
    header: Loose<z.input<typeof createSchema>["header"]>;
    instrumentIds: string[];
    masterIds: string[];
    fromCertificateId?: string;
  },
  request: RequestInfo,
): Promise<Certificate> {
  assertCan(actor, "calibration.perform");
  const data = createSchema.parse(input);
  checkCalibrationDates(data.header.calibratedOn, data.header.validUntil as string | null);
  const instrumentIds = [...new Set(data.instrumentIds)];
  return db.transaction(async (tx) => {
    const uucs = await lockInstruments(tx, actor.organisationId, instrumentIds);
    const model = await modelOf(tx, actor.organisationId, uucs);
    const first = uucs[0]!;
    const calibratedOn = data.header.calibratedOn;

    let template: Certificate | null = null;
    let templatePoints: { quantity: string; reference: string; condition: string }[] = [];
    let masterIds = [...new Set(data.masterIds)];
    if (data.fromCertificateId) {
      const [found] = await tx
        .select()
        .from(certificates)
        .where(
          and(
            eq(certificates.id, data.fromCertificateId),
            eq(certificates.organisationId, actor.organisationId),
          ),
        );
      template = found ?? null;
      if (!template) throw new InstrumentsError("The certificate to copy from does not exist.");
      templatePoints = await tx
        .select({
          quantity: certificatePoints.quantity,
          reference: certificatePoints.reference,
          condition: certificatePoints.condition,
        })
        .from(certificatePoints)
        .where(eq(certificatePoints.certificateId, template.id))
        .orderBy(asc(certificatePoints.seq));
      if (masterIds.length === 0) {
        masterIds = (
          await tx
            .select({ id: certificateMasters.instrumentId })
            .from(certificateMasters)
            .where(eq(certificateMasters.certificateId, template.id))
            .orderBy(asc(certificateMasters.position))
        ).map((m) => m.id);
      }
    }
    const masters = await resolveMasters(tx, actor.organisationId, masterIds, calibratedOn);

    const [site] = await tx
      .select()
      .from(sites)
      .where(and(eq(sites.id, data.header.siteId), eq(sites.organisationId, actor.organisationId)));
    if (!site) throw new InstrumentsError("Choose one of QA Tech's sites.");
    const [settings] = await tx
      .select()
      .from(organisationSettings)
      .where(eq(organisationSettings.organisationId, actor.organisationId));
    if (!settings) throw new InstrumentsError("Settings are missing. Run the seed command.");

    let customerName = settings.legalName;
    let customerAddress = settings.address;
    if (data.header.customerCompanyId) {
      const [client] = await tx
        .select()
        .from(clientCompanies)
        .where(
          and(
            eq(clientCompanies.id, data.header.customerCompanyId),
            eq(clientCompanies.organisationId, actor.organisationId),
          ),
        );
      if (!client) throw new InstrumentsError("Choose one of the clients.");
      customerName = client.name;
      customerAddress = client.address;
    }

    const certificateKind =
      data.header.certificateKind ||
      INSTRUMENT_TYPE_INFO[first.type as InstrumentType]?.certificateKind ||
      "CAL";
    // Skip numbers already on a certificate (e.g. imported from before QTech), so none repeats.
    let number = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      ({ number } = await allocateNumber(tx, {
        organisationId: actor.organisationId,
        kind: "certificate",
        format: settings.certificateNumberFormat,
        date: new Date(`${calibratedOn}T12:00:00+05:30`),
        siteCode: site.code,
        siteName: site.name,
        certificateKind,
      }));
      const [taken] = await tx
        .select({ id: certificates.id })
        .from(certificates)
        .where(
          and(
            eq(certificates.organisationId, actor.organisationId),
            sql`lower(${certificates.labName}) = lower(${settings.shortName})`,
            sql`lower(${certificates.number}) = lower(${number})`,
          ),
        );
      if (!taken) break;
    }

    const interval = first.intervalMonths ?? model?.intervalMonths ?? 12;
    const pick = <K extends keyof typeof data.header>(key: K, fallback: string) =>
      (data.header[key] as string | undefined) || fallback;
    const [cert] = await tx
      .insert(certificates)
      .values({
        organisationId: actor.organisationId,
        kind: "internal",
        status: "draft",
        number,
        labName: settings.shortName,
        certificateKind,
        siteId: site.id,
        calibratedOn,
        // Left blank: due one interval later, less a day (26.03.2026 → 25.03.2027).
        validUntil: data.header.validUntil ?? nextDueDate(calibratedOn, interval),
        customerCompanyId: data.header.customerCompanyId ?? null,
        customerName,
        customerAddress,
        title: pick("title", `${first.make} ${first.equipmentName} (${uucs.length})`.trim()),
        location: pick("location", template?.location ?? site.name),
        department: pick("department", template?.department ?? "Process Validation"),
        equipmentName: pick("equipmentName", first.equipmentName || model?.equipmentName || ""),
        make: pick("make", first.make),
        model: pick("model", first.model),
        rangeText: pick("rangeText", first.rangeText || model?.rangeText || ""),
        resolutionText: pick("resolutionText", first.resolutionText || model?.resolutionText || ""),
        accuracy: (first.accuracy ?? model?.accuracy ?? {}) as AccuracySpec,
        accuracyText: pick("accuracyText", first.accuracyText || model?.accuracyText || ""),
        sopNo: pick("sopNo", template?.sopNo || model?.calibrationSop || ""),
        conditionOnReceipt: pick("conditionOnReceipt", "Good"),
        environmentTemperature: pick("environmentTemperature", ""),
        environmentHumidity: pick("environmentHumidity", ""),
        remarks: pick("remarks", template?.remarks ?? ""),
        performedByUserId: actor.id,
        performedByName: actor.name,
        createdByUserId: actor.id,
      })
      .returning();
    if (!cert) throw new Error("Certificate insert returned no row");

    await tx.insert(certificateItems).values(
      uucs.map((i, position) => ({
        organisationId: actor.organisationId,
        certificateId: cert.id,
        instrumentId: i.id,
        position,
      })),
    );
    if (masters.length > 0) {
      await tx.insert(certificateMasters).values(
        masters.map((m, position) => ({
          organisationId: actor.organisationId,
          certificateId: cert.id,
          instrumentId: m.instrument.id,
          masterCertificateId: m.certificateId,
          position,
        })),
      );
    }
    // Test points: from the certificate copied, else the model's usual points (references blank until measured).
    const points =
      templatePoints.length > 0 ? templatePoints : ((model?.defaultPoints ?? []) as DefaultPoint[]);
    const usable = points.filter((p) => cleanDecimal(p.reference) !== null);
    if (usable.length > 0) {
      await tx.insert(certificatePoints).values(
        usable.map((p, i) => ({
          organisationId: actor.organisationId,
          certificateId: cert.id,
          seq: i + 1,
          quantity: p.quantity,
          reference: cleanDecimal(p.reference)!,
          condition: p.condition,
        })),
      );
    }
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "certificate.created",
      entityType: "certificate",
      entityId: cert.id,
      summary: `${actor.name} started calibration certificate ${number} for ${uucs.length} instrument${uucs.length === 1 ? "" : "s"} (${shortList(uucs.map((i) => i.code))})`,
      after: {
        number,
        calibratedOn,
        instruments: uucs.map((i) => i.code),
        masters: masters.map((m) => m.instrument.code),
      },
      request,
    });
    return cert;
  });
}

const saveSchema = z.object({
  header: calibrationHeaderSchema.omit({
    siteId: true,
    certificateKind: true,
    customerCompanyId: true,
  }),
  points: z.array(pointSchema).max(30),
  masterIds: z.array(z.string()).max(10),
  instrumentIds: z.array(z.string()).min(1, "Keep at least one instrument.").max(MAX_BATCH),
  /** readings[pointIndex][instrumentIndex], as typed ("" = not yet measured). */
  readings: z.array(z.array(z.string().max(20))).max(30),
});
export type CalibrationSave = z.input<typeof saveSchema>;

/**
 * Saves a draft: header, points, masters, instruments and the readings grid.
 * Deviations and pass/fail are recalculated on the server from what was typed.
 */
export async function saveCalibration(
  db: Database,
  actor: SessionUser,
  certificateId: string,
  input: CalibrationSave,
  request: RequestInfo,
): Promise<{ missing: number; failed: number }> {
  assertCan(actor, "calibration.perform");
  const data = saveSchema.parse(input);
  checkCalibrationDates(data.header.calibratedOn, data.header.validUntil as string | null);
  return db.transaction(async (tx) => {
    const cert = await lockCertificate(tx, actor, certificateId);
    if (cert.status !== "draft") {
      throw new InstrumentsError(
        "This certificate is being checked or is issued. Return it to draft to change it.",
      );
    }
    const instrumentIds = [...new Set(data.instrumentIds)];
    const uucs = await lockInstruments(tx, actor.organisationId, instrumentIds);
    const model = await modelOf(tx, actor.organisationId, uucs);
    const masters = await resolveMasters(
      tx,
      actor.organisationId,
      [...new Set(data.masterIds)],
      data.header.calibratedOn,
    );

    const points = data.points.map((p, i) => {
      const reference = cleanDecimal(p.reference);
      if (reference === null)
        throw new InstrumentsError(`Point ${i + 1}: enter the master reading as a number.`);
      return { seq: i + 1, quantity: p.quantity, reference, condition: p.condition };
    });
    const readings: { seq: number; instrumentId: string; reading: string }[] = [];
    let missing = 0;
    for (const [pi, point] of points.entries()) {
      for (const [ii, uuc] of uucs.entries()) {
        const raw = data.readings[pi]?.[ii] ?? "";
        if (raw.trim() === "") {
          missing += 1;
          continue;
        }
        const reading = cleanDecimal(raw);
        if (reading === null)
          throw new InstrumentsError(`${uuc.code}, point ${pi + 1}: “${raw}” is not a number.`);
        // A serial number or a slip of the keyboard, not a calibration result.
        const off = Math.abs(Number(deviation(reading, point.reference)));
        if (point.quantity !== "pressure" && off > 50) {
          throw new InstrumentsError(
            `${uuc.code}, point ${pi + 1}: ${raw} is ${off.toFixed(0)} away from the master reading ${point.reference}. Is it a serial number or a typo?`,
          );
        }
        readings.push({ seq: point.seq, instrumentId: uuc.id, reading });
      }
    }
    const accuracy = (uucs[0]!.accuracy ?? model?.accuracy ?? cert.accuracy) as AccuracySpec;
    const evaluated = evaluate(accuracy, points, readings);

    // Replace the draft's children with what was saved.
    await tx.delete(certificateReadings).where(eq(certificateReadings.certificateId, cert.id));
    await tx.delete(certificatePoints).where(eq(certificatePoints.certificateId, cert.id));
    await tx.delete(certificateMasters).where(eq(certificateMasters.certificateId, cert.id));
    await tx.delete(certificateItems).where(eq(certificateItems.certificateId, cert.id));
    await tx.insert(certificateItems).values(
      uucs.map((i, position) => ({
        organisationId: actor.organisationId,
        certificateId: cert.id,
        instrumentId: i.id,
        position,
        // A result only once every point has been read for this instrument.
        result:
          points.length > 0 &&
          evaluated.readings.filter((r) => r.instrumentId === i.id).length === points.length
            ? (evaluated.results.get(i.id) ?? null)
            : null,
      })),
    );
    if (masters.length > 0) {
      await tx.insert(certificateMasters).values(
        masters.map((m, position) => ({
          organisationId: actor.organisationId,
          certificateId: cert.id,
          instrumentId: m.instrument.id,
          masterCertificateId: m.certificateId,
          position,
        })),
      );
    }
    if (points.length > 0) {
      await tx.insert(certificatePoints).values(
        points.map((p) => ({
          ...p,
          organisationId: actor.organisationId,
          certificateId: cert.id,
        })),
      );
    }
    if (evaluated.readings.length > 0) {
      await tx.insert(certificateReadings).values(
        evaluated.readings.map((r) => ({
          organisationId: actor.organisationId,
          certificateId: cert.id,
          seq: r.seq,
          instrumentId: r.instrumentId,
          reading: r.reading,
          deviation: r.deviation,
          tolerance: r.tolerance === null ? null : String(r.tolerance),
          judgement: r.judgement,
        })),
      );
    }
    await tx
      .update(certificates)
      .set({
        ...data.header,
        validUntil:
          data.header.validUntil ??
          nextDueDate(
            data.header.calibratedOn,
            uucs[0]!.intervalMonths ?? model?.intervalMonths ?? 12,
          ),
        accuracy,
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, cert.id));
    const failed = evaluated.readings.filter((r) => r.judgement === "fail").length;
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "certificate.updated",
      entityType: "certificate",
      entityId: cert.id,
      summary: `${actor.name} saved ${cert.number}: ${uucs.length} instruments, ${points.length} points, ${evaluated.readings.length} readings${failed ? `, ${failed} outside accuracy` : ""}`,
      after: {
        calibratedOn: data.header.calibratedOn,
        instruments: uucs.map((i) => i.code),
        masters: masters.map((m) => m.instrument.code),
      },
      request,
    });
    return { missing, failed };
  });
}

/**
 * A SHA-256 over exactly what the certificate says. Signatures store it, so a
 * signature can never be moved onto changed content.
 */
export async function certificateContentHash(
  tx: Transaction | Database,
  certificateId: string,
): Promise<string> {
  const [cert] = await tx.select().from(certificates).where(eq(certificates.id, certificateId));
  if (!cert) throw new InstrumentsError("That certificate does not exist.");
  // One query at a time: a transaction is a single connection.
  const [items, points, readings, masters] = [
    await tx
      .select()
      .from(certificateItems)
      .where(eq(certificateItems.certificateId, certificateId))
      .orderBy(asc(certificateItems.position)),
    await tx
      .select()
      .from(certificatePoints)
      .where(eq(certificatePoints.certificateId, certificateId))
      .orderBy(asc(certificatePoints.seq)),
    await tx
      .select()
      .from(certificateReadings)
      .where(eq(certificateReadings.certificateId, certificateId)),
    await tx
      .select()
      .from(certificateMasters)
      .where(eq(certificateMasters.certificateId, certificateId))
      .orderBy(asc(certificateMasters.position)),
  ];
  // Workflow fields change as people sign; they are not what the certificate says.
  const {
    status: _status,
    updatedAt: _updatedAt,
    fileId: _fileId,
    issuedOn: _issuedOn,
    preparedByName: _preparedBy,
    ...header
  } = cert;
  void [_status, _updatedAt, _fileId, _issuedOn, _preparedBy];
  const content = {
    header,
    items: items.map((i) => [i.instrumentId, i.position, i.result]),
    points: points.map((p) => [p.seq, p.quantity, p.reference, p.condition]),
    readings: readings
      .map((r) => [r.seq, r.instrumentId, r.reading, r.deviation, r.judgement])
      .sort((a, b) => String(a).localeCompare(String(b))),
    masters: masters.map((m) => [m.instrumentId, m.masterCertificateId]),
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** Who signed what on a certificate, oldest first. */
export async function certificateSignatures(
  tx: Transaction | Database,
  organisationId: string,
  certificateId: string,
) {
  return tx
    .select()
    .from(signatures)
    .where(
      and(
        eq(signatures.organisationId, organisationId),
        eq(signatures.entityType, "certificate"),
        eq(signatures.entityId, certificateId),
      ),
    )
    .orderBy(asc(signatures.signedAt));
}

const STEPS: Record<
  "submit" | "check" | "approve",
  {
    from: CertificateStatus;
    to: CertificateStatus;
    meaning: SignatureMeaning;
    action: Action;
    audit: "certificate.submitted" | "certificate.checked" | "certificate.issued";
    verb: string;
  }
> = {
  submit: {
    from: "draft",
    to: "checking",
    meaning: "done_by",
    action: "calibration.perform",
    audit: "certificate.submitted",
    verb: "signed Calibration done by",
  },
  check: {
    from: "checking",
    to: "approving",
    meaning: "checked_by",
    action: "calibration.check",
    audit: "certificate.checked",
    verb: "signed Certificate checked by",
  },
  approve: {
    from: "approving",
    to: "issued",
    meaning: "approved_by",
    action: "calibration.approve",
    audit: "certificate.issued",
    verb: "approved and issued",
  },
};

/**
 * One sign-off step with a password re-entered (21 CFR Part 11 style):
 * done by → checked by → approved by. The checker and the approver must be
 * different people from whoever did the calibration.
 */
export async function signCalibrationStep(
  db: Database,
  actor: SessionUser,
  input: { certificateId: string; step: "submit" | "check" | "approve"; password: string },
  request: RequestInfo,
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const step = STEPS[input.step];
  assertCan(actor, step.action);
  // Check everything that can be checked before asking for the signature.
  const hash = await db.transaction(async (tx) => {
    const cert = await lockCertificate(tx, actor, input.certificateId);
    if (cert.status !== step.from)
      throw new InstrumentsError(`This certificate is ${cert.status}, not ready for this step.`);
    if (input.step === "submit") await assertComplete(tx, actor, cert);
    if (input.step !== "submit") {
      const doneBy = (await certificateSignatures(tx, actor.organisationId, cert.id))
        .filter((s) => s.meaning === "done_by")
        .at(-1);
      if (doneBy?.userId === actor.id) {
        throw new InstrumentsError(
          "Someone other than the person who did the calibration must check and approve it.",
        );
      }
    }
    return certificateContentHash(tx, cert.id);
  });

  const signed = await signRecord(
    db,
    actor,
    {
      meaning: step.meaning,
      entityType: "certificate",
      entityId: input.certificateId,
      recordHash: hash,
      password: input.password,
    },
    request,
  );
  if (!signed.ok) return { ok: false, message: signed.message };

  return db.transaction(async (tx) => {
    const cert = await lockCertificate(tx, actor, input.certificateId);
    if (cert.status !== step.from || (await certificateContentHash(tx, cert.id)) !== hash) {
      throw new InstrumentsError("The certificate changed while you were signing. Open it again.");
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    await tx
      .update(certificates)
      .set({
        status: move(CERTIFICATE_FLOW, cert.status as CertificateStatus, step.to),
        updatedAt: new Date(),
        ...(input.step === "submit" ? { preparedByName: actor.name } : {}),
        ...(input.step === "approve" ? { issuedOn: today } : {}),
      })
      .where(eq(certificates.id, cert.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: step.audit,
      entityType: "certificate",
      entityId: cert.id,
      summary: `${actor.name} ${step.verb} ${cert.number}`,
      after: { status: step.to, contentSha256: hash },
      request,
    });
    return { ok: true as const, status: step.to };
  });
}

/** Ready to sign: masters valid, every instrument read at every point. */
async function assertComplete(tx: Transaction, actor: SessionUser, cert: Certificate) {
  // One query at a time: a transaction is a single connection.
  const [items, points, readings, masters] = [
    await tx.select().from(certificateItems).where(eq(certificateItems.certificateId, cert.id)),
    await tx.select().from(certificatePoints).where(eq(certificatePoints.certificateId, cert.id)),
    await tx
      .select()
      .from(certificateReadings)
      .where(eq(certificateReadings.certificateId, cert.id)),
    await tx.select().from(certificateMasters).where(eq(certificateMasters.certificateId, cert.id)),
  ];
  if (masters.length === 0) throw new InstrumentsError("Add the master standard(s) used.");
  if (!cert.environmentTemperature.trim() || !cert.environmentHumidity.trim()) {
    throw new InstrumentsError("Enter the lab temperature and humidity during calibration.");
  }
  if (points.length === 0) throw new InstrumentsError("Add the test points.");
  const missing = items.length * points.length - readings.length;
  if (missing > 0)
    throw new InstrumentsError(`${missing} reading${missing === 1 ? " is" : "s are"} still empty.`);
  // Each quantity measured needs a master that measures it (a %RH point needs a humidity reference).
  const masterRows = await tx
    .select({ type: instruments.type, code: instruments.code, modelId: instruments.modelId })
    .from(instruments)
    .where(
      inArray(
        instruments.id,
        masters.map((m) => m.instrumentId),
      ),
    );
  for (const quantity of new Set(points.map((p) => p.quantity as Quantity))) {
    const covered = masterRows.some((m) =>
      TYPE_MEASURES[m.type as InstrumentType]?.includes(quantity),
    );
    if (!covered) {
      throw new InstrumentsError(
        `There are ${quantity === "humidity" ? "%RH" : quantity === "pressure" ? "pressure" : "°C"} points but no master for ${quantity}. Add the ${quantity === "humidity" ? "humidity indicator" : "reference"} used.`,
      );
    }
  }
  // Masters must still be valid on the calibration date (their certificate may have been cancelled since).
  await resolveMasters(
    tx,
    actor.organisationId,
    masters.map((m) => m.instrumentId),
    cert.calibratedOn,
  );
}

/** Sends a certificate in checking or approval back to draft, with the reason. */
export async function returnCalibration(
  db: Database,
  actor: SessionUser,
  input: { certificateId: string; reason: string },
  request: RequestInfo,
): Promise<void> {
  if (!can(actor, "calibration.check") && !can(actor, "calibration.approve")) {
    assertCan(actor, "calibration.check");
  }
  const reason = z.string().trim().min(3, "Say what needs fixing.").max(2000).parse(input.reason);
  await db.transaction(async (tx) => {
    const cert = await lockCertificate(tx, actor, input.certificateId);
    if (cert.status !== "checking" && cert.status !== "approving") {
      throw new InstrumentsError("Only a certificate being checked or approved can be returned.");
    }
    // Whoever's turn it is may send it back.
    assertCan(actor, cert.status === "checking" ? "calibration.check" : "calibration.approve");
    await tx
      .update(certificates)
      .set({
        status: move(CERTIFICATE_FLOW, cert.status as CertificateStatus, "draft"),
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, cert.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "certificate.returned",
      entityType: "certificate",
      entityId: cert.id,
      summary: `${actor.name} returned ${cert.number} for correction`,
      before: { status: cert.status },
      reason,
      request,
    });
  });
}

/** Stores the frozen PDF of an issued certificate. */
export async function attachIssuedPdf(
  db: Database,
  actor: SessionUser,
  certificateId: string,
  fileId: string,
): Promise<string> {
  // Returns the file that is now attached: the first one stored wins.
  return db.transaction(async (tx) => {
    const cert = await lockCertificate(tx, actor, certificateId);
    if (cert.status !== "issued")
      throw new InstrumentsError("Only issued certificates get a final PDF.");
    if (cert.fileId) return cert.fileId;
    await tx.update(certificates).set({ fileId }).where(eq(certificates.id, cert.id));
    return fileId;
  });
}
