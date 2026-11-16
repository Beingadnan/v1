import "server-only";

import { and, eq, inArray, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

import type { Database, DbExecutor, Transaction } from "@/db/client-factory";
import {
  certificateItems,
  certificatePoints,
  certificateReadings,
  certificates,
  instruments,
  storedFiles,
  type Certificate,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid, rethrowUnique } from "@/domain/clients/shared";
import { recordAudit } from "@/lib/audit";
import { move } from "@/lib/state-machine";
import { shortList } from "@/lib/text";

import { cleanDecimal, deviation, judge, toleranceAt } from "./calibration-math";
import { InstrumentsError } from "./errors";
import { externalCertificateSchema, type ExternalCertificateInput } from "./schemas";
import { CERTIFICATE_FLOW, QUANTITIES, type CertificateStatus } from "./types";
import type { CertificateDates } from "./validity";

const CERTIFICATE_UNIQUE = {
  certificates_org_lab_number_key:
    "A certificate with this number from this lab is already recorded.",
};

/** Every certificate (in any state) of the given instruments, newest first. */
export async function certificatesOf(
  executor: DbExecutor,
  organisationId: string,
  /**
   * The instruments, as ids or as a subquery of ids. A subquery ("the
   * instruments booked on this job") lets the read go out with the one that
   * finds them instead of after it (ADR 0018).
   */
  instrumentIds: string[] | SQLWrapper,
): Promise<Map<string, (CertificateDates & { kind: string; labName: string })[]>> {
  const result = new Map<string, (CertificateDates & { kind: string; labName: string })[]>();
  if (Array.isArray(instrumentIds) && instrumentIds.length === 0) return result;
  const rows = await executor
    .select({
      instrumentId: certificateItems.instrumentId,
      id: certificates.id,
      number: certificates.number,
      status: certificates.status,
      kind: certificates.kind,
      labName: certificates.labName,
      calibratedOn: certificates.calibratedOn,
      validUntil: certificates.validUntil,
    })
    .from(certificateItems)
    .innerJoin(certificates, eq(certificates.id, certificateItems.certificateId))
    .where(
      and(
        eq(certificateItems.organisationId, organisationId),
        inArray(certificateItems.instrumentId, instrumentIds),
      ),
    );
  for (const { instrumentId, ...cert } of rows) {
    result.set(instrumentId, [...(result.get(instrumentId) ?? []), cert]);
  }
  return result;
}

/** Instruments of this organisation, locked, in the order given; unknown ids are refused. */
export async function lockInstruments(tx: Transaction, organisationId: string, ids: string[]) {
  if (ids.some((id) => !isUuid(id))) throw new InstrumentsError("An instrument does not exist.");
  if (ids.length === 0) return [];
  const rows = await tx
    .select()
    .from(instruments)
    .where(and(eq(instruments.organisationId, organisationId), inArray(instruments.id, ids)))
    .for("update");
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new InstrumentsError("An instrument does not exist.");
    return row;
  });
}

const resultRowSchema = z.object({
  instrumentId: z.string().uuid(),
  quantity: z.enum(QUANTITIES),
  reference: z.string(),
  reading: z.string(),
  uncertainty: z.string().optional().default(""),
  condition: z.string().trim().max(40).optional().default(""),
});

/**
 * Records a certificate issued by an outside lab (for a master, or for loggers
 * sent out), with its PDF and optionally its results and uncertainty.
 */
export async function createExternalCertificate(
  db: Database,
  actor: SessionUser,
  input: ExternalCertificateInput & {
    instrumentIds: string[];
    fileId?: string | null;
    results?: z.input<typeof resultRowSchema>[];
    /**
     * "imported" for one of QA Tech's own certificates made outside QTech
     * (a scan uploaded in bulk, ADR 0024); an outside lab's otherwise.
     */
    kind?: "external" | "imported";
  },
  request: RequestInfo,
): Promise<Certificate> {
  assertCan(actor, "instruments.manage");
  const values = externalCertificateSchema.parse(input);
  const instrumentIds = [...new Set(input.instrumentIds)];
  if (instrumentIds.length === 0)
    throw new InstrumentsError("Choose the instrument(s) this certificate is for.");
  const results = z
    .array(resultRowSchema)
    .max(500)
    .parse(input.results ?? []);

  try {
    return await db.transaction(async (tx) => {
      const covered = await lockInstruments(tx, actor.organisationId, instrumentIds);
      if (input.fileId) {
        if (!isUuid(input.fileId)) throw new InstrumentsError("Upload the certificate PDF again.");
        const [file] = await tx
          .select({ id: storedFiles.id, fileType: storedFiles.fileType })
          .from(storedFiles)
          .where(
            and(
              eq(storedFiles.id, input.fileId),
              eq(storedFiles.organisationId, actor.organisationId),
            ),
          );
        if (!file) throw new InstrumentsError("Upload the certificate PDF again.");
        if (file.fileType !== "pdf")
          throw new InstrumentsError("The certificate file must be a PDF.");
      }
      const [cert] = await tx
        .insert(certificates)
        .values({
          ...values,
          organisationId: actor.organisationId,
          kind: input.kind ?? "external",
          status: "issued",
          fileId: input.fileId ?? null,
          equipmentName: covered[0]?.equipmentName ?? "",
          make: covered[0]?.make ?? "",
          model: covered[0]?.model ?? "",
          title:
            covered.length === 1
              ? `${covered[0]!.code} ${covered[0]!.equipmentName}`.trim()
              : `${covered.length} instruments`,
          createdByUserId: actor.id,
        })
        .returning();
      if (!cert) throw new Error("Certificate insert returned no row");
      await tx.insert(certificateItems).values(
        covered.map((instrument, position) => ({
          organisationId: actor.organisationId,
          certificateId: cert.id,
          instrumentId: instrument.id,
          position,
        })),
      );
      if (results.length > 0)
        await insertResults(tx, actor.organisationId, cert.id, covered, results);
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: { type: "user", userId: actor.id },
        action: "certificate.created",
        entityType: "certificate",
        entityId: cert.id,
        summary: `${actor.name} recorded ${values.labName} certificate ${values.number} for ${shortList(covered.map((i) => i.code))} (valid until ${values.validUntil ?? "no due date"})`,
        after: { ...values, instruments: covered.map((i) => i.code), fileId: input.fileId ?? null },
        request,
      });
      return cert;
    });
  } catch (error) {
    rethrowUnique(error, CERTIFICATE_UNIQUE);
  }
}

/** Lab results: one point per distinct (quantity, reference, condition), readings per instrument. */
async function insertResults(
  tx: Transaction,
  organisationId: string,
  certificateId: string,
  covered: { id: string; code: string }[],
  results: z.output<typeof resultRowSchema>[],
) {
  const known = new Set(covered.map((i) => i.id));
  const points: { seq: number; quantity: string; reference: string; condition: string }[] = [];
  const readings: (typeof certificateReadings.$inferInsert)[] = [];
  for (const [i, row] of results.entries()) {
    if (!known.has(row.instrumentId))
      throw new InstrumentsError(
        `Result row ${i + 1} is for an instrument not on this certificate.`,
      );
    const reference = cleanDecimal(row.reference);
    const reading = cleanDecimal(row.reading);
    const uncertainty = row.uncertainty ? cleanDecimal(row.uncertainty) : null;
    if (reference === null || reading === null || (row.uncertainty && uncertainty === null)) {
      throw new InstrumentsError(
        `Result row ${i + 1}: standard reading, instrument reading and uncertainty must be numbers.`,
      );
    }
    let point = points.find(
      (p) =>
        p.quantity === row.quantity && p.reference === reference && p.condition === row.condition,
    );
    if (!point) {
      point = {
        seq: points.length + 1,
        quantity: row.quantity,
        reference,
        condition: row.condition,
      };
      points.push(point);
    }
    readings.push({
      organisationId,
      certificateId,
      seq: point.seq,
      instrumentId: row.instrumentId,
      reading,
      deviation: deviation(reading, reference),
      uncertainty: uncertainty?.replace("-", "") ?? null,
      tolerance: null,
      judgement: "no_limit",
    });
  }
  await tx
    .insert(certificatePoints)
    .values(points.map((p) => ({ ...p, organisationId, certificateId })));
  await tx.insert(certificateReadings).values(readings);
}

/** Recomputes deviation, tolerance and judgement for every reading of a certificate. */
export function evaluate(
  accuracy: Parameters<typeof toleranceAt>[0],
  points: { seq: number; quantity: (typeof QUANTITIES)[number]; reference: string }[],
  readings: { seq: number; instrumentId: string; reading: string }[],
) {
  const pointBySeq = new Map(points.map((p) => [p.seq, p]));
  const evaluated = readings.map((r) => {
    const point = pointBySeq.get(r.seq);
    if (!point)
      throw new InstrumentsError("A reading belongs to a test point that no longer exists.");
    const dev = deviation(r.reading, point.reference);
    const tolerance = toleranceAt(accuracy, point.quantity, Number(point.reference));
    return { ...r, deviation: dev, tolerance, judgement: judge(dev, tolerance) };
  });
  const byInstrument = new Map<string, "pass" | "fail" | "no_limit">();
  for (const r of evaluated) {
    const previous = byInstrument.get(r.instrumentId);
    if (r.judgement === "fail" || previous === "fail") byInstrument.set(r.instrumentId, "fail");
    else if (r.judgement === "pass" || previous === "pass")
      byInstrument.set(r.instrumentId, "pass");
    else byInstrument.set(r.instrumentId, "no_limit");
  }
  return { readings: evaluated, results: byInstrument };
}

export async function cancelCertificate(
  db: Database,
  actor: SessionUser,
  input: { certificateId: string; reason: string },
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "instruments.manage");
  const reason = z
    .string()
    .trim()
    .min(3, "Give a reason for cancelling.")
    .max(2000)
    .parse(input.reason);
  if (!isUuid(input.certificateId)) throw new InstrumentsError("That certificate does not exist.");
  await db.transaction(async (tx) => {
    const [cert] = await tx
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.id, input.certificateId),
          eq(certificates.organisationId, actor.organisationId),
        ),
      )
      .for("update");
    if (!cert) throw new InstrumentsError("That certificate does not exist.");
    if (cert.status === "cancelled") return;
    await tx
      .update(certificates)
      .set({
        status: move(CERTIFICATE_FLOW, cert.status as CertificateStatus, "cancelled"),
        cancelledReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(certificates.id, cert.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "certificate.cancelled",
      entityType: "certificate",
      entityId: cert.id,
      summary: `${actor.name} cancelled certificate ${cert.number}. Its number is not reused.`,
      before: { status: cert.status },
      reason,
      request,
    });
  });
}

/**
 * Attaches the scanned PDF (or image) to an outside-lab or imported
 * certificate that has none: certificates brought in from the old register
 * often arrive without their scan, and a report can't be frozen without it.
 * A certificate that already has its file keeps it.
 */
export async function attachCertificateFile(
  db: Database,
  actor: SessionUser,
  input: { certificateId: string; fileId: string },
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "instruments.manage");
  if (!isUuid(input.certificateId) || !isUuid(input.fileId)) {
    throw new InstrumentsError("That certificate does not exist.");
  }
  await db.transaction(async (tx) => {
    const [cert] = await tx
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.id, input.certificateId),
          eq(certificates.organisationId, actor.organisationId),
        ),
      )
      .for("update");
    if (!cert) throw new InstrumentsError("That certificate does not exist.");
    if (cert.kind === "internal") {
      throw new InstrumentsError("QA Tech's own certificates print their PDF from the record.");
    }
    if (cert.fileId) throw new InstrumentsError(`${cert.number} already has its PDF.`);
    const [file] = await tx
      .select()
      .from(storedFiles)
      .where(
        and(eq(storedFiles.id, input.fileId), eq(storedFiles.organisationId, actor.organisationId)),
      );
    if (!file) throw new InstrumentsError("That file was not uploaded.");
    if (!/^(application\/pdf|image\/(png|jpeg))$/.test(file.mimeType)) {
      throw new InstrumentsError("Attach the certificate as a PDF, or a PNG or JPEG scan.");
    }
    await tx
      .update(certificates)
      .set({ fileId: file.id, updatedAt: new Date() })
      .where(eq(certificates.id, cert.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "certificate.file_attached",
      entityType: "certificate",
      entityId: cert.id,
      summary: `${actor.name} attached the PDF of certificate ${cert.number} (${file.firstFileName})`,
      after: { fileId: file.id, sha256: file.sha256, fileName: file.firstFileName },
      request,
    });
  });
}
