import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { reads } from "@/db/reads";
import type { Database, Transaction } from "@/db/client-factory";
import { invoices, jobWcrs, payments, studies, studyReports, type Job } from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { lockJob, setStatus } from "@/domain/jobs/job-service";
import { JOB_STATUS_LABELS, type JobStatus } from "@/domain/jobs/types";
import { revLabel } from "@/domain/reports/types";
import { recordAudit } from "@/lib/audit";
import { move } from "@/lib/state-machine";

import { BillingError } from "./errors";
import {
  INVOICE_FLOW,
  INVOICE_NUMBER,
  PAYMENT_MODES,
  balanceOf,
  financialYear,
  paise,
  rupees,
  type InvoiceStatus,
} from "./types";

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });
const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const inr = (p: number) =>
  `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Job statuses that follow the money. */
const MONEY: readonly JobStatus[] = ["wcr_signed", "invoiced", "paid"];

/**
 * Moves the job to match its invoices: Invoiced while any is open, Paid when
 * every live invoice is cleared, back to WCR signed when none is left.
 */
async function syncJobMoney(tx: Transaction, actor: SessionUser, job: Job, request?: RequestInfo) {
  const from = job.status as JobStatus;
  if (!MONEY.includes(from)) return;
  const to = await moneyStatus(tx, job.id);
  if (to && to !== from) {
    const why =
      to === "paid"
        ? "Every invoice cleared"
        : to === "invoiced"
          ? "Invoice recorded or reopened"
          : "No live invoice";
    await setStatus(tx, actor, job, to, why, request);
  }
}

/**
 * Where the money puts a job whose WCR is signed: WCR signed with no live
 * invoice, Invoiced while any is open, Paid when all are cleared. Null while
 * the WCR isn't signed.
 */
export async function moneyStatus(
  tx: Transaction | Database,
  jobId: string,
): Promise<"wcr_signed" | "invoiced" | "paid" | null> {
  if (!(await wcrSigned(tx, jobId))) return null;
  const live = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "cancelled")));
  if (live.length === 0) return "wcr_signed";
  return live.every((i) => i.status === "cleared") ? "paid" : "invoiced";
}

async function wcrSigned(tx: Transaction | Database, jobId: string) {
  const [w] = await tx
    .select({ status: jobWcrs.status })
    .from(jobWcrs)
    .where(and(eq(jobWcrs.jobId, jobId), ne(jobWcrs.status, "void")));
  return w?.status === "signed";
}

// ---------------------------------------------------------------- invoices

const amount = (what: string) =>
  z.coerce
    .number({ message: `Enter the ${what}.` })
    .finite()
    .min(0, `The ${what} can't be negative.`)
    .max(99_99_99_999, `The ${what} is too large.`);

const invoiceSchema = z.object({
  number: z
    .string()
    .trim()
    .regex(INVOICE_NUMBER, "Invoice numbers are up to 16 letters, digits, - or / (GST Rule 46)."),
  invoiceDate: z.string().regex(ISO, "Enter the invoice date."),
  taxable: amount("taxable value").refine((v) => v > 0, "Enter the taxable value."),
  gst: amount("GST"),
  note: z.string().trim().max(1000).default(""),
});

/**
 * Records a GST invoice raised in Tally. Allowed once the WCR is signed; the
 * number must be new in its financial year; total = taxable + GST.
 */
export async function recordInvoice(
  db: Database,
  actor: SessionUser,
  jobId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "billing.record");
  const v = invoiceSchema.parse(input);
  if (!isUuid(jobId)) throw new BillingError("That job does not exist.");
  if (v.invoiceDate > todayIst()) throw new BillingError("The invoice date is in the future.");
  const taxableP = paise(v.taxable);
  const gstP = paise(v.gst);
  const fy = financialYear(v.invoiceDate);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    if (["cancelled", "closed"].includes(job.status)) {
      throw new BillingError(
        `Job ${job.number} is ${JOB_STATUS_LABELS[job.status as JobStatus].toLowerCase()}.`,
      );
    }
    if (!(await wcrSigned(tx, job.id))) {
      throw new BillingError(
        `Job ${job.number}'s WCR isn't signed yet. Invoice once the client signs it.`,
      );
    }
    const [dup] = await tx
      .select({ jobId: invoices.jobId })
      .from(invoices)
      .where(
        and(
          eq(invoices.organisationId, actor.organisationId),
          eq(invoices.financialYear, fy),
          sql`upper(${invoices.number}) = upper(${v.number})`,
          ne(invoices.status, "cancelled"),
        ),
      );
    if (dup) throw new BillingError(`Invoice ${v.number} is already recorded for ${fy}.`);
    const [inv] = await tx
      .insert(invoices)
      .values({
        organisationId: actor.organisationId,
        jobId: job.id,
        number: v.number,
        financialYear: fy,
        invoiceDate: v.invoiceDate,
        taxable: rupees(taxableP).toFixed(2),
        gst: rupees(gstP).toFixed(2),
        total: rupees(taxableP + gstP).toFixed(2),
        note: v.note,
        createdByUserId: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "invoice.recorded",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} recorded invoice ${v.number} of ${v.invoiceDate} for ${job.number}: ${inr(taxableP + gstP)} (${inr(taxableP)} + GST ${inr(gstP)})`,
      after: { invoiceId: inv!.id, ...v, total: rupees(taxableP + gstP) },
      request,
    });
    await syncJobMoney(tx, actor, job, request);
    return { id: inv!.id };
  });
}

async function lockInvoice(tx: Transaction, actor: SessionUser, invoiceId: string) {
  if (!isUuid(invoiceId)) throw new BillingError("That invoice does not exist.");
  const [i0] = await tx
    .select({ jobId: invoices.jobId })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organisationId, actor.organisationId)));
  if (!i0) throw new BillingError("That invoice does not exist.");
  const job = await lockJob(tx, actor, i0.jobId);
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  const paid = await tx.select().from(payments).where(eq(payments.invoiceId, invoiceId));
  const balance = balanceOf(
    paise(inv!.total),
    paid.map((p) => ({
      receivedPaise: paise(p.received),
      tdsPaise: paise(p.tds),
      writtenOffPaise: paise(p.writtenOff),
    })),
  );
  return { inv: inv!, job, paid, balance };
}

/** A wrong entry is cancelled with a reason; only an invoice with nothing paid against it. */
export async function cancelInvoice(
  db: Database,
  actor: SessionUser,
  invoiceId: string,
  reason: string,
  request?: RequestInfo,
) {
  assertCan(actor, "billing.record");
  const why = z.string().trim().min(5, "Say why it is cancelled.").max(500).parse(reason);
  return db.transaction(async (tx) => {
    const { inv, job, balance } = await lockInvoice(tx, actor, invoiceId);
    if (inv.status === "cancelled")
      throw new BillingError(`Invoice ${inv.number} is already cancelled.`);
    if (job.status === "closed")
      throw new BillingError(`Job ${job.number} is closed. Reopen it first.`);
    if (balance !== paise(inv.total)) {
      throw new BillingError(
        `Payments are recorded against invoice ${inv.number}. Reverse them first, or raise a credit note in Tally.`,
      );
    }
    await tx
      .update(invoices)
      .set({
        status: move(INVOICE_FLOW, inv.status as InvoiceStatus, "cancelled"),
        cancelReason: why,
      })
      .where(eq(invoices.id, inv.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "invoice.cancelled",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} cancelled invoice ${inv.number} (${job.number})`,
      reason: why,
      request,
    });
    await syncJobMoney(tx, actor, job, request);
  });
}

// ---------------------------------------------------------------- payments

const paymentSchema = z
  .object({
    paidOn: z.string().regex(ISO, "Enter the date the money arrived."),
    received: amount("amount received").default(0),
    tds: amount("TDS").default(0),
    writtenOff: amount("write-off").default(0),
    mode: z.enum(PAYMENT_MODES, { message: "Choose how it was paid." }),
    reference: z.string().trim().max(60).default(""),
    note: z.string().trim().max(1000).default(""),
  })
  .refine((v) => v.received + v.tds + v.writtenOff > 0, {
    message: "Enter the amount received, the TDS, or both.",
    path: ["received"],
  })
  .refine((v) => v.mode === "cash" || v.received === 0 || v.reference.length >= 4, {
    message: "Enter the UTR or cheque number.",
    path: ["reference"],
  })
  .refine((v) => v.writtenOff === 0 || v.note.length >= 5, {
    message: "Say why the rest is written off.",
    path: ["note"],
  });

/**
 * Records money against an invoice: received plus TDS (and a small write-off
 * with a reason) clear it. Nothing beyond the balance is accepted. Clearing
 * the last open invoice moves the job to Paid.
 */
export async function recordPayment(
  db: Database,
  actor: SessionUser,
  invoiceId: string,
  input: unknown,
  request?: RequestInfo,
) {
  assertCan(actor, "billing.record");
  const v = paymentSchema.parse(input);
  if (v.paidOn > todayIst()) throw new BillingError("The payment date is in the future.");
  const p = { received: paise(v.received), tds: paise(v.tds), writtenOff: paise(v.writtenOff) };
  return db.transaction(async (tx) => {
    const { inv, job, balance } = await lockInvoice(tx, actor, invoiceId);
    if (inv.status !== "open") throw new BillingError(`Invoice ${inv.number} is ${inv.status}.`);
    if (v.paidOn < inv.invoiceDate) {
      throw new BillingError(
        `The payment is dated before invoice ${inv.number} (${inv.invoiceDate}).`,
      );
    }
    const sum = p.received + p.tds + p.writtenOff;
    if (sum > balance) {
      throw new BillingError(
        `That is ${inr(sum)}, but only ${inr(balance)} is left on invoice ${inv.number}.`,
      );
    }
    if (p.writtenOff > 0 && p.writtenOff > Math.max(100_00, Math.round(paise(inv.total) * 0.01))) {
      throw new BillingError(
        "A write-off is for the last few rupees: at most ₹100 or 1% of the invoice.",
      );
    }
    // A UTR or cheque number is one transfer: the same one twice on an invoice is
    // a double entry (one transfer can still pay several invoices).
    const ref = v.reference.trim();
    if (ref) {
      const [twice] = await tx
        .select({
          paidOn: payments.paidOn,
          received: payments.received,
          reference: payments.reference,
        })
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, inv.id),
            sql`lower(trim(${payments.reference})) = ${ref.toLowerCase()}`,
            sql`${payments.reversesId} is null`,
            sql`not exists (select 1 from ${payments} r where r.reverses_id = ${payments.id})`,
          ),
        )
        .limit(1);
      if (twice) {
        throw new BillingError(
          `${twice.reference} is already recorded on invoice ${inv.number} (${inr(paise(twice.received))} on ${twice.paidOn.split("-").reverse().join(".")}). If that entry was wrong, reverse it first.`,
        );
      }
    }
    const [pay] = await tx
      .insert(payments)
      .values({
        organisationId: actor.organisationId,
        invoiceId: inv.id,
        paidOn: v.paidOn,
        received: rupees(p.received).toFixed(2),
        tds: rupees(p.tds).toFixed(2),
        writtenOff: rupees(p.writtenOff).toFixed(2),
        mode: v.mode,
        reference: v.reference,
        note: v.note,
        createdByUserId: actor.id,
      })
      .returning();
    const left = balance - sum;
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "payment.recorded",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} recorded ${inr(p.received)} received${p.tds ? ` + TDS ${inr(p.tds)}` : ""}${p.writtenOff ? ` + ${inr(p.writtenOff)} written off` : ""} against invoice ${inv.number} (${job.number}); ${left === 0 ? "cleared" : `${inr(left)} left`}`,
      after: { paymentId: pay!.id, ...v },
      request,
    });
    if (left === 0) {
      await tx
        .update(invoices)
        .set({
          status: move(INVOICE_FLOW, inv.status as InvoiceStatus, "cleared"),
          clearedAt: new Date(),
        })
        .where(eq(invoices.id, inv.id));
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "invoice.cleared",
        entityType: "job",
        entityId: job.id,
        summary: `Invoice ${inv.number} (${job.number}) cleared`,
        request,
      });
      await syncJobMoney(tx, actor, job, request);
    }
    return { id: pay!.id, left: rupees(left) };
  });
}

/** A wrong payment entry is reversed (a negative entry pointing at it), never edited. */
export async function reversePayment(
  db: Database,
  actor: SessionUser,
  paymentId: string,
  reason: string,
  request?: RequestInfo,
) {
  assertCan(actor, "billing.record");
  const why = z.string().trim().min(5, "Say why it is reversed.").max(500).parse(reason);
  if (!isUuid(paymentId)) throw new BillingError("That payment does not exist.");
  return db.transaction(async (tx) => {
    const [p0] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.organisationId, actor.organisationId)));
    if (!p0) throw new BillingError("That payment does not exist.");
    if (p0.reversesId) throw new BillingError("That entry is itself a reversal.");
    const { inv, job } = await lockInvoice(tx, actor, p0.invoiceId);
    if (job.status === "closed")
      throw new BillingError(`Job ${job.number} is closed. Reopen it first.`);
    const [already] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reversesId, p0.id));
    if (already) throw new BillingError("That payment was already reversed.");
    const neg = (v: string) => (-Number(v)).toFixed(2);
    await tx.insert(payments).values({
      organisationId: actor.organisationId,
      invoiceId: inv.id,
      paidOn: todayIst(),
      received: neg(p0.received),
      tds: neg(p0.tds),
      writtenOff: neg(p0.writtenOff),
      mode: p0.mode,
      reference: p0.reference,
      note: why,
      reversesId: p0.id,
      createdByUserId: actor.id,
    });
    if (inv.status === "cleared") {
      await tx
        .update(invoices)
        .set({ status: move(INVOICE_FLOW, inv.status as InvoiceStatus, "open"), clearedAt: null })
        .where(eq(invoices.id, inv.id));
    }
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "payment.reversed",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} reversed a payment of ${inr(paise(p0.received))} on invoice ${inv.number} (${job.number})`,
      reason: why,
      before: { paymentId: p0.id },
      request,
    });
    await syncJobMoney(tx, actor, job, request);
  });
}

// ---------------------------------------------------------------- closing

/** What still stands between the job and closing, in words. */
export async function closeBlockers(db: Database | Transaction, job: Job): Promise<string[]> {
  const out: string[] = [];
  // Three independent reads: together on the pool, in turn inside a transaction.
  const [signed, rows, live] = await reads(db, [
    () => wcrSigned(db, job.id),
    () =>
      db
        .select({
          code: studies.reportNumber,
          id: studies.id,
          rev: studyReports.rev,
          status: studyReports.status,
        })
        .from(studies)
        .leftJoin(studyReports, eq(studyReports.studyId, studies.id))
        .where(eq(studies.jobId, job.id))
        .orderBy(desc(studyReports.rev)),
    () =>
      db
        .select({ number: invoices.number, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.jobId, job.id), ne(invoices.status, "cancelled"))),
  ]);
  if (!signed) out.push("The WCR isn't signed.");
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.status !== "signed") {
      out.push(
        `${r.code}${r.rev !== null ? ` ${revLabel(r.rev)}` : ""} isn't signed by the client.`,
      );
    }
  }
  if (live.length === 0) out.push("No invoice is recorded.");
  for (const i of live.filter((x) => x.status !== "cleared")) {
    out.push(`Invoice ${i.number} isn't fully paid.`);
  }
  return out;
}

/** Closes a paid job whose WCR and every report are signed; it moves to History. */
export async function closeJob(
  db: Database,
  actor: SessionUser,
  jobId: string,
  request?: RequestInfo,
) {
  assertCan(actor, "jobs.close");
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    if (job.status === "closed") throw new BillingError(`Job ${job.number} is already closed.`);
    const out = await closeBlockers(tx, job);
    if (job.status !== "paid" && out.length === 0) out.push("The job isn't marked Paid.");
    if (out.length) throw new BillingError(`Job ${job.number} can't close yet: ${out.join(" ")}`);
    await setStatus(tx, actor, job, "closed", "Paid, WCR and every report signed", request);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.closed",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} closed ${job.number}`,
      request,
    });
  });
}

/** Reopens a closed job, with a reason; it goes back to Paid. */
export async function reopenJob(
  db: Database,
  actor: SessionUser,
  jobId: string,
  reason: string,
  request?: RequestInfo,
) {
  assertCan(actor, "jobs.close");
  const why = z.string().trim().min(5, "Say why it is reopened.").max(500).parse(reason);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, actor, jobId);
    if (job.status !== "closed") throw new BillingError(`Job ${job.number} isn't closed.`);
    await setStatus(tx, actor, job, "paid", why, request);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "job.reopened",
      entityType: "job",
      entityId: job.id,
      summary: `${actor.name} reopened ${job.number}`,
      reason: why,
      request,
    });
  });
}
