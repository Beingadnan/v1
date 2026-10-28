import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { organisations } from "./organisations";

/**
 * Append-only record of every important action (GMP / 21 CFR Part 11 style).
 *
 * Rows can never be updated or deleted: a database trigger (migration
 * 0001_audit_log_append_only) rejects UPDATE, DELETE and TRUNCATE for every
 * role, so this is enforced below the application, not just by convention.
 *
 * actor_user_id has no foreign key yet because the users table arrives in
 * phase 1; that phase adds the constraint.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    /** Monotonic id gives a reliable insertion order for audit review. */
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    /** Dotted verb, e.g. "file.stored", "study.status_changed". */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** One plain-language line shown in the audit trail screen. */
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    /** Required by the app for edits and destructive actions. */
    reason: text("reason"),
    requestId: text("request_id"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    check("audit_log_actor_type_check", sql`${t.actorType} in ('user', 'system')`),
    check(
      "audit_log_user_actor_check",
      sql`${t.actorType} <> 'user' or ${t.actorUserId} is not null`,
    ),
    check("audit_log_action_format_check", sql`${t.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    index("audit_log_org_time_idx").on(t.organisationId, t.occurredAt.desc()),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
