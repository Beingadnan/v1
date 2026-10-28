import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organisations } from "./organisations";
import { storedFiles } from "./stored-files";
import { users } from "./users";

/**
 * Organisation-wide settings: letterhead details, number formats and the
 * calculation constants used by default. One row per organisation.
 * Studies copy the constants they were calculated with, so changing a default
 * never changes an issued report.
 */
export const organisationSettings = pgTable(
  "organisation_settings",
  {
    organisationId: uuid("organisation_id")
      .primaryKey()
      .references(() => organisations.id, { onDelete: "restrict" }),
    legalName: text("legal_name").notNull(),
    shortName: text("short_name").notNull(),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    website: text("website").notNull().default(""),
    gstin: text("gstin").notNull().default(""),
    letterheadFileId: uuid("letterhead_file_id").references(() => storedFiles.id, {
      onDelete: "restrict",
    }),
    /** e.g. "QT/J/{YYYY}/{SEQ:4}" */
    jobNumberFormat: text("job_number_format").notNull().default("QT/J/{YYYY}/{SEQ:4}"),
    /** e.g. "CERT-{SITE}-{YYYY}-{SEQ:4}" — one sequence per site per year. */
    certificateNumberFormat: text("certificate_number_format")
      .notNull()
      .default("CERT-{SITE}-{YYYY}-{SEQ:4}"),
    /** Activation energy for MKT in kJ/mol (ΔH/R = 10 000 K at 83.144). */
    mktActivationEnergyKjMol: numeric("mkt_activation_energy_kj_mol", { precision: 8, scale: 3 })
      .notNull()
      .default("83.144"),
    f0ReferenceTempC: numeric("f0_reference_temp_c", { precision: 6, scale: 2 })
      .notNull()
      .default("121.10"),
    f0ZValueC: numeric("f0_z_value_c", { precision: 6, scale: 2 }).notNull().default("10.00"),
    sessionIdleMinutes: integer("session_idle_minutes").notNull().default(30),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    check("org_settings_idle_check", sql`${t.sessionIdleMinutes} between 5 and 240`),
    check("org_settings_mkt_check", sql`${t.mktActivationEnergyKjMol} > 0`),
    check("org_settings_z_check", sql`${t.f0ZValueC} > 0`),
  ],
);

/** QA Tech's branch locations (BHW, IND, BDD, NGP, HDP, SLK). */
export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sites_org_code_key").on(t.organisationId, t.code),
    check("sites_code_format_check", sql`${t.code} ~ '^[A-Z]{2,5}$'`),
  ],
);

/**
 * Counters behind generated numbers. One row per (organisation, kind, site, year).
 * Rows are only ever incremented inside a transaction with a row lock, so two
 * people can never receive the same number.
 */
export const numberSeries = pgTable(
  "number_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    /** Site code, or '' for organisation-wide series (job numbers). */
    siteCode: text("site_code").notNull().default(""),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [
    uniqueIndex("number_series_key").on(t.organisationId, t.kind, t.siteCode, t.year),
    check("number_series_kind_check", sql`${t.kind} in ('job', 'certificate')`),
    check("number_series_value_check", sql`${t.lastValue} >= 0`),
  ],
);

export type OrganisationSettings = typeof organisationSettings.$inferSelect;
export type Site = typeof sites.$inferSelect;
