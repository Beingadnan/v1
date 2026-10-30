import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
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

import { ISSUE_KINDS } from "@/domain/data/checks";

import { studyPositions } from "./field";
import { studies } from "./jobs";
import { storedFiles } from "./stored-files";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const byUser = (name: string) =>
  uuid(name).references((): AnyPgColumn => users.id, { onDelete: "restrict" });

/**
 * A logger export uploaded for a study (phase 6). The file itself is kept as
 * it came in stored_files (with its hash); this is what was read from it.
 * A replaced file stays, marked replaced, so the history is complete.
 */
export const studyDataFiles = pgTable(
  "study_data_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    sheet: text("sheet").notNull(),
    /** Epoch ms of each reading row. */
    times: bigint("times", { mode: "number" }).array().notNull(),
    firstDataRow: integer("first_data_row").notNull(),
    lastDataRow: integer("last_data_row").notNull(),
    intervalMinutes: integer("interval_minutes"),
    /** What the reader decided, in words, and rows it couldn't read. */
    notes: text("notes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    badTimeRows: jsonb("bad_time_rows")
      .$type<{ row: number; text: string }[]>()
      .notNull()
      .default([]),
    uploadedByUserId: byUser("uploaded_by_user_id").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
    replacedByUserId: byUser("replaced_by_user_id"),
    replaceReason: text("replace_reason").notNull().default(""),
  },
  (t) => [
    unique("study_data_files_id_org_key").on(t.id, t.organisationId),
    index("study_data_files_study_idx").on(t.studyId),
    foreignKey({
      name: "study_data_files_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
  ],
);

/** One column of readings from a file, and the position it belongs to. */
export const studyDataChannels = pgTable(
  "study_data_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    dataFileId: uuid("data_file_id").notNull(),
    column: integer("column").notNull(),
    header: text("header").notNull(),
    serial: text("serial"),
    quantity: text("quantity").notNull(),
    ambient: boolean("ambient").notNull().default(false),
    /** One per time in the file; null where the cell was empty or unreadable. */
    values: doublePrecision("values").array().notNull(),
    unreadable: integer("unreadable")
      .array()
      .notNull()
      .default(sql`'{}'::int[]`),
    /** Set by a person: the position, or ignored. Null: matched automatically. */
    manualPositionId: uuid("manual_position_id"),
    ignored: boolean("ignored").notNull().default(false),
    manualByUserId: byUser("manual_by_user_id"),
    manualAt: timestamp("manual_at", { withTimezone: true }),
  },
  (t) => [
    index("study_data_channels_file_idx").on(t.dataFileId),
    foreignKey({
      name: "study_data_channels_file_fk",
      columns: [t.dataFileId, t.organisationId],
      foreignColumns: [studyDataFiles.id, studyDataFiles.organisationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "study_data_channels_position_fk",
      columns: [t.manualPositionId],
      foreignColumns: [studyPositions.id],
    }).onDelete("set null"),
    check("study_data_channels_quantity_check", sql`${t.quantity} in ('temp', 'rh')`),
  ],
);

/** The latest check of a study's data; replaced each time the data changes. */
export const studyDataIssues = pgTable(
  "study_data_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    cycle: text("cycle"),
    positionId: uuid("position_id"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("study_data_issues_key").on(t.studyId, t.fingerprint),
    foreignKey({
      name: "study_data_issues_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("study_data_issues_kind_check", sql`${t.kind} in (${list(ISSUE_KINDS)})`),
    check("study_data_issues_severity_check", sql`${t.severity} in ('blocker', 'warning', 'info')`),
  ],
);

/**
 * A team leader's decision to go on despite a problem, with the reason
 * ("logger failed; excluded, see deviation"). It applies to that exact
 * problem (its fingerprint) for as long as the problem is there.
 */
export const studyDataAcceptances = pgTable(
  "study_data_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    reason: text("reason").notNull(),
    acceptedByUserId: byUser("accepted_by_user_id").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByUserId: byUser("withdrawn_by_user_id"),
  },
  (t) => [
    uniqueIndex("study_data_acceptances_key")
      .on(t.studyId, t.fingerprint)
      .where(sql`${t.withdrawnAt} is null`),
    foreignKey({
      name: "study_data_acceptances_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("study_data_acceptances_reason_check", sql`length(${t.reason}) between 5 and 500`),
  ],
);

/** "Please send L-03's file": a request to the site, closed by the next upload. */
export const studyDataRequests = pgTable(
  "study_data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    note: text("note").notNull(),
    requestedByUserId: byUser("requested_by_user_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: byUser("closed_by_user_id"),
    closedNote: text("closed_note").notNull().default(""),
  },
  (t) => [
    index("study_data_requests_open_idx")
      .on(t.studyId)
      .where(sql`${t.closedAt} is null`),
    foreignKey({
      name: "study_data_requests_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("study_data_requests_note_check", sql`length(${t.note}) between 3 and 1000`),
  ],
);
