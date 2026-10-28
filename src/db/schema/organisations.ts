import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * A validation company using the platform (QA Tech first).
 * Every business table carries organisation_id so the app can later serve
 * other companies with strict data isolation. Letterhead, number series and
 * other settings are added in phase 1.
 */
export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable short code used in URLs and number series, e.g. "qatech". */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organisations_slug_key").on(t.slug)],
);

export type Organisation = typeof organisations.$inferSelect;
