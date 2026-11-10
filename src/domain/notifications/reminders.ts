import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  clientCompanies,
  clientContracts,
  invoices,
  jobWcrs,
  jobs,
  notifications,
  organisations,
} from "@/db/schema";
import { orderPendingSql } from "@/domain/jobs/queries";
import { ORDER_TYPE_SHORT, type OrderType } from "@/domain/jobs/types";

import { byRole, notify } from "./notify";
import type { NotificationKind } from "./types";

/** First reminder this many days after the job was made, then every REPEAT_DAYS. */
export const ORDER_REMIND_AFTER_DAYS = 3;
/** First reminder this many days after the client signed the WCR. */
export const INVOICE_REMIND_AFTER_DAYS = 7;
export const REPEAT_DAYS = 7;
/** An ARC or AMC ending within this many days gets one reminder. */
export const CONTRACT_REMIND_DAYS = 30;

const DAY = 86_400_000;
const istDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const dmy = (iso: string) => iso.split("-").reverse().join(".");

/**
 * The daily reminders to managers and accounts (QA Tech, Nov 2026): a
 * client's order still pending, a signed WCR not yet invoiced, an ARC or
 * AMC about to end. Each goes to the bell (and email, as the person
 * chose); the first two repeat weekly until done, the last comes once.
 */
export async function sendReminders(db: Database, now = new Date()) {
  const counts = { order: 0, invoice: 0, contract: 0 };
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const { id: org } of orgs) {
    const to = await byRole(db, org, ["manager", "accounts"]);
    if (to.length === 0) continue;
    // Not again while one of the same kind for the same link is this recent.
    const sentSince = async (kind: NotificationKind, since: Date | null) => {
      const rows = await db
        .selectDistinct({ href: notifications.href })
        .from(notifications)
        .where(
          and(
            eq(notifications.organisationId, org),
            eq(notifications.kind, kind),
            since ? gte(notifications.createdAt, since) : undefined,
          ),
        );
      return new Set(rows.map((r) => r.href));
    };
    const send = async (kind: NotificationKind, title: string, body: string, href: string) => {
      await notify(db, { organisationId: org, to, kind, title, body, href });
    };

    // The client's order.
    const recentOrder = await sentSince(
      "order_pending",
      new Date(now.getTime() - REPEAT_DAYS * DAY),
    );
    const orderRows = await db
      .select({
        id: jobs.id,
        number: jobs.number,
        orderType: jobs.orderType,
        createdAt: jobs.createdAt,
        company: clientCompanies.name,
      })
      .from(jobs)
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .where(
        and(
          eq(jobs.organisationId, org),
          orderPendingSql,
          sql`${jobs.status} not in ('closed', 'cancelled')`,
          lte(jobs.createdAt, new Date(now.getTime() - ORDER_REMIND_AFTER_DAYS * DAY)),
        ),
      );
    for (const j of orderRows) {
      const href = `/jobs/${j.id}`;
      if (recentOrder.has(href)) continue;
      const short = ORDER_TYPE_SHORT[j.orderType as OrderType];
      const days = Math.floor((now.getTime() - j.createdAt.getTime()) / DAY);
      await send(
        "order_pending",
        `${short} pending: ${j.number}`,
        `${j.company}'s ${short} for job ${j.number} hasn't been recorded ${days} days after the job was made.`,
        href,
      );
      counts.order += 1;
    }

    // A signed WCR with no invoice.
    const recentInvoice = await sentSince(
      "invoice_pending",
      new Date(now.getTime() - REPEAT_DAYS * DAY),
    );
    const wcrRows = await db
      .select({
        jobId: jobs.id,
        number: jobs.number,
        company: clientCompanies.name,
        signedAt: jobWcrs.signedAt,
      })
      .from(jobWcrs)
      .innerJoin(jobs, eq(jobs.id, jobWcrs.jobId))
      .innerJoin(clientCompanies, eq(clientCompanies.id, jobs.companyId))
      .where(
        and(
          eq(jobWcrs.organisationId, org),
          eq(jobWcrs.status, "signed"),
          lte(jobWcrs.signedAt, new Date(now.getTime() - INVOICE_REMIND_AFTER_DAYS * DAY)),
          sql`${jobs.status} not in ('closed', 'cancelled')`,
          sql`not exists (select 1 from ${invoices} i where i.job_id = ${jobs.id} and i.status <> 'cancelled')`,
        ),
      );
    for (const w of wcrRows) {
      const href = `/jobs/${w.jobId}`;
      if (recentInvoice.has(href)) continue;
      const days = Math.floor((now.getTime() - w.signedAt!.getTime()) / DAY);
      await send(
        "invoice_pending",
        `Invoice pending: ${w.number}`,
        `${w.company} signed the WCR for job ${w.number} ${days} days ago; no invoice is recorded.`,
        href,
      );
      counts.invoice += 1;
    }

    // An ARC or AMC about to end: once.
    const contractsSent = await sentSince("contract_expiring", null);
    const today = istDate(now);
    const until = istDate(new Date(now.getTime() + CONTRACT_REMIND_DAYS * DAY));
    const ending = await db
      .select({
        id: clientContracts.id,
        companyId: clientContracts.companyId,
        kind: clientContracts.kind,
        number: clientContracts.number,
        validTo: clientContracts.validTo,
        company: clientCompanies.name,
      })
      .from(clientContracts)
      .innerJoin(clientCompanies, eq(clientCompanies.id, clientContracts.companyId))
      .where(
        and(
          eq(clientContracts.organisationId, org),
          gte(clientContracts.validTo, today),
          lte(clientContracts.validTo, until),
          inArray(clientContracts.kind, ["arc", "amc"]),
        ),
      );
    for (const c of ending) {
      const href = `/clients/${c.companyId}?contract=${c.id}`;
      if (contractsSent.has(href)) continue;
      const short = ORDER_TYPE_SHORT[c.kind as OrderType];
      await send(
        "contract_expiring",
        `${short} ending: ${c.company}`,
        `${c.company}'s ${short} ${c.number} ends on ${dmy(c.validTo)}. Ask for the renewal before the next job.`,
        href,
      );
      counts.contract += 1;
    }
  }
  return counts;
}
