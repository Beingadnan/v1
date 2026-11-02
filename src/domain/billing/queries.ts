import "server-only";

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  invoices,
  jobWcrs,
  jobs,
  organisationSettings,
  payments,
  signatures,
  studies,
  users,
  type Invoice,
  type Payment,
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
import { wcrBlockers } from "./wcr-service";

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
export async function jobMoney(db: Database, actor: SessionUser, jobId: string) {
  assertCan(actor, "jobs.view");
  if (!isUuid(jobId)) return null;
  const [row] = await db
    .select({ job: jobs, terms: clientCompanies.paymentTermsDays })
    .from(jobs)
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, actor.organisationId)));
  if (!row) return null;
  const { job } = row;
  const today = todayIst();
  const [w] = await db
    .select({ w: jobWcrs, issuedBy: users.name })
    .from(jobWcrs)
    .innerJoin(users, eq(users.id, jobWcrs.issuedByUserId))
    .where(and(eq(jobWcrs.jobId, job.id), ne(jobWcrs.status, "void")));
  const acceptedBy = w?.w.signatureId
    ? (
        await db
          .select({
            name: signatures.signerName,
            role: signatures.signerRole,
            at: signatures.signedAt,
          })
          .from(signatures)
          .where(eq(signatures.id, w.w.signatureId))
      )[0]
    : undefined;
  const money = can(actor, "jobs.money");
  const invs = money
    ? await db
        .select()
        .from(invoices)
        .where(eq(invoices.jobId, job.id))
        .orderBy(asc(invoices.createdAt))
    : [];
  const paid = invs.length
    ? await db
        .select()
        .from(payments)
        .where(
          inArray(
            payments.invoiceId,
            invs.map((i) => i.id),
          ),
        )
    : [];
  const views = invs.map((i) => invoiceView(i, paid, row.terms, today));
  const prices = await db
    .select({ price: studies.price })
    .from(studies)
    .where(eq(studies.jobId, job.id));
  const value = jobValue({
    studyPrices: prices.map((p) => (p.price === null ? null : Number(p.price))),
    quotedValue: job.quotedValue === null ? null : Number(job.quotedValue),
    poValue: job.poValue === null ? null : Number(job.poValue),
  });
  const invoicedTaxable = views
    .filter((v) => v.status !== "cancelled")
    .reduce((s, v) => s + paise(v.taxable), 0);
  const [last] = money
    ? await db
        .select({ number: invoices.number })
        .from(invoices)
        .where(eq(invoices.organisationId, actor.organisationId))
        .orderBy(desc(invoices.createdAt))
        .limit(1)
    : [];
  const remaining =
    value.expected !== null ? Math.max(0, paise(value.expected) - invoicedTaxable) : null;
  const status = job.status as JobStatus;
  const wcrSignedOn = w?.w.signedAt ? istDate(w.w.signedAt) : null;
  return {
    status,
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
    wcrBlockers:
      w || ["cancelled", "on_hold", "closed"].includes(status) ? [] : await wcrBlockers(db, job.id),
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
    closeBlockers:
      status === "closed" || status === "cancelled" ? [] : await closeBlockers(db, job),
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
  const live = await db
    .select({
      job: jobs,
      company: clientCompanies.name,
      terms: clientCompanies.paymentTermsDays,
    })
    .from(jobs)
    .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
    .where(
      and(
        eq(jobs.organisationId, actor.organisationId),
        inArray(jobs.status, [
          "sent_to_client",
          "client_signed",
          "wcr_signed",
          "invoiced",
          "paid",
          "rework",
        ]),
      ),
    )
    .orderBy(asc(jobs.number));
  const ids = live.map((r) => r.job.id);
  const wcrs = ids.length
    ? await db
        .select()
        .from(jobWcrs)
        .where(and(inArray(jobWcrs.jobId, ids), ne(jobWcrs.status, "void")))
    : [];
  const invs = ids.length
    ? await db
        .select()
        .from(invoices)
        .where(and(inArray(invoices.jobId, ids), ne(invoices.status, "cancelled")))
    : [];
  const paid = invs.length
    ? await db
        .select()
        .from(payments)
        .where(
          inArray(
            payments.invoiceId,
            invs.map((i) => i.id),
          ),
        )
    : [];
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
        can(actor, "wcr.issue") &&
        ["sent_to_client", "client_signed"].includes(r.job.status) &&
        (await wcrBlockers(db, r.job.id)).length === 0
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
  const [settings] = await db
    .select({ udyam: organisationSettings.udyamNumber })
    .from(organisationSettings)
    .where(eq(organisationSettings.organisationId, actor.organisationId));
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
