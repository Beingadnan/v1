import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { INVOICE_STATUSES, PAYMENT_MODES, WCR_STATUSES } from "@/domain/billing/types";
import { SIGNED_VIA, type SignBox } from "@/domain/reports/types";

import { jobs } from "./jobs";
import { signatures } from "./signatures";
import { storedFiles } from "./stored-files";
import { users } from "./users";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const byUser = (name: string) =>
  uuid(name).references((): AnyPgColumn => users.id, { onDelete: "restrict" });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * The work completion report of a job (phase 10). Issued once every study's
 * report has gone to the client: its PDF is frozen with its SHA-256. The
 * client accepts it in the app (an electronic signature) or on paper (a scan,
 * with who signed and when). A wrong one is voided with a reason and issued again.
 */
export const jobWcrs = pgTable(
  "job_wcrs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    status: text("status").notNull().default("issued"),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    sha256: text("sha256").notNull(),
    /** Where the client's acceptance box fell on the PDF, for stamping the signature. */
    signBox: jsonb("sign_box").$type<SignBox>(),
    issuedByUserId: byUser("issued_by_user_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    signedVia: text("signed_via"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signatureId: uuid("signature_id").references(() => signatures.id, { onDelete: "restrict" }),
    paperFileId: uuid("paper_file_id").references(() => storedFiles.id, { onDelete: "restrict" }),
    paperSignedByName: text("paper_signed_by_name"),
    paperSignedOn: date("paper_signed_on"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    // One live WCR per job.
    uniqueIndex("job_wcrs_live_key")
      .on(t.jobId)
      .where(sql`${t.status} <> 'void'`),
    foreignKey({
      name: "job_wcrs_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("cascade"),
    check("job_wcrs_status_check", sql`${t.status} in (${list(WCR_STATUSES)})`),
    check(
      "job_wcrs_signed_check",
      sql`(${t.status} = 'signed') = (${t.signedAt} is not null) and (${t.signedAt} is null) = (${t.signedVia} is null) and (${t.signedVia} is null or ${t.signedVia} in (${list(SIGNED_VIA)}))`,
    ),
    check(
      "job_wcrs_paper_check",
      sql`${t.signedVia} is distinct from 'paper' or (${t.paperFileId} is not null and ${t.paperSignedByName} is not null and ${t.paperSignedOn} is not null)`,
    ),
  ],
);

/**
 * A GST invoice raised in Tally for a job (phase 10). Recorded here to follow
 * the money; never deleted: a wrong entry is cancelled with a reason.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    jobId: uuid("job_id").notNull(),
    number: text("number").notNull(),
    /** Financial year of the invoice date, e.g. "2026-27": numbers are unique within it. */
    financialYear: text("financial_year").notNull(),
    invoiceDate: date("invoice_date").notNull(),
    taxable: money("taxable").notNull(),
    gst: money("gst").notNull(),
    total: money("total").notNull(),
    status: text("status").notNull().default("open"),
    note: text("note").notNull().default(""),
    cancelReason: text("cancel_reason"),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    createdByUserId: byUser("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoices_org_fy_number_key")
      .on(t.organisationId, t.financialYear, sql`upper(${t.number})`)
      .where(sql`${t.status} <> 'cancelled'`),
    index("invoices_job_idx").on(t.jobId),
    index("invoices_org_status_idx").on(t.organisationId, t.status, t.invoiceDate),
    foreignKey({
      name: "invoices_job_fk",
      columns: [t.jobId, t.organisationId],
      foreignColumns: [jobs.id, jobs.organisationId],
    }).onDelete("restrict"),
    check("invoices_status_check", sql`${t.status} in (${list(INVOICE_STATUSES)})`),
    check("invoices_number_check", sql`${t.number} ~ '^[A-Za-z0-9/-]{1,16}$'`),
    check(
      "invoices_amounts_check",
      sql`${t.taxable} > 0 and ${t.gst} >= 0 and ${t.total} = ${t.taxable} + ${t.gst}`,
    ),
    check(
      "invoices_cancel_check",
      sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null)`,
    ),
  ],
);

/**
 * Money against an invoice: what reached the bank, the TDS the client
 * deducted (claimed back by QA Tech), and, for the last few rupees of a short
 * payment, a write-off with a reason. Never edited; a wrong entry is reversed.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").notNull(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    paidOn: date("paid_on").notNull(),
    received: money("received").notNull().default("0"),
    tds: money("tds").notNull().default("0"),
    writtenOff: money("written_off").notNull().default("0"),
    mode: text("mode").notNull(),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
    /** A reversal points at the entry it undoes (amounts negated). */
    reversesId: uuid("reverses_id").references((): AnyPgColumn => payments.id, {
      onDelete: "restrict",
    }),
    createdByUserId: byUser("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_invoice_idx").on(t.invoiceId),
    uniqueIndex("payments_reverses_key")
      .on(t.reversesId)
      .where(sql`${t.reversesId} is not null`),
    check("payments_mode_check", sql`${t.mode} in (${list(PAYMENT_MODES)})`),
    check(
      "payments_amounts_check",
      sql`${t.reversesId} is not null or (${t.received} >= 0 and ${t.tds} >= 0 and ${t.writtenOff} >= 0 and ${t.received} + ${t.tds} + ${t.writtenOff} > 0)`,
    ),
    check("payments_writeoff_check", sql`${t.writtenOff} = 0 or length(trim(${t.note})) > 0`),
  ],
);

export type JobWcr = typeof jobWcrs.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
