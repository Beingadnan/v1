import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { EngineResult } from "@/domain/analysis/engine";
import {
  DEVIATION_DECISIONS,
  DEVIATION_SOURCES,
  EXCURSION_DECISIONS,
  RUN_KINDS,
  type RunInputs,
} from "@/domain/analysis/types";

import { instruments } from "./instruments";
import { studies } from "./jobs";
import { signatures } from "./signatures";
import { storedFiles } from "./stored-files";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const byUser = (name: string) =>
  uuid(name).references((): AnyPgColumn => users.id, { onDelete: "restrict" });

/**
 * One run of the analysis engine on a study's data (phase 7). Never changed
 * after it is made (a trigger refuses updates): recalculating makes a new
 * run. It keeps everything needed to reproduce it: the engine version, the
 * constants and limits, the data files' hashes, the accepted problems, the
 * windows and every result. `inputHash` tells whether the data or decisions
 * have changed since (the run is then out of date).
 */
export const studyAnalysisRuns = pgTable(
  "study_analysis_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    /** 1, 2, 3… per study. */
    runNo: integer("run_no").notNull(),
    /** 'analysis', or 'impact' (a what-if with post-cal errors applied, for a deviation). */
    kind: text("kind").notNull().default("analysis"),
    deviationId: uuid("deviation_id"),
    engineVersion: text("engine_version").notNull(),
    inputs: jsonb("inputs").$type<RunInputs>().notNull(),
    inputHash: text("input_hash").notNull(),
    result: jsonb("result").$type<EngineResult>().notNull(),
    byUserId: byUser("by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("study_analysis_runs_id_org_key").on(t.id, t.organisationId),
    uniqueIndex("study_analysis_runs_no_key").on(t.studyId, t.runNo),
    index("study_analysis_runs_deviation_idx").on(t.deviationId),
    foreignKey({
      name: "study_analysis_runs_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("study_analysis_runs_kind_check", sql`${t.kind} in (${list(RUN_KINDS)})`),
  ],
);

/**
 * A decision on one excursion: accepted with a reason, or raised as a
 * deviation. Keyed by a fingerprint (position, quantity, side, cycle, start),
 * so it carries over to the next run while the excursion is the same.
 */
export const studyExcursionReviews = pgTable(
  "study_excursion_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    deviationId: uuid("deviation_id"),
    byUserId: byUser("by_user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByUserId: byUser("withdrawn_by_user_id"),
  },
  (t) => [
    uniqueIndex("study_excursion_reviews_live_key")
      .on(t.studyId, t.fingerprint)
      .where(sql`${t.withdrawnAt} is null`),
    foreignKey({
      name: "study_excursion_reviews_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check(
      "study_excursion_reviews_decision_check",
      sql`${t.decision} in (${list(EXCURSION_DECISIONS)})`,
    ),
    check("study_excursion_reviews_reason_check", sql`length(trim(${t.reason})) > 0`),
  ],
);

/**
 * A deviation (QT/DEV/2026/0001): a logger that failed post-calibration, an
 * excursion raised by a person, or one opened by hand. QA Tech writes its
 * assessment; the client's QA head decides (recorded by name and date, with
 * an optional scan of the signed paper). While one is open, the study's
 * analysis can't be approved.
 */
export const deviations = pgTable(
  "deviations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    number: text("number").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** The position it is about (post-cal failure, excursion). */
    positionId: uuid("position_id"),
    instrumentId: uuid("instrument_id"),
    /** The failed post-cal reading, when that is the source. */
    precalId: uuid("precal_id"),
    openedByUserId: byUser("opened_by_user_id"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    assessment: text("assessment").notNull().default(""),
    assessedByUserId: byUser("assessed_by_user_id"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    decision: text("decision"),
    decidedByName: text("decided_by_name"),
    decidedByTitle: text("decided_by_title"),
    decidedOn: date("decided_on"),
    decisionNote: text("decision_note").notNull().default(""),
    decisionFileId: uuid("decision_file_id").references(() => storedFiles.id, {
      onDelete: "restrict",
    }),
    decisionRecordedByUserId: byUser("decision_recorded_by_user_id"),
    /** Phase 9: the client QA head's electronic signature, when decided in the app. */
    decisionSignatureId: uuid("decision_signature_id").references(() => signatures.id, {
      onDelete: "restrict",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    unique("deviations_id_org_key").on(t.id, t.organisationId),
    uniqueIndex("deviations_org_number_key").on(t.organisationId, sql`lower(${t.number})`),
    uniqueIndex("deviations_precal_key")
      .on(t.precalId)
      .where(sql`${t.precalId} is not null`),
    index("deviations_study_idx").on(t.studyId),
    foreignKey({
      name: "deviations_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "deviations_instrument_fk",
      columns: [t.instrumentId, t.organisationId],
      foreignColumns: [instruments.id, instruments.organisationId],
    }).onDelete("restrict"),
    check("deviations_source_check", sql`${t.source} in (${list(DEVIATION_SOURCES)})`),
    check(
      "deviations_decision_check",
      sql`${t.decision} is null or ${t.decision} in (${list(DEVIATION_DECISIONS)})`,
    ),
    check("deviations_closed_check", sql`(${t.closedAt} is null) = (${t.decision} is null)`),
    check(
      "deviations_decided_check",
      sql`${t.decision} is null or (${t.decidedByName} is not null and ${t.decidedOn} is not null)`,
    ),
  ],
);
