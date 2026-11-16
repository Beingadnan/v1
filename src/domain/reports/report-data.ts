import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";

import type { Database, Transaction } from "@/db/client-factory";
import { mappedNoun } from "@/domain/clients/equipment-types";
import {
  certificateMasters,
  certificates,
  clientCompanies,
  clientDepartments,
  clientSites,
  deviations,
  equipment,
  instrumentModels,
  instruments,
  jobs,
  organisationSettings,
  storedFiles,
  studies,
  studyAnalysisRuns,
  studyPositions,
  studyExcursionReviews,
  studyPrecal,
  users,
  type Study,
} from "@/db/schema";
import { analysisInputs } from "@/domain/analysis/analysis-service";
import {
  excursionKey,
  DEVIATION_DECISION_LABELS,
  DEVIATION_SOURCE_LABELS,
  type DeviationDecision,
  type DeviationSource,
} from "@/domain/analysis/types";
import type { SessionUser } from "@/domain/auth/session-service";
import { certificatesOf } from "@/domain/instruments/certificate-service";
import { renderFt05 } from "@/domain/instruments/ft05-pdf";
import { getCertificate } from "@/domain/instruments/queries";
import { certificateCovering } from "@/domain/instruments/validity";
import { WORK_TYPE_LABELS, type WorkType } from "@/domain/jobs/types";
import type { BlobStore } from "@/lib/storage/blob-store";

import { renderReport, type ReportData } from "./report-pdf";
import { overridesOf } from "@/domain/field/override-service";

import { conclusionText, observationText, type TemplateInput } from "./templates";

type Exec = Database | Transaction;

const n = (v: string | null) => (v === null ? null : Number(v));
const isoDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);

async function bytesOf(db: Exec, blobs: BlobStore, organisationId: string, fileId: string) {
  const [f] = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, organisationId)));
  return f ? { bytes: Buffer.from(await blobs.get(f.storageKey)), mime: f.mimeType } : null;
}

/** "Temperature Mapping Study", as the report's cycle type reads. */
export function studyName(workType: string) {
  // Title case, as on the report's cover: "Temperature Mapping Study".
  const label = (WORK_TYPE_LABELS[workType as WorkType] ?? workType).replace(/\b[a-z]/g, (c) =>
    c.toUpperCase(),
  );
  return /study$/i.test(label) ? label : `${label} Study`;
}

/** Next requalification: the day before the anniversary of the end, as on BE-WF-02 (23.05.2026 → 22.05.2027). */
export function nextDue(endIso: string, months: number) {
  const d = new Date(`${endIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Everything a report needs, from the database: the study, its equipment and
 * client, the run it is built from, the loggers and the masters behind their
 * certificates, the raw readings, post-calibration and closed deviations.
 */
export async function reportContext(db: Exec, actor: SessionUser, study: Study, runId: string) {
  const org = actor.organisationId;
  const [row] = await db
    .select({ equipment, job: jobs, company: clientCompanies, site: clientSites })
    .from(studies)
    .innerJoin(equipment, eq(equipment.id, studies.equipmentId))
    .innerJoin(jobs, eq(jobs.id, studies.jobId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .innerJoin(clientSites, eq(clientSites.id, jobs.clientSiteId))
    .where(eq(studies.id, study.id));
  if (!row) throw new Error("Study not found");
  const [run] = await db.select().from(studyAnalysisRuns).where(eq(studyAnalysisRuns.id, runId));
  if (!run) throw new Error("Run not found");
  const { engine } = await analysisInputs(db, org, study);

  const positions = await db
    .select({
      id: studyPositions.id,
      label: studyPositions.label,
      x: studyPositions.x,
      y: studyPositions.y,
      z: studyPositions.z,
      ambient: studyPositions.ambient,
      note: studyPositions.note,
      instrumentId: studyPositions.instrumentId,
      inst: instruments,
      model: instrumentModels,
    })
    .from(studyPositions)
    .leftJoin(instruments, eq(instruments.id, studyPositions.instrumentId))
    .leftJoin(instrumentModels, eq(instrumentModels.id, instruments.modelId))
    .where(eq(studyPositions.studyId, study.id))
    .orderBy(asc(studyPositions.sort));
  const placed = positions.filter((p) => p.instrumentId && p.inst);
  const start = Math.min(...run.inputs.windows.map((w) => w.start));
  const end = Math.max(...run.inputs.windows.map((w) => w.end));
  const certs = await certificatesOf(
    db,
    org,
    placed.map((p) => p.instrumentId!),
  );
  const covering = new Map(
    placed.map((p) => [
      p.instrumentId!,
      certificateCovering(certs.get(p.instrumentId!) ?? [], isoDay(start)),
    ]),
  );
  const loggers = placed.map((p) => {
    const i = p.inst!;
    const c = covering.get(p.instrumentId!);
    const name = i.equipmentName || p.model?.equipmentName || "Data Logger";
    const make = i.make || p.model?.make || "";
    return {
      label: p.label,
      serial: i.serialNo || i.code,
      name: make ? `${name} (${make})` : name,
      range: i.rangeText || p.model?.rangeText || "",
      accuracy: i.accuracyText || p.model?.accuracyText || "",
      calibratedOn: c?.calibratedOn ?? null,
      validUntil: c?.validUntil ?? null,
    };
  });

  // The masters that calibrated those loggers, from the certificates' traceability.
  const certIds = [...new Set([...covering.values()].flatMap((c) => (c ? [c.id] : [])))];
  const masterRows =
    certIds.length === 0
      ? []
      : await db
          .select({
            instrumentId: certificateMasters.instrumentId,
            masterCertificateId: certificateMasters.masterCertificateId,
            position: certificateMasters.position,
            inst: instruments,
            certNumber: certificates.number,
            certFileId: certificates.fileId,
            certKind: certificates.kind,
          })
          .from(certificateMasters)
          .innerJoin(instruments, eq(instruments.id, certificateMasters.instrumentId))
          .innerJoin(certificates, eq(certificates.id, certificateMasters.masterCertificateId))
          .where(inArray(certificateMasters.certificateId, certIds))
          .orderBy(asc(certificateMasters.position));
  const masters = [...new Map(masterRows.map((m) => [m.masterCertificateId, m])).values()];

  const serialOf = new Map(placed.map((p) => [p.id, p.inst!.serialNo || p.inst!.code]));
  const reviews = await db
    .select()
    .from(studyExcursionReviews)
    .where(eq(studyExcursionReviews.studyId, study.id));
  const devs = await db
    .select({ d: deviations, assessedBy: users.name })
    .from(deviations)
    .leftJoin(users, eq(users.id, deviations.assessedByUserId))
    .where(eq(deviations.studyId, study.id))
    .orderBy(asc(deviations.openedAt));
  const impacts =
    devs.length === 0
      ? []
      : await db
          .select()
          .from(studyAnalysisRuns)
          .where(
            inArray(
              studyAnalysisRuns.deviationId,
              devs.map((x) => x.d.id),
            ),
          );
  const post = await db
    .select({
      p: studyPrecal,
      label: studyPositions.label,
      serial: instruments.serialNo,
      code: instruments.code,
    })
    .from(studyPrecal)
    .innerJoin(instruments, eq(instruments.id, studyPrecal.instrumentId))
    .leftJoin(
      studyPositions,
      and(
        eq(studyPositions.studyId, studyPrecal.studyId),
        eq(studyPositions.instrumentId, studyPrecal.instrumentId),
      ),
    )
    .where(and(eq(studyPrecal.studyId, study.id), eq(studyPrecal.phase, "post")))
    .orderBy(asc(studyPositions.label), asc(studyPrecal.at));
  // Approved overrides of a post-calibration result: printed beside the computed one.
  const overrides = (await overridesOf(db, study.id)).filter((o) => o.status === "approved");

  const template: TemplateInput = {
    equipmentName: row.equipment.name,
    equipmentCode: row.equipment.code,
    studyName: studyName(study.workType),
    limits: { tempMin: n(study.tempMinC), tempMax: n(study.tempMaxC) },
    cycles: run.result.cycles,
    serialOf: (id) => serialOf.get(id) ?? "",
    reviewOf: (e, cycle) => {
      const r = reviews.find(
        (x) => !x.withdrawnAt && x.fingerprint === excursionKey({ ...e, cycle }),
      );
      if (!r) return null;
      const dn = r.deviationId
        ? (devs.find((x) => x.d.id === r.deviationId)?.d.number ?? null)
        : null;
      return { decision: r.decision, reason: r.reason, deviation: dn };
    },
    deviations: devs
      .filter((x) => x.d.decision)
      .map((x) => ({
        number: x.d.number,
        outcome: DEVIATION_DECISION_LABELS[x.d.decision as DeviationDecision],
      })),
  };

  return {
    row,
    run,
    engine,
    positions,
    placed,
    loggers,
    masters,
    covering,
    template,
    devs,
    impacts,
    post,
    overrides,
    start,
    end,
  };
}

export type ReportContext = Awaited<ReturnType<typeof reportContext>>;

/** The report's data for the renderer, with this revision's text. */
export async function reportData(
  db: Exec,
  blobs: BlobStore,
  actor: SessionUser,
  study: Study,
  ctx: ReportContext,
  rev: {
    label: string;
    observation: string | null;
    conclusion: string | null;
    watermark: string | null;
  },
  certificatePages: number,
): Promise<ReportData> {
  const [settings] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
  if (!settings) throw new Error("Organisation settings missing");
  const letterhead = settings.letterheadFileId
    ? ((await bytesOf(db, blobs, actor.organisationId, settings.letterheadFileId))?.bytes ?? null)
    : null;
  const { row, run, engine } = ctx;
  const months = row.equipment.requalificationMonths ?? row.company.requalificationMonths ?? 12;
  return {
    organisation: settings,
    letterhead,
    watermark: rev.watermark,
    reportNumber: study.reportNumber,
    revision: rev.label,
    customer: {
      name: /^m\/s/i.test(row.company.name) ? row.company.name : `M/s. ${row.company.name}`,
      address: row.site.address || row.company.address,
    },
    equipment: {
      name: row.equipment.name,
      code: row.equipment.code,
      location: row.equipment.location,
      make: row.equipment.make,
      model: row.equipment.model,
      serialNo: row.equipment.serialNo,
      department: (await departmentName(db, row.equipment.departmentId)) ?? "",
      noun: mappedNoun(row.equipment.type),
      plan: row.equipment.type === "room",
      dims: {
        lengthM: n(row.equipment.lengthM),
        widthM: n(row.equipment.widthM),
        heightM: n(row.equipment.heightM),
        shape: study.roomShape,
      },
    },
    study: {
      typeLabel: studyName(study.workType),
      setPoint: n(study.setPointC),
      limits: {
        tempMin: n(study.tempMinC),
        tempMax: n(study.tempMaxC),
        rhMin: n(study.rhMinPct),
        rhMax: n(study.rhMaxPct),
      },
      intervalMinutes: study.intervalMinutes,
      channels: ctx.placed.length,
      durationHours: study.durationHours,
      start: ctx.start,
      end: ctx.end,
      nextDue: nextDue(isoDay(ctx.end), months),
    },
    positions: ctx.positions.map((p) => ({
      id: p.id,
      label: p.label,
      x: Number(p.x),
      y: Number(p.y),
      z: Number(p.z),
      ambient: p.ambient,
      serial: p.inst ? p.inst.serialNo || p.inst.code : "",
      note: p.note,
    })),
    planFeatures: study.planFeatures,
    loggers: ctx.loggers,
    masters: ctx.masters.map((m) => ({
      name: m.inst.equipmentName || m.inst.code,
      make: m.inst.make,
      serial: m.inst.serialNo,
      certificate: m.certNumber,
    })),
    result: run.result,
    series: engine.series.map((s) => ({
      positionId: s.positionId,
      label: s.label,
      serial: s.logger?.serialNo || s.logger?.code || s.label,
      quantity: s.quantity,
      times: s.times,
      values: s.values,
    })),
    observation: rev.observation ?? observationText(ctx.template),
    conclusion: rev.conclusion ?? conclusionText(ctx.template),
    postCal: ctx.post.map((x) => ({
      label: x.label ?? "",
      serial: x.serial || x.code,
      quantity: x.p.quantity,
      reference: x.p.reference.replace(/\.?0+$/, ""),
      reading: x.p.reading.replace(/\.?0+$/, ""),
      deviation: x.p.deviation.replace(/\.?0+$/, "") || "0",
      tolerance: x.p.tolerance.replace(/\.?0+$/, ""),
      result: ctx.overrides.find((o) => o.precalId === x.p.id)?.toResult ?? x.p.result,
      override: (() => {
        const o = ctx.overrides.find((y) => y.precalId === x.p.id);
        return o
          ? {
              computed: o.fromResult,
              reason: o.reason,
              requestedBy: o.requestedBy,
              approvedBy: o.decidedBy ?? "",
              on: o.decidedAt ? isoDay(o.decidedAt.getTime()).split("-").reverse().join(".") : "",
            }
          : null;
      })(),
    })),
    deviations: ctx.devs.map(({ d, assessedBy }) => {
      const impact = ctx.impacts
        .filter((r) => r.deviationId === d.id)
        .sort((a, b) => b.runNo - a.runNo)[0];
      const p = impact?.result.cycles.map((c) => {
        const pos = c.positions.find((x) => x.positionId === d.positionId);
        return `${c.label}: with the error applied ${pos?.label ?? ""} ${pos?.pass === false ? "fails" : "passes"}; the study ${c.pass === false ? "fails" : "passes"}.`;
      });
      return {
        number: d.number,
        source: DEVIATION_SOURCE_LABELS[d.source as DeviationSource],
        title: d.title,
        description: d.description,
        impact: impact
          ? [impact.result.notes.find((x) => x.startsWith("Impact")) ?? "", ...(p ?? [])].join(" ")
          : "",
        assessment: d.assessment,
        assessedBy: assessedBy ?? "",
        decision: d.decision ? DEVIATION_DECISION_LABELS[d.decision as DeviationDecision] : "Open",
        decidedBy: [d.decidedByName, d.decidedByTitle].filter(Boolean).join(", "),
        decidedOn: d.decidedOn ?? "",
        note: d.decisionNote,
      };
    }),
    signatures: { client: row.company.name },
    certificatePages,
  };
}

async function departmentName(db: Exec, id: string | null) {
  if (!id) return null;
  const [d] = await db
    .select({ name: clientDepartments.name })
    .from(clientDepartments)
    .where(eq(clientDepartments.id, id));
  return d?.name ?? null;
}

/**
 * The traceability annexure: each logger certificate (QA Tech's own redrawn
 * with the serials used highlighted and marked TRUE COPY; others as stored),
 * then the masters' certificates as uploaded.
 */
export async function certificateAnnex(
  db: Exec,
  blobs: BlobStore,
  actor: SessionUser,
  ctx: ReportContext,
): Promise<{ pdfs: Uint8Array[]; pages: number; missing: string[] }> {
  const [settings] = await db
    .select()
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
  const letterhead = settings?.letterheadFileId
    ? ((await bytesOf(db, blobs, actor.organisationId, settings.letterheadFileId))?.bytes ?? null)
    : null;
  const usedSerials = ctx.placed.map((p) => p.inst!.serialNo);
  const pdfs: Uint8Array[] = [];
  const missing: string[] = [];
  const asPdf = async (bytes: Buffer, mime: string) => {
    if (mime === "application/pdf") return new Uint8Array(bytes);
    // A scanned image: one A4 page.
    const doc = await PDFDocument.create();
    const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([595.28, 841.89]);
    const s = Math.min(555 / img.width, 800 / img.height);
    page.drawImage(img, {
      x: (595.28 - img.width * s) / 2,
      y: (841.89 - img.height * s) / 2,
      width: img.width * s,
      height: img.height * s,
    });
    return doc.save();
  };
  const certIds = [...new Set([...ctx.covering.values()].flatMap((c) => (c ? [c.id] : [])))];
  for (const id of certIds) {
    const cert = await getCertificate(db as Database, actor, id);
    if (!cert) continue;
    const redraw = async () =>
      pdfs.push(
        new Uint8Array(
          await renderFt05(cert, {
            organisation: settings!,
            letterhead,
            signatures: [],
            highlightSerials: usedSerials,
            stamp: "TRUE COPY",
          }),
        ),
      );
    if (cert.kind === "internal" && settings) {
      await redraw();
    } else if (cert.fileId) {
      const f = await bytesOf(db, blobs, actor.organisationId, cert.fileId);
      if (f) pdfs.push(await asPdf(f.bytes, f.mime));
    } else if (cert.kind === "imported" && cert.readings.length > 0 && settings) {
      // Imported from QA Tech's own FT-05 workbook with every reading: redrawn like
      // a certificate made here, so no scan is needed.
      await redraw();
    } else missing.push(cert.number);
  }
  for (const m of ctx.masters) {
    if (m.certFileId) {
      const f = await bytesOf(db, blobs, actor.organisationId, m.certFileId);
      if (f) {
        pdfs.push(await asPdf(f.bytes, f.mime));
        continue;
      }
    }
    missing.push(m.certNumber);
  }
  let pages = 0;
  for (const p of pdfs)
    pages += (await PDFDocument.load(p, { ignoreEncryption: true })).getPageCount();
  return { pdfs, pages, missing };
}

/** Joins the report and its certificate annexure into one PDF. */
export async function joinPdfs(main: Buffer, extra: Uint8Array[]): Promise<Uint8Array> {
  if (extra.length === 0) return new Uint8Array(main);
  const out = await PDFDocument.load(main);
  for (const bytes of extra) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  // Fixed dates so the same report always gives the same bytes.
  out.setCreationDate(new Date(0));
  out.setModificationDate(new Date(0));
  return out.save();
}

/** Renders a whole report: body, raw data, post-cal, deviations, certificates. */
export async function buildReportPdf(
  db: Exec,
  blobs: BlobStore,
  actor: SessionUser,
  study: Study,
  runId: string,
  rev: Parameters<typeof reportData>[5],
) {
  const ctx = await reportContext(db, actor, study, runId);
  const annex = await certificateAnnex(db, blobs, actor, ctx);
  const data = await reportData(db, blobs, actor, study, ctx, rev, annex.pages);
  const r = await renderReport(data);
  const bytes = await joinPdfs(r.pdf, annex.pdfs);
  return {
    bytes,
    pages: r.totalPages + annex.pages,
    bodyPages: r.bodyPages,
    layout: r.layout,
    missing: annex.missing,
    data,
  };
}
