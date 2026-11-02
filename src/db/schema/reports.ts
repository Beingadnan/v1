import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  COMMENT_SIDES,
  REPORT_SECTIONS,
  REPORT_STATUSES,
  SIGNED_VIA,
  type ReportLayout,
} from "@/domain/reports/types";

import { studyAnalysisRuns } from "./analysis";
import { studies } from "./jobs";
import { storedFiles } from "./stored-files";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const byUser = (name: string) =>
  uuid(name).references((): AnyPgColumn => users.id, { onDelete: "restrict" });

/**
 * One revision of a study's report (FT-09), Rev 00, 01… (phase 8).
 *
 * A draft follows the study's approved analysis run and renders fresh with a
 * DRAFT watermark. Freezing renders it once: the PDF is kept in content-
 * addressed storage with its SHA-256, and the run it was built from is
 * recorded. A later revision needs a reason and supersedes the one before.
 * Observation and conclusion are null while they follow the template; text a
 * person wrote is kept (and audited).
 */
export const studyReports = pgTable(
  "study_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    rev: integer("rev").notNull(),
    status: text("status").notNull().default("draft"),
    /** Why this revision was made (empty for Rev 00). */
    reason: text("reason").notNull().default(""),
    observation: text("observation"),
    conclusion: text("conclusion"),
    /** Set when frozen: the run the report was built from. */
    runId: uuid("run_id").references(() => studyAnalysisRuns.id, { onDelete: "restrict" }),
    fileId: uuid("file_id").references(() => storedFiles.id, { onDelete: "restrict" }),
    sha256: text("sha256"),
    pages: integer("pages"),
    createdByUserId: byUser("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    frozenByUserId: byUser("frozen_by_user_id"),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    /** Where each section and the signature boxes fell in the frozen PDF (phase 9). */
    layout: jsonb("layout").$type<ReportLayout>(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByUserId: byUser("released_by_user_id"),
    /** The client users it was released to. */
    releasedTo: jsonb("released_to").$type<string[]>().notNull().default([]),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedVia: text("signed_via"),
    /** The issued copy: the frozen PDF with its signatures stamped in (app route). */
    signedFileId: uuid("signed_file_id").references(() => storedFiles.id, {
      onDelete: "restrict",
    }),
    signedSha256: text("signed_sha256"),
  },
  (t) => [
    uniqueIndex("study_reports_rev_key").on(t.studyId, t.rev),
    // One draft at a time per study.
    uniqueIndex("study_reports_one_draft_key")
      .on(t.studyId)
      .where(sql`${t.status} = 'draft'`),
    index("study_reports_org_idx").on(t.organisationId, t.createdAt),
    foreignKey({
      name: "study_reports_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("study_reports_status_check", sql`${t.status} in (${list(REPORT_STATUSES)})`),
    check("study_reports_rev_check", sql`${t.rev} between 0 and 99`),
    check(
      "study_reports_frozen_check",
      sql`(${t.status} = 'draft') = (${t.fileId} is null) and (${t.status} = 'draft') = (${t.sha256} is null) and (${t.status} = 'draft') = (${t.runId} is null)`,
    ),
    check("study_reports_reason_check", sql`${t.rev} = 0 or length(trim(${t.reason})) > 0`),
    check(
      "study_reports_signed_check",
      sql`(${t.signedAt} is null) = (${t.signedVia} is null) and (${t.signedVia} is null or ${t.signedVia} in (${list(SIGNED_VIA)}))`,
    ),
  ],
);

/**
 * A review comment, pinned to a section of a frozen revision (phase 9). QA
 * Tech's checker or the client writes it when sending the report back; the
 * preparer answers it before the report goes forward again.
 */
export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    studyId: uuid("study_id").notNull(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => studyReports.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    page: integer("page"),
    body: text("body").notNull(),
    side: text("side").notNull(),
    byUserId: byUser("by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    answer: text("answer"),
    answeredByUserId: byUser("answered_by_user_id"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [
    index("report_comments_study_idx").on(t.studyId, t.createdAt),
    foreignKey({
      name: "report_comments_study_fk",
      columns: [t.studyId, t.organisationId],
      foreignColumns: [studies.id, studies.organisationId],
    }).onDelete("cascade"),
    check("report_comments_section_check", sql`${t.section} in (${list(REPORT_SECTIONS)})`),
    check("report_comments_side_check", sql`${t.side} in (${list(COMMENT_SIDES)})`),
    check("report_comments_body_check", sql`length(trim(${t.body})) > 0`),
    check("report_comments_answer_check", sql`(${t.answer} is null) = (${t.answeredAt} is null)`),
  ],
);

/**
 * The client's sign-off on paper (phase 9): the scan of the signed report,
 * kept with its SHA-256 next to the frozen PDF's, and who signed and when.
 */
export const reportPaperSignoffs = pgTable(
  "report_paper_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => studyReports.id, { onDelete: "restrict" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    scanSha256: text("scan_sha256").notNull(),
    /** The frozen PDF the paper is a print of. */
    reportSha256: text("report_sha256").notNull(),
    reviewedByName: text("reviewed_by_name").notNull(),
    reviewedOn: date("reviewed_on").notNull(),
    approvedByName: text("approved_by_name").notNull(),
    approvedByTitle: text("approved_by_title").notNull().default(""),
    approvedOn: date("approved_on").notNull(),
    recordedByUserId: byUser("recorded_by_user_id").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("report_paper_signoffs_report_key").on(t.reportId),
    check("report_paper_signoffs_dates_check", sql`${t.approvedOn} >= ${t.reviewedOn}`),
  ],
);

export type StudyReport = typeof studyReports.$inferSelect;
export type ReportComment = typeof reportComments.$inferSelect;
