import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  JOB_STATUSES,
  RATE_BASES,
  READINESS_ITEMS,
  SEASONS,
  WORK_TYPES,
} from "@/domain/jobs/types";

import { clientCompanies, clientSites, equipment } from "./clients";
import { instruments } from "./instruments";
import { organisations } from "./organisations";
import { sites } from "./settings";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * Prices per work type and equipment type, multiplied by a basis (per study,
 * per cycle, per logger, per m³). A blank equipment type or duration matches
 * any; the most specific line wins.
 */
export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    workType: text("work_type").notNull(),
    /** Equipment type, or '' for any. */
    equipmentType: text("equipment_type").notNull().default(""),
    /** Study duration this price is for (24, 72…), or null for any. */
    durationHours: integer("duration_hours"),
    basis: text("basis").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rate_cards_org_line_key")
      .on(
        t.organisationId,
        t.workType,
        t.equipmentType,
        t.basis,
        sql`coalesce(${t.durationHours}, 0)`,
      )
      .where(sql`${t.active}`),
    check("rate_cards_work_type_check", sql`${t.workType} in (${list(WORK_TYPES)})`),
    check("rate_cards_basis_check", sql`${t.basis} in (${list(RATE_BASES)})`),
    check("rate_cards_price_check", sql`${t.price} >= 0`),
  ],
);

/** A job: one client site, one or more equipment items, from creation to payment. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    /** QT/J/2026/0142: allocated at creation, never reused. */
    number: text("number").notNull(),
    status: text("status").notNull().default("created"),
    /** The status to return to when an on-hold job resumes. */
    heldFrom: text("held_from"),
    companyId: uuid("company_id").notNull(),
    clientSiteId: uuid("client_site_id").notNull(),
    /** QA Tech branch doing the work (BHW, BDD…): its loggers are booked first. */
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "restrict" }),
    title: text("title").notNull().default(""),
    poNumber: text("po_number").notNull().default(""),
    poDate: date("po_date"),
    poValue: numeric("po_value", { precision: 12, scale: 2 }),
    /** A custom quote for non-standard work; overrides the rate card. */
    quotedValue: numeric("quoted_value", { precision: 12, scale: 2 }),
    plannedStart: date("planned_start").notNull(),
    plannedEnd: date("planned_end").notNull(),
    notes: text("notes").notNull().default(""),
    cancelledReason: text("cancelled_reason"),
    holdReason: text("hold_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("jobs_id_org_key").on(t.id, t.organisationId),
    uniqueIndex("jobs_org_number_key").on(t.organisationId, t.number),
    index("jobs_org_po_idx").on(t.organisationId, sql`lower(${t.poNumber})`),
    index("jobs_org_status_idx").on(t.organisationId, t.status),
    foreignKey({
      name: "jobs_company_fk",
      columns: [t.companyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "jobs_client_site_fk",
      columns: [t.clientSiteId, t.companyId],
      foreignColumns: [clientSites.id, clientSites.companyId],
    }).onDelete("restrict"),
    check("jobs_status_check", sql`${t.status} in (${list(JOB_STATUSES)})`),
    check("jobs_dates_check", sql`${t.plannedEnd} >= ${t.plannedStart}`),
    check(
      "jobs_money_check",
      sql`(${t.poValue} is null or ${t.poValue} >= 0) and (${t.quotedValue} is null or ${t.quotedValue} >= 0)`,
    ),
  ],
);

/**
 * One equipment item on a job = one study. Defaults are copied from the
 * equipment when the job is made, so later edits to the equipment never change
 * a study, and its report number is reserved here.
 */
export const studies = pgTable(
  "studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    equipmentId: uuid("equipment_id").notNull(),
    position: integer("position").notNull(),
    workType: text("work_type").notNull(),
    status: text("status").notNull().default("planned"),
    /** Reserved in the client's format at creation; never recalculated. */
    reportNumber: text("report_number").notNull(),
    cycles: text("cycles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    season: text("season").notNull().default(""),
    setPointC: numeric("set_point_c", { precision: 6, scale: 2 }),
    tempMinC: numeric("temp_min_c", { precision: 6, scale: 2 }),
    tempMaxC: numeric("temp_max_c", { precision: 6, scale: 2 }),
    rhMinPct: numeric("rh_min_pct", { precision: 5, scale: 1 }),
    rhMaxPct: numeric("rh_max_pct", { precision: 5, scale: 1 }),
    loggerCount: integer("logger_count").notNull().default(0),
    intervalMinutes: integer("interval_minutes"),
    durationHours: integer("duration_hours"),
    postCalRequired: boolean("post_cal_required").notNull().default(false),
    /** Rate-card line price at creation (null when no line matched). */
    price: numeric("price", { precision: 12, scale: 2 }),
    priceNote: text("price_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("studies_id_org_key").on(t.id, t.organisationId),
    uniqueIndex("studies_org_report_number_key").on(
      t.organisationId,
      sql`lower(${t.reportNumber})`,
    ),
    index("studies_job_idx").on(t.jobId),
    index("studies_equipment_idx").on(t.equipmentId),
    foreignKey({
      name: "studies_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "studies_equipment_fk",
      columns: [t.equipmentId, t.organisationId],
      foreignColumns: [equipment.id, equipment.organisationId],
    }).onDelete("restrict"),
    check("studies_work_type_check", sql`${t.workType} in (${list(WORK_TYPES)})`),
    check("studies_season_check", sql`${t.season} in (${list(SEASONS)})`),
    check("studies_loggers_check", sql`${t.loggerCount} between 0 and 500`),
    check("studies_status_check", sql`${t.status} in ('planned', 'in_progress', 'completed')`),
  ],
);

/** People on a job and what they do on it. */
export const jobTeam = pgTable(
  "job_team",
  {
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.userId, t.role] }),
    foreignKey({
      name: "job_team_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_team_user_fk",
      columns: [t.userId, t.organisationId],
      foreignColumns: [users.id, users.organisationId],
    }).onDelete("restrict"),
    index("job_team_user_idx").on(t.userId),
    check(
      "job_team_role_check",
      sql`${t.role} in ('team_leader', 'field_engineer', 'report_preparer')`,
    ),
  ],
);

/** Readiness items ticked by people (the calculated ones are worked out live). */
export const jobReadiness = pgTable(
  "job_readiness",
  {
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    key: text("key").notNull(),
    state: text("state").notNull().default("pending"),
    note: text("note").notNull().default(""),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.key] }),
    foreignKey({
      name: "job_readiness_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("cascade"),
    check("job_readiness_key_check", sql`${t.key} in (${list(READINESS_ITEMS)})`),
    check("job_readiness_state_check", sql`${t.state} in ('ready', 'pending', 'na')`),
  ],
);

/** Instruments booked for a job (loggers, probes, masters for pre/post-cal). */
export const jobInstruments = pgTable(
  "job_instruments",
  {
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    bookedAt: timestamp("booked_at", { withTimezone: true }).notNull().defaultNow(),
    bookedByUserId: uuid("booked_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.instrumentId] }),
    foreignKey({
      name: "job_instruments_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "job_instruments_instrument_fk",
      columns: [t.instrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    index("job_instruments_instrument_idx").on(t.instrumentId),
  ],
);

/** Every status change with who, when and why: the job's stage history. */
export const jobStatusHistory = pgTable(
  "job_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason").notNull().default(""),
    byUserId: uuid("by_user_id").references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "job_status_history_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("cascade"),
    index("job_status_history_job_idx").on(t.jobId, t.at),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type Study = typeof studies.$inferSelect;
export type RateCard = typeof rateCards.$inferSelect;
