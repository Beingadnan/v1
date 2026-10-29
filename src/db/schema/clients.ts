import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
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

import { EQUIPMENT_TYPES } from "@/domain/clients/equipment-types";
import { STUDY_CYCLES } from "@/domain/clients/study-defaults";

import { organisations } from "./organisations";
import { users } from "./users";

const typeList = sql.raw(EQUIPMENT_TYPES.map((t) => `'${t}'`).join(", "));
const cycleArray = sql.raw(`array[${STUDY_CYCLES.map((c) => `'${c}'`).join(", ")}]::text[]`);

/**
 * Tenant safety: every child row repeats organisation_id and points at its
 * parent with a composite foreign key (parent id + organisation id). The
 * database itself then refuses a site of one organisation under a company of
 * another, even if application code had a bug.
 */
const audited = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "restrict",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** A client of QA Tech, e.g. Watson Pharma Pvt Limited. */
export const clientCompanies = pgTable(
  "client_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Short name used in report numbers, e.g. "Watson". */
    code: text("code").notNull(),
    gstin: text("gstin").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /**
     * Temperature mapping: post-calibration of loggers only when the client's
     * SOP requires it. Thermal validation always requires it regardless.
     */
    postCalRequired: boolean("post_cal_required").notNull().default(false),
    /** Default time between studies of the same equipment. */
    requalificationMonths: integer("requalification_months").notNull().default(12),
    /** Tokens: {CLIENT} {SITE} {DEPT} {MM} {YY} {YYYY} {EQUIPMENT} {EQUIPMENT_ID} */
    reportNumberFormat: text("report_number_format")
      .notNull()
      .default("{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}"),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    unique("client_companies_id_org_key").on(t.id, t.organisationId),
    uniqueIndex("client_companies_org_name_key").on(t.organisationId, sql`lower(${t.name})`),
    uniqueIndex("client_companies_org_code_key").on(t.organisationId, sql`lower(${t.code})`),
    check("client_companies_requal_check", sql`${t.requalificationMonths} between 1 and 60`),
  ],
);

/** A client location or region, e.g. Watson → Seawoods. */
export const clientSites = pgTable(
  "client_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    companyId: uuid("company_id").notNull(),
    name: text("name").notNull(),
    /** Used in report numbers; usually the same as the name ("Seawoods"). */
    code: text("code").notNull(),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    /** A client registered in several states has a GSTIN per state. */
    gstin: text("gstin").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    foreignKey({
      name: "client_sites_company_fk",
      columns: [t.companyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    unique("client_sites_id_company_key").on(t.id, t.companyId),
    uniqueIndex("client_sites_company_name_key").on(t.companyId, sql`lower(${t.name})`),
    uniqueIndex("client_sites_company_code_key").on(t.companyId, sql`lower(${t.code})`),
  ],
);

/** A department within a client site, e.g. Seawoods → BA. */
export const clientDepartments = pgTable(
  "client_departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    companyId: uuid("company_id").notNull(),
    siteId: uuid("site_id").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    foreignKey({
      name: "client_departments_company_fk",
      columns: [t.companyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "client_departments_site_fk",
      columns: [t.siteId, t.companyId],
      foreignColumns: [clientSites.id, clientSites.companyId],
    }).onDelete("restrict"),
    unique("client_departments_id_site_key").on(t.id, t.siteId),
    uniqueIndex("client_departments_site_name_key").on(t.siteId, sql`lower(${t.name})`),
  ],
);

/**
 * People at the client: QA contacts, and the signatories printed on reports
 * ("Reviewed by" and "Approved by"). Not the same as client users who sign in.
 */
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    companyId: uuid("company_id").notNull(),
    /** Null when the contact covers the whole company. */
    siteId: uuid("site_id"),
    name: text("name").notNull(),
    designation: text("designation").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    /** 'reviewed_by' | 'approved_by' | null when not a report signatory. */
    signatory: text("signatory"),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    foreignKey({
      name: "client_contacts_company_fk",
      columns: [t.companyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "client_contacts_site_fk",
      columns: [t.siteId, t.companyId],
      foreignColumns: [clientSites.id, clientSites.companyId],
    }).onDelete("restrict"),
    index("client_contacts_company_idx").on(t.companyId),
    check(
      "client_contacts_signatory_check",
      sql`${t.signatory} is null or ${t.signatory} in ('reviewed_by', 'approved_by')`,
    ),
  ],
);

/**
 * Something QA Tech maps or validates for a client: a freezer, cold room,
 * warehouse, autoclave… Studies (phase 4+) copy their defaults from here.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    companyId: uuid("company_id").notNull(),
    siteId: uuid("site_id").notNull(),
    departmentId: uuid("department_id"),
    /** The client's equipment ID, e.g. "BE-WF-02". Unique within the company. */
    code: text("code").notNull(),
    /** e.g. "Cold Storage (Walk In Freezer)" */
    name: text("name").notNull(),
    type: text("type").notNull(),
    /** Room or area, e.g. "Walk In Freezer". */
    location: text("location").notNull().default(""),
    make: text("make").notNull().default(""),
    model: text("model").notNull().default(""),
    serialNo: text("serial_no").notNull().default(""),
    lengthM: numeric("length_m", { precision: 8, scale: 2 }),
    widthM: numeric("width_m", { precision: 8, scale: 2 }),
    heightM: numeric("height_m", { precision: 8, scale: 2 }),
    setPointC: numeric("set_point_c", { precision: 6, scale: 2 }),
    /** Acceptance limits. One side may be empty (e.g. "NMT 25 °C"). */
    tempMinC: numeric("temp_min_c", { precision: 6, scale: 2 }),
    tempMaxC: numeric("temp_max_c", { precision: 6, scale: 2 }),
    rhMinPct: numeric("rh_min_pct", { precision: 5, scale: 1 }),
    rhMaxPct: numeric("rh_max_pct", { precision: 5, scale: 1 }),
    /** Number of loggers normally placed. */
    defaultChannels: integer("default_channels"),
    readingIntervalMinutes: integer("reading_interval_minutes"),
    studyDurationHours: integer("study_duration_hours"),
    /** Overrides the company's requalification interval when set. */
    requalificationMonths: integer("requalification_months"),
    /** Cycles each study of this equipment normally runs (empty, loaded, door open, power failure). */
    cycles: text("cycles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Warehouses and stores affected by outside weather are mapped in summer and in winter (WHO). */
    seasonalMapping: boolean("seasonal_mapping").notNull().default(false),
    /**
     * End date of the last study done before QTech (from old reports). Once
     * studies run in the app, the latest signed study takes over.
     */
    lastStudyOn: date("last_study_on"),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...audited,
  },
  (t) => [
    unique("equipment_id_org_key").on(t.id, t.organisationId),
    foreignKey({
      name: "equipment_company_fk",
      columns: [t.companyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "equipment_site_fk",
      columns: [t.siteId, t.companyId],
      foreignColumns: [clientSites.id, clientSites.companyId],
    }).onDelete("restrict"),
    foreignKey({
      name: "equipment_department_fk",
      columns: [t.departmentId, t.siteId],
      foreignColumns: [clientDepartments.id, clientDepartments.siteId],
    }).onDelete("restrict"),
    uniqueIndex("equipment_company_code_key").on(t.companyId, sql`lower(${t.code})`),
    index("equipment_site_idx").on(t.siteId),
    check("equipment_cycles_check", sql`${t.cycles} <@ ${cycleArray}`),
    check("equipment_type_check", sql`${t.type} in (${typeList})`),
    check(
      "equipment_temp_limits_check",
      sql`${t.tempMinC} is null or ${t.tempMaxC} is null or ${t.tempMinC} < ${t.tempMaxC}`,
    ),
    check(
      "equipment_rh_limits_check",
      sql`(${t.rhMinPct} is null or ${t.rhMinPct} between 0 and 100) and (${t.rhMaxPct} is null or ${t.rhMaxPct} between 0 and 100) and (${t.rhMinPct} is null or ${t.rhMaxPct} is null or ${t.rhMinPct} < ${t.rhMaxPct})`,
    ),
    check(
      "equipment_counts_check",
      sql`(${t.defaultChannels} is null or ${t.defaultChannels} between 1 and 500) and (${t.readingIntervalMinutes} is null or ${t.readingIntervalMinutes} between 1 and 1440) and (${t.studyDurationHours} is null or ${t.studyDurationHours} between 1 and 2160) and (${t.requalificationMonths} is null or ${t.requalificationMonths} between 1 and 60)`,
    ),
  ],
);

/**
 * QA Tech's own defaults per equipment type (Settings). A missing row means
 * the built-in defaults in src/domain/clients/study-defaults.ts apply.
 */
export const equipmentTypeDefaults = pgTable(
  "equipment_type_defaults",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    setPointC: numeric("set_point_c", { precision: 6, scale: 2 }),
    tempMinC: numeric("temp_min_c", { precision: 6, scale: 2 }),
    tempMaxC: numeric("temp_max_c", { precision: 6, scale: 2 }),
    rhMinPct: numeric("rh_min_pct", { precision: 5, scale: 1 }),
    rhMaxPct: numeric("rh_max_pct", { precision: 5, scale: 1 }),
    defaultChannels: integer("default_channels"),
    readingIntervalMinutes: integer("reading_interval_minutes"),
    studyDurationHours: integer("study_duration_hours"),
    requalificationMonths: integer("requalification_months"),
    cycles: text("cycles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    seasonalMapping: boolean("seasonal_mapping").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.organisationId, t.type] }),
    check("equipment_type_defaults_type_check", sql`${t.type} in (${typeList})`),
    check("equipment_type_defaults_cycles_check", sql`${t.cycles} <@ ${cycleArray}`),
  ],
);

/**
 * GSTIN lookups already paid for, so the same GSTIN isn't looked up (and
 * charged) again within 30 days. Details are public GST registration data.
 */
export const gstinLookups = pgTable(
  "gstin_lookups",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    gstin: text("gstin").notNull(),
    details: jsonb("details").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organisationId, t.gstin] })],
);

export type ClientCompany = typeof clientCompanies.$inferSelect;
export type ClientSite = typeof clientSites.$inferSelect;
export type ClientDepartment = typeof clientDepartments.$inferSelect;
export type ClientContact = typeof clientContacts.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
