import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { STUDY_CYCLES } from "@/domain/clients/study-defaults";
import { EVENT_KINDS, PRECAL_RESULTS } from "@/domain/field/types";

import { instruments } from "./instruments";
import { studies } from "./jobs";
import { storedFiles } from "./stored-files";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * Sensor positions of a study (L-01…), placed in the equipment as fractions of
 * its length (x), width (y) and height (z), so the drawing scales to any box.
 * A logger is assigned to a position on site.
 */
export const studyPositions = pgTable(
  "study_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    label: text("label").notNull(),
    sort: integer("sort").notNull(),
    x: numeric("x", { precision: 5, scale: 4 }).notNull(),
    y: numeric("y", { precision: 5, scale: 4 }).notNull(),
    z: numeric("z", { precision: 5, scale: 4 }).notNull(),
    note: text("note").notNull().default(""),
    /** Outside the equipment: the room around it. */
    ambient: boolean("ambient").notNull().default(false),
    instrumentId: uuid("instrument_id"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    placedByUserId: uuid("placed_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    uniqueIndex("study_positions_label_key").on(t.studyId, sql`lower(${t.label})`),
    uniqueIndex("study_positions_instrument_key")
      .on(t.studyId, t.instrumentId)
      .where(sql`${t.instrumentId} is not null`),
    index("study_positions_instrument_idx").on(t.instrumentId),
    foreignKey({
      name: "study_positions_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "study_positions_instrument_fk",
      columns: [t.instrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    check(
      "study_positions_xyz_check",
      sql`${t.x} between 0 and 1 and ${t.y} between 0 and 1 and ${t.z} between 0 and 1`,
    ),
    check("study_positions_label_check", sql`length(${t.label}) between 1 and 20`),
  ],
);

/**
 * Time markers recorded on site: a cycle's start and end, door and power
 * events. The id comes from the phone, so a resend after a dropped
 * connection never records the same tap twice.
 */
export const studyEvents = pgTable(
  "study_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    /** A study cycle, or 'routine' for a study without cycles. */
    cycle: text("cycle").notNull(),
    kind: text("kind").notNull(),
    /** When it happened, as tapped on the phone (not when it reached the server). */
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull().default(""),
    /** Struck out by a correction; kept for the audit trail. */
    voided: boolean("voided").notNull().default(false),
    byUserId: uuid("by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("study_events_study_idx").on(t.studyId, t.at),
    foreignKey({
      name: "study_events_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("study_events_cycle_check", sql`${t.cycle} in (${list([...STUDY_CYCLES, "routine"])})`),
    check("study_events_kind_check", sql`${t.kind} in (${list(EVENT_KINDS)})`),
  ],
);

/** Pre-calibration on site (FT-01): each logger read against a master at a point. */
export const studyPrecal = pgTable(
  "study_precal",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    masterInstrumentId: uuid("master_instrument_id"),
    quantity: text("quantity").notNull().default("temperature"),
    reference: numeric("reference", { precision: 10, scale: 4 }).notNull(),
    reading: numeric("reading", { precision: 10, scale: 4 }).notNull(),
    deviation: numeric("deviation", { precision: 10, scale: 4 }).notNull(),
    tolerance: numeric("tolerance", { precision: 8, scale: 4 }).notNull(),
    result: text("result").notNull(),
    byUserId: uuid("by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("study_precal_study_idx").on(t.studyId, t.instrumentId),
    foreignKey({
      name: "study_precal_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "study_precal_instrument_fk",
      columns: [t.instrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "study_precal_master_fk",
      columns: [t.masterInstrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    check("study_precal_result_check", sql`${t.result} in (${list(PRECAL_RESULTS)})`),
    check("study_precal_quantity_check", sql`${t.quantity} in ('temperature', 'humidity')`),
  ],
);

/** Photos of the placement, taken on site. */
export const studyPhotos = pgTable(
  "study_photos",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    /** The position shown, or '' for the whole equipment. */
    positionLabel: text("position_label").notNull().default(""),
    caption: text("caption").notNull().default(""),
    byUserId: uuid("by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("study_photos_study_idx").on(t.studyId),
    foreignKey({
      name: "study_photos_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
  ],
);

export type StudyPosition = typeof studyPositions.$inferSelect;
export type StudyEvent = typeof studyEvents.$inferSelect;
