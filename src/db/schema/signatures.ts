import { sql } from "drizzle-orm";
import { check, index, inet, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organisations } from "./organisations";
import { users } from "./users";

/**
 * Electronic signatures (21 CFR Part 11 style): who signed, when, what it means
 * and exactly what content was signed (record_hash). Append-only, enforced by a
 * database trigger like audit_log.
 */
export const signatures = pgTable(
  "signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Name and role are copied at signing time, so later edits to the user do not change history. */
    signerName: text("signer_name").notNull(),
    signerRole: text("signer_role").notNull(),
    /** What the signature means, e.g. done_by, checked_by, reviewed_by, approved_by. */
    meaning: text("meaning").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** SHA-256 of the exact content signed (e.g. the frozen PDF). */
    recordHash: text("record_hash").notNull(),
    reason: text("reason"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("signatures_entity_idx").on(t.entityType, t.entityId),
    check("signatures_record_hash_check", sql`${t.recordHash} ~ '^[0-9a-f]{64}$'`),
    check("signatures_meaning_check", sql`${t.meaning} ~ '^[a-z_]+$'`),
  ],
);

export type Signature = typeof signatures.$inferSelect;
