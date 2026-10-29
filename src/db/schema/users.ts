import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { CLIENT_ROLES, ROLES } from "@/domain/auth/roles";

import { clientCompanies } from "./clients";
import { organisations } from "./organisations";

const roleList = sql.raw(ROLES.map((r) => `'${r}'`).join(", "));
const clientRoleList = sql.raw(CLIENT_ROLES.map((r) => `'${r}'`).join(", "));

/**
 * People who can sign in: QA Tech staff and (from phase 2) client QA users.
 * Users are never deleted, only deactivated, because audit rows and signatures
 * point at them.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    /** Stored as typed; uniqueness and login are case-insensitive (lower(email)). */
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /** Client users belong to exactly one client company; staff to none. */
    clientCompanyId: uuid("client_company_id"),
    /** Null until the person sets a password from their invite link. */
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("invited"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
    index("users_org_idx").on(t.organisationId),
    check("users_role_check", sql`${t.role} in (${roleList})`),
    check("users_status_check", sql`${t.status} in ('invited', 'active', 'deactivated')`),
    check(
      "users_active_has_password_check",
      sql`${t.status} <> 'active' or ${t.passwordHash} is not null`,
    ),
    check("users_email_format_check", sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check(
      "users_client_company_check",
      sql`(${t.role} in (${clientRoleList})) = (${t.clientCompanyId} is not null)`,
    ),
    foreignKey({
      name: "users_client_company_fk",
      columns: [t.clientCompanyId, t.organisationId],
      foreignColumns: [clientCompanies.id, clientCompanies.organisationId],
    }).onDelete("restrict"),
  ],
);

/**
 * A signed-in browser. The cookie holds a random token; only its SHA-256 is
 * stored, so a database leak does not hand out live sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Hard limit regardless of activity. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/** One-time links for setting a first password (invite) or a new one (reset). */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    uniqueIndex("account_tokens_token_hash_key").on(t.tokenHash),
    index("account_tokens_user_idx").on(t.userId),
    check("account_tokens_purpose_check", sql`${t.purpose} in ('setup', 'reset')`),
  ],
);

/** Every sign-in attempt, for throttling by IP and for security review. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    emailLower: text("email_lower").notNull(),
    ipAddress: inet("ip_address"),
    outcome: text("outcome").notNull(),
  },
  (t) => [
    index("login_attempts_ip_time_idx").on(t.ipAddress, t.attemptedAt),
    check(
      "login_attempts_outcome_check",
      sql`${t.outcome} in ('success', 'bad_credentials', 'locked', 'inactive', 'throttled')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
