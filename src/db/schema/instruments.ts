import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { AccuracySpec } from "@/domain/instruments/calibration-math";
import {
  INSTRUMENT_STATUSES,
  INSTRUMENT_TIERS,
  INSTRUMENT_TYPES,
  QUANTITIES,
} from "@/domain/instruments/types";

import { clientCompanies } from "./clients";
import { organisations } from "./organisations";
import { sites } from "./settings";
import { storedFiles } from "./stored-files";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/** A default test point of a model: e.g. −25 °C, or 50 %RH at 25 °C. */
export type DefaultPoint = {
  quantity: (typeof QUANTITIES)[number];
  reference: string;
  condition: string;
};

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "restrict",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * A make and model (ebro EBI 20-TH1, Testo 174H…): what every instrument of
 * that model shares — range, resolution, accuracy, usual test points — so
 * adding 50 loggers means choosing the model once.
 */
export const instrumentModels = pgTable(
  "instrument_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    /** As printed on certificates, e.g. "Portable Datalogger". */
    equipmentName: text("equipment_name").notNull(),
    quantities: text("quantities").array().notNull(),
    rangeText: text("range_text").notNull().default(""),
    resolutionText: text("resolution_text").notNull().default(""),
    accuracy: jsonb("accuracy").$type<AccuracySpec>().notNull().default({}),
    /** As printed, e.g. "± 0.5 °C (-20 to 40°C), ± 0.8 °C for the remaining range & ± 3% RH". */
    accuracyText: text("accuracy_text").notNull().default(""),
    calibrationSop: text("calibration_sop").notNull().default(""),
    defaultPoints: jsonb("default_points").$type<DefaultPoint[]>().notNull().default([]),
    intervalMonths: integer("interval_months").notNull().default(12),
    ...stamps,
  },
  (t) => [
    unique("instrument_models_id_org_key").on(t.id, t.organisationId),
    uniqueIndex("instrument_models_org_make_model_key").on(
      t.organisationId,
      sql`lower(${t.make})`,
      sql`lower(${t.model})`,
    ),
    check("instrument_models_type_check", sql`${t.type} in (${list(INSTRUMENT_TYPES)})`),
    check("instrument_models_interval_check", sql`${t.intervalMonths} between 1 and 60`),
  ],
);

/** One physical instrument, identified by QA Tech's ID (E-TRH0524, TL-38) and its serial. */
export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    modelId: uuid("model_id"),
    type: text("type").notNull(),
    /** working = used on client sites; master = reference standard used to calibrate others. */
    tier: text("tier").notNull().default("working"),
    /** QA Tech's ID number, e.g. E-TRH0524 or TL-38. */
    code: text("code").notNull(),
    serialNo: text("serial_no").notNull().default(""),
    make: text("make").notNull().default(""),
    model: text("model").notNull().default(""),
    equipmentName: text("equipment_name").notNull().default(""),
    rangeText: text("range_text").notNull().default(""),
    resolutionText: text("resolution_text").notNull().default(""),
    /** Overrides the model's accuracy when set. */
    accuracy: jsonb("accuracy").$type<AccuracySpec>(),
    accuracyText: text("accuracy_text").notNull().default(""),
    /** QA Tech branch the instrument is kept at. */
    homeSiteId: uuid("home_site_id").references(() => sites.id, { onDelete: "restrict" }),
    /** Null for QA Tech's own; set when a client's instrument is calibrated by QA Tech. */
    ownerCompanyId: uuid("owner_company_id"),
    status: text("status").notNull().default("active"),
    /** Overrides the model's interval when set. */
    intervalMonths: integer("interval_months"),
    notes: text("notes").notNull().default(""),
    ...stamps,
  },
  (t) => [
    unique("instruments_id_org_key").on(t.id, t.organisationId),
    foreignKey({
      name: "instruments_model_fk",
      columns: [t.modelId, t.organisationId],
      foreignColumns: [instrumentModels.id, instrumentModels.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "instruments_owner_fk",
      columns: [t.ownerCompanyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    uniqueIndex("instruments_org_code_key").on(t.organisationId, sql`lower(${t.code})`),
    uniqueIndex("instruments_org_serial_key")
      .on(t.organisationId, sql`lower(${t.make})`, sql`lower(${t.serialNo})`)
      .where(sql`${t.serialNo} <> ''`),
    index("instruments_serial_idx").on(t.organisationId, t.serialNo),
    check("instruments_type_check", sql`${t.type} in (${list(INSTRUMENT_TYPES)})`),
    check("instruments_tier_check", sql`${t.tier} in (${list(INSTRUMENT_TIERS)})`),
    check("instruments_status_check", sql`${t.status} in (${list(INSTRUMENT_STATUSES)})`),
    check(
      "instruments_interval_check",
      sql`${t.intervalMonths} is null or ${t.intervalMonths} between 1 and 60`,
    ),
  ],
);

/**
 * A calibration certificate.
 * - internal: QA Tech calibrated the instruments itself (FT-05), numbered from
 *   QA Tech's series, with points, readings and the masters used.
 * - external: issued by an outside lab (ARAI, Sansel…) for a master or logger,
 *   with the PDF and, optionally, its results and uncertainty.
 * - imported: history from before QTech (number and dates only).
 */
export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("draft"),
    number: text("number").notNull(),
    /** NABL Unique Lab Report number on external certificates. */
    ulrNo: text("ulr_no").notNull().default(""),
    labName: text("lab_name").notNull().default(""),
    labAccreditation: text("lab_accreditation").notNull().default(""),
    /** PDL, RTD, TC… for internal certificates (number series and Calibration Index section). */
    certificateKind: text("certificate_kind").notNull().default(""),
    /** QA Tech site whose series the number came from (internal). */
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "restrict" }),
    calibratedOn: date("calibrated_on").notNull(),
    /** Last day of a multi-day calibration, when the lab gives a range. */
    calibratedUntil: date("calibrated_until"),
    /** Null when the customer asked for no due date ("NA"). */
    validUntil: date("valid_until"),
    issuedOn: date("issued_on"),
    /** Null when the instruments are QA Tech's own. */
    customerCompanyId: uuid("customer_company_id"),
    customerName: text("customer_name").notNull().default(""),
    customerAddress: text("customer_address").notNull().default(""),
    /** Short description for the Calibration Index, e.g. "Ebro Temp. & RH Datalogger 10 (New)". */
    title: text("title").notNull().default(""),
    location: text("location").notNull().default(""),
    department: text("department").notNull().default(""),
    equipmentName: text("equipment_name").notNull().default(""),
    make: text("make").notNull().default(""),
    model: text("model").notNull().default(""),
    rangeText: text("range_text").notNull().default(""),
    resolutionText: text("resolution_text").notNull().default(""),
    accuracy: jsonb("accuracy").$type<AccuracySpec>().notNull().default({}),
    accuracyText: text("accuracy_text").notNull().default(""),
    sopNo: text("sop_no").notNull().default(""),
    conditionOnReceipt: text("condition_on_receipt").notNull().default(""),
    environmentTemperature: text("environment_temperature").notNull().default(""),
    environmentHumidity: text("environment_humidity").notNull().default(""),
    remarks: text("remarks").notNull().default(""),
    /** External: the lab's PDF. Internal: the issued PDF, frozen. */
    fileId: uuid("file_id").references(() => storedFiles.id, { onDelete: "restrict" }),
    /** Who did the calibration (shown in the Calibration Index as "Activity done by"). */
    performedByUserId: uuid("performed_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    /** Free text for imported history ("Kashinath"). */
    performedByName: text("performed_by_name").notNull().default(""),
    preparedByName: text("prepared_by_name").notNull().default(""),
    cancelledReason: text("cancelled_reason"),
    ...stamps,
  },
  (t) => [
    unique("certificates_id_org_key").on(t.id, t.organisationId),
    foreignKey({
      name: "certificates_customer_fk",
      columns: [t.customerCompanyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    uniqueIndex("certificates_org_lab_number_key").on(
      t.organisationId,
      sql`lower(${t.labName})`,
      t.number,
    ),
    index("certificates_org_date_idx").on(t.organisationId, t.calibratedOn),
    check("certificates_kind_check", sql`${t.kind} in ('internal', 'external', 'imported')`),
    check(
      "certificates_status_check",
      sql`${t.status} in ('draft', 'checking', 'approving', 'issued', 'cancelled')`,
    ),
    check(
      "certificates_dates_check",
      sql`(${t.validUntil} is null or ${t.validUntil} >= ${t.calibratedOn}) and (${t.calibratedUntil} is null or ${t.calibratedUntil} >= ${t.calibratedOn})`,
    ),
  ],
);

/** The instruments a certificate covers, in the order printed, with their overall result. */
export const certificateItems = pgTable(
  "certificate_items",
  {
    organisationId: uuid("organisation_id").notNull(),
    certificateId: uuid("certificate_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    position: integer("position").notNull(),
    /** pass / fail / no_limit; null until readings are complete. */
    result: text("result"),
  },
  (t) => [
    primaryKey({ columns: [t.certificateId, t.instrumentId] }),
    foreignKey({
      name: "certificate_items_certificate_fk",
      columns: [t.certificateId, t.organisationId],
      foreignColumns: [certificates.id, certificates.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "certificate_items_instrument_fk",
      columns: [t.instrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    index("certificate_items_instrument_idx").on(t.instrumentId),
    check(
      "certificate_items_result_check",
      sql`${t.result} is null or ${t.result} in ('pass', 'fail', 'no_limit')`,
    ),
  ],
);

/** A test point: the reference (master) value and the condition, e.g. 15.041 °C @ 50 %RH. */
export const certificatePoints = pgTable(
  "certificate_points",
  {
    organisationId: uuid("organisation_id").notNull(),
    certificateId: uuid("certificate_id").notNull(),
    seq: integer("seq").notNull(),
    quantity: text("quantity").notNull(),
    /** Exactly as entered: numeric without scale keeps "−25.084" and "20.44". */
    reference: numeric("reference").notNull(),
    condition: text("condition").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.certificateId, t.seq] }),
    foreignKey({
      name: "certificate_points_certificate_fk",
      columns: [t.certificateId, t.organisationId],
      foreignColumns: [certificates.id, certificates.organisationId],
    }).onDelete("cascade"),
    check("certificate_points_quantity_check", sql`${t.quantity} in (${list(QUANTITIES)})`),
  ],
);

/** One instrument's reading at one point, with the deviation and judgement. */
export const certificateReadings = pgTable(
  "certificate_readings",
  {
    organisationId: uuid("organisation_id").notNull(),
    certificateId: uuid("certificate_id").notNull(),
    seq: integer("seq").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    reading: numeric("reading").notNull(),
    deviation: numeric("deviation").notNull(),
    /** ± expanded uncertainty (k=2), from external certificates. */
    uncertainty: numeric("uncertainty"),
    tolerance: numeric("tolerance"),
    judgement: text("judgement").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.certificateId, t.seq, t.instrumentId] }),
    foreignKey({
      name: "certificate_readings_point_fk",
      columns: [t.certificateId, t.seq],
      foreignColumns: [certificatePoints.certificateId, certificatePoints.seq],
    }).onDelete("cascade"),
    foreignKey({
      name: "certificate_readings_item_fk",
      columns: [t.certificateId, t.instrumentId],
      foreignColumns: [certificateItems.certificateId, certificateItems.instrumentId],
    }).onDelete("cascade"),
    check(
      "certificate_readings_judgement_check",
      sql`${t.judgement} in ('pass', 'fail', 'no_limit')`,
    ),
  ],
);

/**
 * The reference standards used for an internal calibration, and which of
 * their certificates was valid that day: the next link in the traceability chain.
 */
export const certificateMasters = pgTable(
  "certificate_masters",
  {
    organisationId: uuid("organisation_id").notNull(),
    certificateId: uuid("certificate_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    masterCertificateId: uuid("master_certificate_id").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.certificateId, t.instrumentId] }),
    foreignKey({
      name: "certificate_masters_certificate_fk",
      columns: [t.certificateId, t.organisationId],
      foreignColumns: [certificates.id, certificates.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "certificate_masters_instrument_fk",
      columns: [t.instrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "certificate_masters_master_certificate_fk",
      columns: [t.masterCertificateId, t.organisationId],
      foreignColumns: [certificates.id, certificates.organisationId],
    }).onDelete("restrict"),
    index("certificate_masters_master_idx").on(t.masterCertificateId),
  ],
);

export type InstrumentModel = typeof instrumentModels.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
export type CertificatePoint = typeof certificatePoints.$inferSelect;
export type CertificateReading = typeof certificateReadings.$inferSelect;
