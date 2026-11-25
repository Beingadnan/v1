import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  CAPA_KINDS,
  CAPA_STATUSES,
  EMAIL_STATUSES,
  NOTIFICATION_KINDS,
} from "@/domain/notifications/types";

import { deviations } from "./analysis";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const byUser = (name: string) =>
  uuid(name).references((): AnyPgColumn => users.id, { onDelete: "restrict" });

/**
 * Something handed to a person (phase 11): written in the same transaction
 * as the event, shown in their bell, and emailed at once or in the daily digest.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailStatus: text("email_status").notNull().default("none"),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    index("notifications_email_idx")
      .on(t.emailStatus)
      .where(sql`${t.emailStatus} = 'pending'`),
    foreignKey({
      name: "notifications_user_fk",
      columns: [t.userId, t.organisationId],
      foreignColumns: [users.id, users.organisationId],
    }).onDelete("restrict"),
    check("notifications_kind_check", sql`${t.kind} in (${list(NOTIFICATION_KINDS)})`),
    check("notifications_email_check", sql`${t.emailStatus} in (${list(EMAIL_STATUSES)})`),
    // A path inside the app: "/x", never "//host" or "/\\host" (both open another site).
    check("notifications_href_check", sql`${t.href} ~ '^/([^/\\\\]|$)'`),
  ],
);

/**
 * A corrective or preventive action raised from a deviation (phase 11), with
 * its owner, due date, what was done, and an effectiveness check by someone
 * other than the owner.
 */
export const capas = pgTable(
  "capas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    deviationId: uuid("deviation_id").notNull(),
    kind: text("kind").notNull(),
    rootCause: text("root_cause").notNull(),
    action: text("action").notNull(),
    ownerUserId: byUser("owner_user_id").notNull(),
    dueOn: date("due_on").notNull(),
    status: text("status").notNull().default("open"),
    doneNote: text("done_note"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    effectivenessNote: text("effectiveness_note"),
    verifiedByUserId: byUser("verified_by_user_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdByUserId: byUser("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("capas_deviation_idx").on(t.deviationId),
    index("capas_org_status_idx").on(t.organisationId, t.status, t.dueOn),
    foreignKey({
      name: "capas_deviation_fk",
      columns: [t.deviationId, t.organisationId],
      foreignColumns: [deviations.id, deviations.organisationId],
    }).onDelete("restrict"),
    check("capas_kind_check", sql`${t.kind} in (${list(CAPA_KINDS)})`),
    check("capas_status_check", sql`${t.status} in (${list(CAPA_STATUSES)})`),
    check("capas_done_check", sql`(${t.status} = 'open') = (${t.doneAt} is null)`),
    check("capas_verified_check", sql`(${t.status} = 'verified') = (${t.verifiedAt} is not null)`),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type Capa = typeof capas.$inferSelect;
