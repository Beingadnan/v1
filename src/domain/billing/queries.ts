import "server-only";

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import { ORDER_TYPE_SHORT, isContractType, type OrderType } from "@/domain/jobs/types";
import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  invoices,
  jobWcrs,
  jobs,
  organisationSettings,
  payments,
  signatures,
  users,
  type Invoice,
  type Payment,
  type Job,
} from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import { isClientRole } from "@/domain/auth/roles";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid } from "@/domain/clients/shared";
import { jobValue } from "@/domain/jobs/pricing";
import type { JobStatus } from "@/domain/jobs/types";

import { closeBlockers } from "./billing-service";
import {
  DEFAULT_GST_PCT,
  DEFAULT_TDS_PCT,
  INVOICE_WITHIN_DAYS,
  addDays,
  balanceOf,
  daysBetween,
  nextInvoiceNumber,
  paise,
  rupees,
  type PaymentMode,
} from "./types";
import { wcrBlockerCounts, wcrBlockers } from "./wcr-service";

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const istDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

function invoiceView(inv: Invoice, paid: Payment[], termsDays: number, today: string) {
  const mine = paid.filter((p) => p.invoiceId === inv.id);
  const bal = balanceOf(
    paise(inv.total),
    mine.map((p) => ({
      receivedPaise: paise(p.received),
      tdsPaise: paise(p.tds),
      writtenOffPaise: paise(p.writtenOff),
    })),
  );
  const due = addDays(inv.invoiceDate, termsDays);
  const open = inv.status === "open";
  return {
    id: inv.id,
    number: inv.number,
    financialYear: inv.financialYear,
    invoiceDate: inv.invoiceDate,
    taxable: Number(inv.taxable),
    gst: Number(inv.gst),
    total: Number(inv.total),
    status: inv.status as "open" | "cleared" | "cancelled",
    cancelReason: inv.cancelReason,
    note: inv.note,
    balance: rupees(bal),
    received: rupees(mine.reduce((s, p) => s + paise(p.received), 0)),
    tds: rupees(mine.reduce((s, p) => s + paise(p.tds), 0)),
    due,
    days: daysBetween(inv.invoiceDate, today),
    overdueDays: open && today > due ? daysBetween(due, today) : 0,
    /** Suggested TDS (s.194J, technical services) on what is left. */
    tdsHint: rupees(Math.round((paise(inv.taxable) * DEFAULT_TDS_PCT) / 100)),
    payments: mine
      .sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0))
      .map((p) => ({
        id: p.id,
        paidOn: p.paidOn,
        received: Number(p.received),
        tds: Number(p.tds),
        writtenOff: Number(p.writtenOff),
        mode: p.mode as PaymentMode,
        reference: p.reference,
        note: p.note,
        reversal: p.reversesId !== null,
        reversed: mine.some((x) => x.reversesId === p.id),
      })),
  };
}

export type InvoiceView = ReturnType<typeof invoiceView>;

/** Everything the job page's "Close and money" panel shows. */
export async function jobMoney(
  db: Database,
  actor: SessionUser,
  jobId: string,
  /** The job and its client's payment terms when the caller already read them (the job page). */
  loaded?: { job: Job; terms: number },
) {
  assertCan(actor, "jobs.view");
  if (!isUuid(jobId)) return null;
  const [row] = loaded
    ? loaded.job.id === jobId && loaded.job.organisationId === actor.organisationId
      ? [loaded]
      : []
    : await db
        .select({ job: jobs, terms: clientCompanies.paymentTermsDays })
        .from(jobs)
        .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
        .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, actor.organisationId)));
  if (!row) return null;
  const { job } = row;
  const today = todayIst();
  const money = can(actor, "jobs.money");
  const status = job.status as JobStatus;
  // The job is checked against the organisation above; the rest goes out in one round
  // (the client's signature by a join, the payments by a subquery of the job's invoices).
  const settled = ["cancelled", "on_hold", "closed"].includes(status);
  const [[w], invs, [last], closing, paid, blockers] = await Promise.all([
    db
      .select({
        w: jobWcrs,
        issuedBy: users.name,
        signer: {
          name: signatures.signerName,
          role: signatures.signerRole,
          at: signatures.signedAt,
        },
      })
      .from(jobWcrs)
      .innerJoin(users, eq(users.id, jobWcrs.issuedByUserId))
      .leftJoin(signatures, eq(signatures.id, jobWcrs.signatureId))
      .where(and(eq(jobWcrs.jobId, job.id), ne(jobWcrs.status, "void"))),
    money
      ? db
          .select()
          .from(invoices)
          .where(eq(invoices.jobId, job.id))
          .orderBy(asc(invoices.createdAt))
      : Promise.resolve([]),
    money
      ? db
          .select({ number: invoices.number })
          .from(invoices)
          .where(eq(invoices.organisationId, actor.organisationId))
          .orderBy(desc(invoices.createdAt))
          .limit(1)
      : Promise.resolve([]),
    status === "closed" || status === "cancelled" ? Promise.resolve([]) : closeBlockers(db, job),
    money
      ? db
          .select()
          .from(payments)
          .where(
            inArray(
              payments.invoiceId,
              db.select({ id: invoices.id }).from(invoices).where(eq(invoices.jobId, job.id)),
            ),
          )
      : Promise.resolve([]),
    // Only needed while no WCR is out; read alongside rather than after finding that out.
    settled ? Promise.resolve([]) : wcrBlockers(db, job.id),
  ]);
  const acceptedBy = w?.w.signatureId && w.signer?.name ? w.signer : undefined;
  const wcrOpen = w ? [] : blockers;
  const views = invs.map((i) => invoiceView(i, paid, row.terms, today));
  const value = jobValue({
    quotedValue: job.quotedValue === null ? null : Number(job.quotedValue),
    poValue: job.poValue === null ? null : Number(job.poValue),
  });
  const invoicedTaxable = views
    .filter((v) => v.status !== "cancelled")
    .reduce((s, v) => s + paise(v.taxable), 0);
  const remaining =
    value.expected !== null ? Math.max(0, paise(value.expected) - invoicedTaxable) : null;
  const wcrSignedOn = w?.w.signedAt ? istDate(w.w.signedAt) : null;
  // The client's order: an invoice can go out without it, but people should know.
  const short = ORDER_TYPE_SHORT[job.orderType as OrderType] ?? "PO";
  const orderMissing = isContractType(job.orderType)
    ? job.contractId
      ? null
      : `${short} pending: the client's ${short} isn't picked on the job yet.`
    : job.poNumber.trim()
      ? null
      : `${short} pending: the invoice will go out without the client's ${short} number.`;
  return {
    status,
    orderMissing,
    wcr: w
      ? {
          id: w.w.id,
          number: `WCR/${job.number}`,
          status: w.w.status as "issued" | "signed",
          issuedAt: w.w.issuedAt,
          issuedBy: w.issuedBy,
          sha256: w.w.sha256,
          signedVia: w.w.signedVia as "app" | "paper" | null,
          signedAt: w.w.signedAt,
          acceptedBy: acceptedBy ?? null,
          paper: w.w.paperSignedByName
            ? { by: w.w.paperSignedByName, on: w.w.paperSignedOn }
            : null,
        }
      : null,
    wcrBlockers: wcrOpen,
    invoices: views,
    expected: value.expected,
    /** Days since the WCR was signed, against Rule 47's 30. */
    daysSinceWcr: wcrSignedOn ? daysBetween(wcrSignedOn, today) : null,
    invoiceWithin: INVOICE_WITHIN_DAYS,
    suggest: {
      number: nextInvoiceNumber(last?.number ?? null),
      taxable: remaining === null ? null : rupees(remaining),
      gstPct: DEFAULT_GST_PCT,
      today,
    },
    closeBlockers: closing,
    can: {
      issueWcr: can(actor, "wcr.issue"),
      money,
      record: can(actor, "billing.record"),
      close: can(actor, "jobs.close"),
    },
  };
}

export type JobMoney = NonNullable<Awaited<ReturnType<typeof jobMoney>>>;

/**
 * The Billing page: WCRs to issue and to chase, invoices due (Rule 47's 30
 * days from the WCR), open invoices with what is left and how late, and
 * what cleared lately.
 */
export async function billingOverview(db: Database, actor: SessionUser) {
  assertCan(actor, "jobs.money");
  const today = todayIst();
  const LIVE = [
    "sent_to_client",
    "client_signed",
    "wcr_signed",
    "invoiced",
    "paid",
    "rework",
  ] as const;
  const issuing = can(actor, "wcr.issue");
  // Everything in one round: the WCRs, invoices, payments and WCR checks take the live
  // jobs as a subquery instead of waiting for their ids (ADR 0018).
  const liveIds = (statuses: readonly string[]) =>
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(eq(jobs.organisationId, actor.organisationId), inArray(jobs.status, [...statuses])),
      );
  const liveInvoices = and(
    inArray(invoices.jobId, liveIds(LIVE)),
    ne(invoices.status, "cancelled"),
  );
  const [live, [settings], wcrs, invs, paid, blockers] = await Promise.all([
    db
      .select({
        job: jobs,
        company: clientCompanies.name,
        terms: clientCompanies.paymentTermsDays,
      })
      .from(jobs)
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .where(and(eq(jobs.organisationId, actor.organisationId), inArray(jobs.status, [...LIVE])))
      .orderBy(asc(jobs.number)),
    db
      .select({ udyam: organisationSettings.udyamNumber })
      .from(organisationSettings)
      .where(eq(organisationSettings.organisationId, actor.organisationId)),
    db
      .select()
      .from(jobWcrs)
      .where(and(inArray(jobWcrs.jobId, liveIds(LIVE)), ne(jobWcrs.status, "void"))),
    db.select().from(invoices).where(liveInvoices),
    db
      .select()
      .from(payments)
      .where(
        inArray(
          payments.invoiceId,
          db.select({ id: invoices.id }).from(invoices).where(liveInvoices),
        ),
      ),
    // Only jobs that may need a WCR.
    issuing
      ? wcrBlockerCounts(db, liveIds(["sent_to_client", "client_signed"]))
      : Promise.resolve(new Map<string, number>()),
  ]);
  const wcrToIssue: { jobId: string; number: string; company: string }[] = [];
  const wcrWaiting: { jobId: string; number: string; company: string; days: number }[] = [];
  const invoiceDue: {
    jobId: string;
    number: string;
    company: string;
    wcrSignedOn: string;
    days: number;
  }[] = [];
  const open: (InvoiceView & { jobId: string; jobNumber: string; company: string })[] = [];
  const cleared: (InvoiceView & { jobId: string; jobNumber: string; company: string })[] = [];
  for (const r of live) {
    const w = wcrs.find((x) => x.jobId === r.job.id);
    const base = { jobId: r.job.id, number: r.job.number, company: r.company };
    if (!w) {
      if (
        issuing &&
        ["sent_to_client", "client_signed"].includes(r.job.status) &&
        blockers.get(r.job.id) === 0
      ) {
        wcrToIssue.push(base);
      }
      continue;
    }
    if (w.status === "issued") {
      wcrWaiting.push({ ...base, days: daysBetween(istDate(w.issuedAt), today) });
      continue;
    }
    const mine = invs.filter((i) => i.jobId === r.job.id);
    if (mine.length === 0) {
      const on = istDate(w.signedAt!);
      invoiceDue.push({ ...base, wcrSignedOn: on, days: daysBetween(on, today) });
    }
    for (const i of mine) {
      const v = {
        ...invoiceView(i, paid, r.terms, today),
        jobId: r.job.id,
        jobNumber: r.job.number,
        company: r.company,
      };
      if (v.status === "open") open.push(v);
      else if (
        v.status === "cleared" &&
        i.clearedAt &&
        daysBetween(istDate(i.clearedAt), today) <= 30
      )
        cleared.push(v);
    }
  }
  open.sort((a, b) => b.overdueDays - a.overdueDays || b.days - a.days);
  invoiceDue.sort((a, b) => b.days - a.days);
  return {
    wcrToIssue,
    wcrWaiting,
    invoiceDue,
    open,
    cleared,
    totals: {
      outstanding: open.reduce((s, v) => s + v.balance, 0),
      overdue: open.filter((v) => v.overdueDays > 0).reduce((s, v) => s + v.balance, 0),
      overdueCount: open.filter((v) => v.overdueDays > 0).length,
    },
    msme: Boolean(settings?.udyam),
    invoiceWithin: INVOICE_WITHIN_DAYS,
  };
}

/** WCRs waiting for the client QA head's acceptance, for the client's home. */
export async function clientWcrs(db: Database, actor: SessionUser) {
  if (!isClientRole(actor.role) || !actor.clientCompanyId) return [];
  const rows = await db
    .select({ w: jobWcrs, number: jobs.number })
    .from(jobWcrs)
    .innerJoin(jobs, eq(jobs.id, jobWcrs.jobId))
    .where(
      and(
        eq(jobWcrs.organisationId, actor.organisationId),
        eq(jobs.companyId, actor.clientCompanyId),
        ne(jobWcrs.status, "void"),
      ),
    )
    .orderBy(desc(jobWcrs.issuedAt))
    .limit(100);
  return rows.map(({ w, number }) => ({
    id: w.id,
    number: `WCR/${number}`,
    status: w.status as "issued" | "signed",
    issuedAt: w.issuedAt,
    signedAt: w.signedAt,
    canAccept: w.status === "issued" && can(actor, "wcr.accept"),
  }));
}
