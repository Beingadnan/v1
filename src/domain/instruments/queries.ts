import "server-only";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client-factory";
import {
  certificateItems,
  certificateMasters,
  certificatePoints,
  certificateReadings,
  certificates,
  instrumentModels,
  instruments,
  sites,
  type Certificate,
  type Instrument,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { todayInIndia } from "@/domain/clients/requalification";
import { isUuid } from "@/domain/clients/shared";

import { certificatesOf } from "./certificate-service";
import { INSTRUMENT_TYPE_INFO, INSTRUMENT_TYPES } from "./types";
import {
  certificateCovering,
  latestCertificate,
  validityState,
  type CertificateDates,
  type ValidityState,
} from "./validity";

export type InstrumentRow = Instrument & {
  siteName: string | null;
  latest: (CertificateDates & { labName: string }) | null;
  validity: ValidityState;
};

export type InstrumentFilter = {
  q?: string;
  tier?: string;
  type?: string;
  siteId?: string;
  validity?: "attention" | ValidityState;
  status?: string;
};

/** The instrument register with each one's current certificate and alert level. */
export async function listInstruments(
  db: DbExecutor,
  actor: SessionUser,
  filter: InstrumentFilter = {},
): Promise<InstrumentRow[]> {
  assertCan(actor, "instruments.view");
  const q = filter.q?.trim();
  const rows = await db
    .select({ instrument: instruments, siteName: sites.name })
    .from(instruments)
    .leftJoin(sites, eq(sites.id, instruments.homeSiteId))
    .where(
      and(
        eq(instruments.organisationId, actor.organisationId),
        q
          ? or(
              ilike(instruments.code, `%${q}%`),
              ilike(instruments.serialNo, `%${q}%`),
              ilike(instruments.make, `%${q}%`),
              ilike(instruments.model, `%${q}%`),
              ilike(instruments.equipmentName, `%${q}%`),
            )
          : undefined,
        filter.tier ? eq(instruments.tier, filter.tier) : undefined,
        filter.type ? eq(instruments.type, filter.type) : undefined,
        filter.siteId && isUuid(filter.siteId)
          ? eq(instruments.homeSiteId, filter.siteId)
          : undefined,
        filter.status ? eq(instruments.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(instruments.tier), asc(instruments.code))
    .limit(2000);
  const certs = await certificatesOf(
    db,
    actor.organisationId,
    rows.map((r) => r.instrument.id),
  );
  const today = todayInIndia();
  const result = rows.map(({ instrument, siteName }) => {
    const latest = latestCertificate(certs.get(instrument.id) ?? []);
    return {
      ...instrument,
      siteName,
      latest,
      validity: validityState(latest?.validUntil, latest !== null, today),
    };
  });
  if (!filter.validity) return result;
  if (filter.validity === "attention") {
    return result.filter((r) => r.status === "active" && r.validity !== "valid");
  }
  return result.filter((r) => r.validity === filter.validity);
}

/** Counts behind the expiry banner: active instruments due in 30/15/7 days, expired, never calibrated. */
export async function expirySummary(db: DbExecutor, actor: SessionUser) {
  const rows = await listInstruments(db, actor, { status: "active" });
  const counts: Record<ValidityState, number> = {
    never: 0,
    expired: 0,
    due_7: 0,
    due_15: 0,
    due_30: 0,
    valid: 0,
  };
  for (const r of rows) counts[r.validity] += 1;
  const masters = rows.filter((r) => r.tier === "master" && r.validity !== "valid");
  return { counts, masters };
}

/** Instruments that can be picked for work on `date` (masters for a calibration, loggers for a study). */
export async function usableInstruments(
  db: DbExecutor,
  actor: SessionUser,
  tier: "master" | "working",
  date: string,
) {
  const rows = await listInstruments(db, actor, { tier, status: "active" });
  const certs = await certificatesOf(
    db,
    actor.organisationId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const cover = certificateCovering(certs.get(r.id) ?? [], date);
    return { ...r, coveringCertificate: cover };
  });
}

export async function listModels(db: DbExecutor, actor: SessionUser) {
  assertCan(actor, "instruments.view");
  return db
    .select()
    .from(instrumentModels)
    .where(eq(instrumentModels.organisationId, actor.organisationId))
    .orderBy(asc(instrumentModels.make), asc(instrumentModels.model));
}

export async function getInstrument(db: DbExecutor, actor: SessionUser, id: string) {
  assertCan(actor, "instruments.view");
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ instrument: instruments, siteName: sites.name })
    .from(instruments)
    .leftJoin(sites, eq(sites.id, instruments.homeSiteId))
    .where(and(eq(instruments.id, id), eq(instruments.organisationId, actor.organisationId)));
  if (!row) return null;
  const history = await db
    .select({ certificate: certificates, result: certificateItems.result })
    .from(certificateItems)
    .innerJoin(certificates, eq(certificates.id, certificateItems.certificateId))
    .where(
      and(
        eq(certificateItems.organisationId, actor.organisationId),
        eq(certificateItems.instrumentId, id),
      ),
    )
    .orderBy(desc(certificates.calibratedOn), desc(certificates.createdAt));
  // Where this instrument served as a master.
  const usedAsMaster = await db
    .select({
      id: certificates.id,
      number: certificates.number,
      calibratedOn: certificates.calibratedOn,
      status: certificates.status,
    })
    .from(certificateMasters)
    .innerJoin(certificates, eq(certificates.id, certificateMasters.certificateId))
    .where(
      and(
        eq(certificateMasters.organisationId, actor.organisationId),
        eq(certificateMasters.instrumentId, id),
      ),
    )
    .orderBy(desc(certificates.calibratedOn))
    .limit(200);
  const today = todayInIndia();
  const latest = latestCertificate(history.map((h) => h.certificate));
  return {
    ...row.instrument,
    siteName: row.siteName,
    history,
    usedAsMaster,
    latest,
    validity: validityState(latest?.validUntil, latest !== null, today),
  };
}

export type TraceNode = {
  instrument: Pick<
    Instrument,
    "id" | "code" | "serialNo" | "make" | "model" | "equipmentName" | "tier"
  >;
  /** The certificate that covered the date asked about (null: none did). */
  certificate: Pick<
    Certificate,
    | "id"
    | "number"
    | "ulrNo"
    | "labName"
    | "labAccreditation"
    | "kind"
    | "calibratedOn"
    | "validUntil"
    | "status"
  > | null;
  date: string;
  validOnDate: boolean;
  masters: TraceNode[];
};

const MAX_DEPTH = 5;

/**
 * The traceability chain for an instrument on a day: the certificate that
 * covered it, the masters used for that calibration, the masters'
 * certificates on the calibration day, and so on up to an outside lab.
 */
export async function traceChain(
  db: DbExecutor,
  actor: SessionUser,
  instrumentId: string,
  date: string,
): Promise<TraceNode | null> {
  assertCan(actor, "instruments.view");
  if (!isUuid(instrumentId)) return null;
  return traceNode(db, actor.organisationId, instrumentId, date, null, 0, new Set());
}

async function traceNode(
  db: DbExecutor,
  organisationId: string,
  instrumentId: string,
  date: string,
  pinnedCertificateId: string | null,
  depth: number,
  seen: Set<string>,
): Promise<TraceNode | null> {
  const [instrument] = await db
    .select()
    .from(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.organisationId, organisationId)));
  if (!instrument) return null;
  const all = (await certificatesOf(db, organisationId, [instrumentId])).get(instrumentId) ?? [];
  const covering = certificateCovering(all, date);
  // A calibration records which master certificate was used; trust that link first.
  const pinned = pinnedCertificateId ? all.find((c) => c.id === pinnedCertificateId) : undefined;
  const chosen = pinned ?? covering;
  const node: TraceNode = {
    instrument,
    certificate: null,
    date,
    validOnDate: false,
    masters: [],
  };
  if (!chosen) return node;
  const [cert] = await db.select().from(certificates).where(eq(certificates.id, chosen.id));
  if (!cert) return node;
  node.certificate = cert;
  node.validOnDate =
    cert.status === "issued" &&
    cert.calibratedOn <= date &&
    (cert.validUntil === null || cert.validUntil >= date);
  if (depth >= MAX_DEPTH || seen.has(cert.id)) return node;
  seen.add(cert.id);
  const masters = await db
    .select()
    .from(certificateMasters)
    .where(eq(certificateMasters.certificateId, cert.id))
    .orderBy(asc(certificateMasters.position));
  for (const m of masters) {
    const child = await traceNode(
      db,
      organisationId,
      m.instrumentId,
      cert.calibratedOn,
      m.masterCertificateId,
      depth + 1,
      seen,
    );
    if (child) node.masters.push(child);
  }
  return node;
}

export async function listCertificates(
  db: DbExecutor,
  actor: SessionUser,
  filter: { q?: string; status?: string; kind?: string } = {},
) {
  assertCan(actor, "instruments.view");
  const q = filter.q?.trim();
  return db
    .select({
      id: certificates.id,
      number: certificates.number,
      kind: certificates.kind,
      status: certificates.status,
      labName: certificates.labName,
      title: certificates.title,
      customerName: certificates.customerName,
      calibratedOn: certificates.calibratedOn,
      validUntil: certificates.validUntil,
      performedByName: certificates.performedByName,
      count: sql<number>`(select count(*)::int from ${certificateItems} where ${certificateItems.certificateId} = ${certificates.id})`,
    })
    .from(certificates)
    .where(
      and(
        eq(certificates.organisationId, actor.organisationId),
        q
          ? or(
              ilike(certificates.number, `%${q}%`),
              ilike(certificates.title, `%${q}%`),
              ilike(certificates.customerName, `%${q}%`),
              ilike(certificates.ulrNo, `%${q}%`),
            )
          : undefined,
        filter.status ? eq(certificates.status, filter.status) : undefined,
        filter.kind ? eq(certificates.kind, filter.kind) : undefined,
      ),
    )
    .orderBy(desc(certificates.calibratedOn), desc(certificates.createdAt))
    .limit(500);
}

/** Everything on a certificate, in print order. */
export async function getCertificate(db: DbExecutor, actor: SessionUser, id: string) {
  assertCan(actor, "instruments.view");
  if (!isUuid(id)) return null;
  const [cert] = await db
    .select()
    .from(certificates)
    .where(and(eq(certificates.id, id), eq(certificates.organisationId, actor.organisationId)));
  if (!cert) return null;
  // Sequential: the executor may be a transaction, which is one connection.
  const [items, points, readings, masterLinks] = [
    await db
      .select({
        instrument: instruments,
        position: certificateItems.position,
        result: certificateItems.result,
      })
      .from(certificateItems)
      .innerJoin(instruments, eq(instruments.id, certificateItems.instrumentId))
      .where(eq(certificateItems.certificateId, id))
      .orderBy(asc(certificateItems.position)),
    await db
      .select()
      .from(certificatePoints)
      .where(eq(certificatePoints.certificateId, id))
      .orderBy(asc(certificatePoints.seq)),
    await db.select().from(certificateReadings).where(eq(certificateReadings.certificateId, id)),
    await db
      .select({
        instrument: instruments,
        masterCertificateId: certificateMasters.masterCertificateId,
      })
      .from(certificateMasters)
      .innerJoin(instruments, eq(instruments.id, certificateMasters.instrumentId))
      .where(eq(certificateMasters.certificateId, id))
      .orderBy(asc(certificateMasters.position)),
  ];
  const masterCertIds = masterLinks.map((m) => m.masterCertificateId);
  const masterCerts =
    masterCertIds.length === 0
      ? []
      : await db.select().from(certificates).where(inArray(certificates.id, masterCertIds));
  const byId = new Map(masterCerts.map((c) => [c.id, c]));
  return {
    ...cert,
    items,
    points,
    readings,
    masters: masterLinks.map((m) => ({
      instrument: m.instrument,
      certificate: byId.get(m.masterCertificateId) ?? null,
    })),
  };
}
export type CertificateDetail = NonNullable<Awaited<ReturnType<typeof getCertificate>>>;

/** Section order of the paper index: RTD first, then data loggers, then TC, then the rest. */
const SECTION_ORDER = ["RTD", "PDL", "TC"];
export function indexSectionOf(certificateKind: string): string {
  const type = INSTRUMENT_TYPES.find(
    (t) => INSTRUMENT_TYPE_INFO[t].certificateKind === certificateKind,
  );
  return type ? INSTRUMENT_TYPE_INFO[type].indexSection : certificateKind || "Other";
}
const sectionRank = (kind: string) => {
  const i = SECTION_ORDER.indexOf(kind);
  if (i >= 0) return i;
  const t = INSTRUMENT_TYPES.findIndex((x) => INSTRUMENT_TYPE_INFO[x].certificateKind === kind);
  return SECTION_ORDER.length + (t >= 0 ? t : INSTRUMENT_TYPES.length);
};
const trailingNumber = (number: string) => Number(/(\d+)\D*$/.exec(number)?.[1] ?? 0);

export type IndexRow = {
  id: string;
  number: string;
  customerName: string;
  calibratedOn: string;
  validUntil: string | null;
  doneBy: string;
  certificateBy: string;
  instruments: number;
};

/**
 * The Calibration Index for a month, built from the certificates themselves:
 * one section per kind, in number order. Replaces the hand-typed sheet.
 */
export async function calibrationIndex(
  db: DbExecutor,
  actor: SessionUser,
  year: number,
  month: number,
): Promise<{ section: string; kind: string; rows: IndexRow[] }[]> {
  assertCan(actor, "instruments.view");
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const rows = await db
    .select({
      id: certificates.id,
      number: certificates.number,
      certificateKind: certificates.certificateKind,
      customerName: certificates.customerName,
      calibratedOn: certificates.calibratedOn,
      validUntil: certificates.validUntil,
      doneBy: certificates.performedByName,
      certificateBy: certificates.preparedByName,
      instruments: sql<number>`(select count(*)::int from ${certificateItems} where ${certificateItems.certificateId} = ${certificates.id})`,
    })
    .from(certificates)
    .where(
      and(
        eq(certificates.organisationId, actor.organisationId),
        inArray(certificates.kind, ["internal", "imported"]),
        eq(certificates.status, "issued"),
        sql`${certificates.calibratedOn} >= ${from} and ${certificates.calibratedOn} < ${next}`,
      ),
    );
  const groups = new Map<string, IndexRow[]>();
  for (const { certificateKind, ...row } of rows) {
    groups.set(certificateKind, [...(groups.get(certificateKind) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => sectionRank(a) - sectionRank(b) || a.localeCompare(b))
    .map(([kind, list]) => ({
      kind,
      section: indexSectionOf(kind),
      rows: list.sort(
        (a, b) =>
          trailingNumber(a.number) - trailingNumber(b.number) || a.number.localeCompare(b.number),
      ),
    }));
}
