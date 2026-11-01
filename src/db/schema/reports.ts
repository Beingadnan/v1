import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { REPORT_STATUSES } from "@/domain/reports/types";

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
  ],
);
