import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { organisations } from "./organisations";

/**
 * Registry of file contents kept in blob storage (raw logger exports,
 * certificate scans, generated PDFs, signed copies).
 *
 * One row per distinct content per organisation. The name a person gave a
 * file belongs to the record that uses it (an import, a certificate…), since
 * the same bytes can be attached in several places under different names.
 * Rows are never updated or deleted by the app.
 */
export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Detected from the content, not the file name. */
    fileType: text("file_type").notNull(),
    mimeType: text("mime_type").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Name at first upload, for display in the audit trail only. */
    firstFileName: text("first_file_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Users table arrives in phase 1, which adds the foreign key. */
    createdByUserId: uuid("created_by_user_id"),
  },
  (t) => [
    uniqueIndex("stored_files_org_sha256_key").on(t.organisationId, t.sha256),
    check("stored_files_sha256_format_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("stored_files_size_check", sql`${t.sizeBytes} > 0`),
    check(
      "stored_files_type_check",
      sql`${t.fileType} in ('pdf', 'xlsx', 'xls', 'csv', 'png', 'jpeg')`,
    ),
  ],
);

export type StoredFile = typeof storedFiles.$inferSelect;
