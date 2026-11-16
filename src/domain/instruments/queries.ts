import "server-only";

import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/client-factory";
import { reads } from "@/db/reads";
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
  const where = and(
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
    filter.siteId && isUuid(filter.siteId) ? eq(instruments.homeSiteId, filter.siteId) : undefined,
    filter.status ? eq(instruments.status, filter.status) : undefined,
  );
  const order = [desc(instruments.tier), asc(instruments.code)] as const;
  // The instruments and their certificates in one round: the certificates take the same
  // filter as a subquery instead of waiting for the ids (ADR 0018).
  const [rows, certs] = await reads(db, [
    () =>
      db
        .select({ instrument: instruments, siteName: sites.name })
        .from(instruments)
        .leftJoin(sites, eq(sites.id, instruments.homeSiteId))
        .where(where)
        .orderBy(...order)
        .limit(2000),
    () =>
      certificatesOf(
        db,
        actor.organisationId,
        db
          .select({ id: instruments.id })
          .from(instruments)
          .where(where)
          .orderBy(...order)
          .limit(2000),
      ),
  ]);
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
  return summariseExpiry(await listInstruments(db, actor, { status: "active" }));
}

/** The expiry banner's counts from an unfiltered list, so a page that has one needn't read it twice. */
export function summariseExpiry(all: InstrumentRow[]) {
  const rows = all.filter((r) => r.status === "active");
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
  // Each read is limited to the organisation, so all three can go out at once.
  const [[row], history, usedAsMaster] = await Promise.all([
    db
      .select({ instrument: instruments, siteName: sites.name })
      .from(instruments)
      .leftJoin(sites, eq(sites.id, instruments.homeSiteId))
      .where(and(eq(instruments.id, id), eq(instruments.organisationId, actor.organisationId))),
    db
      .select({ certificate: certificates, result: certificateItems.result })
      .from(certificateItems)
      .innerJoin(certificates, eq(certificates.id, certificateItems.certificateId))
      .where(
        and(
          eq(certificateItems.organisationId, actor.organisationId),
          eq(certificateItems.instrumentId, id),
        ),
      )
      .orderBy(desc(certificates.calibratedOn), desc(certificates.createdAt)),
    // Where this instrument served as a master.
    db
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
      .limit(200),
  ]);
  if (!row) return null;
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
  // One round per link of the chain: the instrument, all its certificates and the masters
  // recorded on them, the last two by a subquery of its certificate ids (ADR 0018).
  const itsCertificates = db
    .select({ id: certificateItems.certificateId })
    .from(certificateItems)
    .where(
      and(
        eq(certificateItems.instrumentId, instrumentId),
        eq(certificateItems.organisationId, organisationId),
      ),
    );
  const [[instrument], all, masterRows] = await reads(db, [
    () =>
      db
        .select()
        .from(instruments)
        .where(
          and(eq(instruments.id, instrumentId), eq(instruments.organisationId, organisationId)),
        ),
    () => db.select().from(certificates).where(inArray(certificates.id, itsCertificates)),
    () =>
      db
        .select()
        .from(certificateMasters)
        .where(inArray(certificateMasters.certificateId, itsCertificates))
        .orderBy(asc(certificateMasters.position)),
  ]);
  if (!instrument) return null;
  const covering = certificateCovering(all, date);
  // A calibration records which master certificate was used; trust that link first.
  const pinned = pinnedCertificateId ? all.find((c) => c.id === pinnedCertificateId) : undefined;
  const cert = pinned ?? covering;
  const node: TraceNode = {
    instrument,
    certificate: null,
    date,
    validOnDate: false,
    masters: [],
  };
  if (!cert) return node;
  node.certificate = cert;
  node.validOnDate =
    cert.status === "issued" &&
    cert.calibratedOn <= date &&
    (cert.validUntil === null || cert.validUntil >= date);
  if (depth >= MAX_DEPTH || seen.has(cert.id)) return node;
  seen.add(cert.id);
  const masters = masterRows.filter((m) => m.certificateId === cert.id);
  // The masters' own chains side by side, not one after another.
  const children = await reads(
    db,
    masters.map(
      (m) => () =>
        traceNode(
          db,
          organisationId,
          m.instrumentId,
          cert.calibratedOn,
          m.masterCertificateId,
          depth + 1,
          seen,
        ),
    ),
  );
  for (const child of children) if (child) node.masters.push(child);
  return node;
}

export async function listCertificates(
  db: DbExecutor,
  actor: SessionUser,
  filter: {
    q?: string;
    status?: string;
    kind?: string;
    /** Outside-lab and imported certificates whose scan isn't on file. */
    missingScan?: boolean;
    page?: number;
  } = {},
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
      hasFile: sql<boolean>`${certificates.fileId} is not null`,
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
        filter.missingScan ? missingScan : undefined,
      ),
    )
    .orderBy(desc(certificates.calibratedOn), desc(certificates.createdAt))
    .limit(CERTIFICATE_PAGE + 1)
    .offset(Math.max(0, (filter.page ?? 1) - 1) * CERTIFICATE_PAGE);
}

export const CERTIFICATE_PAGE = 100;

const missingScan = and(
  inArray(certificates.kind, ["external", "imported"]),
  isNull(certificates.fileId),
  ne(certificates.status, "cancelled"),
);

/** How many outside-lab and imported certificates have no scan on file. */
export async function countMissingScans(db: DbExecutor, actor: SessionUser): Promise<number> {
  assertCan(actor, "instruments.view");
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(certificates)
    .where(and(eq(certificates.organisationId, actor.organisationId), missingScan));
  return row?.n ?? 0;
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
const trailingNumber = (number: string) =>
  Number(/(\d+)\D*$/.exec(number.replace(/ \(\d{2}\.\d{2}\.\d{4}\)$/, ""))?.[1] ?? 0);

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

/**
 * Instruments from a pasted list of IDs or serial numbers (one per line, or
 * separated by commas/tabs, as copied from Excel), in the order given.
 */
/**
 * A range as people write it: "E-TRH0533 - E-TRH0540", "E-TRH0533 to 0540",
 * "E-TRH0533-0540". The numbers keep the first one's width. Anything else,
 * or a range of more than 200, is left as typed (found testing, 2 Nov 2026).
 */
export function expandRange(token: string): string[] {
  const m = token.match(/^(.*?)(\d+)\s*(?:-|–|to)\s*(.*?)(\d+)$/i);
  if (!m) return [token];
  const [, prefix, from, prefix2, to] = m as unknown as [string, string, string, string, string];
  if (prefix2 && prefix2.toLowerCase() !== prefix.toLowerCase()) return [token];
  if (!prefix || /\d$/.test(prefix)) return [token];
  const a = Number(from);
  const b = Number(to);
  if (b <= a || b - a > 199) return [token];
  const width = from.length;
  return Array.from(
    { length: b - a + 1 },
    (_, i) => `${prefix}${String(a + i).padStart(width, "0")}`,
  );
}

export async function resolveInstrumentList(
  db: DbExecutor,
  actor: SessionUser,
  text: string,
): Promise<{ ids: string[]; unknown: string[]; ambiguous: string[] }> {
  assertCan(actor, "instruments.view");
  const tokens = [
    ...new Set(
      text
        .split(/[\n\r,;\t]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .flatMap(expandRange),
    ),
  ].slice(0, 200);
  if (tokens.length === 0) return { ids: [], unknown: [], ambiguous: [] };
  const lower = tokens.map((t) => t.toLowerCase());
  const rows = await db
    .select({ id: instruments.id, code: instruments.code, serialNo: instruments.serialNo })
    .from(instruments)
    .where(
      and(
        eq(instruments.organisationId, actor.organisationId),
        or(
          inArray(sql`lower(${instruments.code})`, lower),
          inArray(sql`lower(${instruments.serialNo})`, lower),
        ),
      ),
    );
  const ids: string[] = [];
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const [i, token] of tokens.entries()) {
    const byCode = rows.filter((r) => r.code.toLowerCase() === lower[i]);
    const matches =
      byCode.length > 0 ? byCode : rows.filter((r) => r.serialNo.toLowerCase() === lower[i]);
    if (matches.length === 0) unknown.push(token);
    else if (matches.length > 1) ambiguous.push(token);
    else if (!ids.includes(matches[0]!.id)) ids.push(matches[0]!.id);
  }
  return { ids, unknown, ambiguous };
}

export type DueBatch = {
  make: string;
  model: string;
  /** Most urgent first: never calibrated, expired, then by due date. */
  instruments: { id: string; code: string; validUntil: string | null; validity: ValidityState }[];
};

/**
 * Working instruments that need calibrating (expired, never calibrated, or due
 * within 30 days), grouped by make and model, since one certificate covers one
 * model. The lab plans its week from this.
 */
export async function dueBatches(db: DbExecutor, actor: SessionUser): Promise<DueBatch[]> {
  const rows = await listInstruments(db, actor, {
    tier: "working",
    status: "active",
    validity: "attention",
  });
  const rank: Record<ValidityState, number> = {
    never: 0,
    expired: 1,
    due_7: 2,
    due_15: 3,
    due_30: 4,
    valid: 5,
  };
  const groups = new Map<string, DueBatch>();
  for (const r of rows) {
    const key = `${r.make.toLowerCase()}|${r.model.toLowerCase()}`;
    const group = groups.get(key) ?? { make: r.make, model: r.model, instruments: [] };
    group.instruments.push({
      id: r.id,
      code: r.code,
      validUntil: r.latest?.validUntil ?? null,
      validity: r.validity,
    });
    groups.set(key, group);
  }
  for (const g of groups.values()) {
    g.instruments.sort(
      (a, b) =>
        rank[a.validity] - rank[b.validity] ||
        (a.validUntil ?? "").localeCompare(b.validUntil ?? "") ||
        a.code.localeCompare(b.code),
    );
  }
  return [...groups.values()].sort((a, b) => b.instruments.length - a.instruments.length);
}
