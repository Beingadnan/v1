import "server-only";

import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import {
  capas,
  clientCompanies,
  deviations,
  equipment,
  jobs,
  studies,
  studyEvents,
  studyReports,
} from "@/db/schema";
import { can } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";
import { billingOverview } from "@/domain/billing/queries";
import { myStudies } from "@/domain/field/queries";
import { orderPendingSql } from "@/domain/jobs/queries";
import { expirySummary } from "@/domain/instruments/queries";
import { BOARD_COLUMNS, boardStatus, type JobStatus } from "@/domain/jobs/types";
import { unreadCount } from "@/domain/notifications/notify";

export type Tile = {
  key: string;
  label: string;
  count: number;
  /** One line of detail, e.g. an amount or the oldest item. */
  hint?: string;
  href: string;
  tone: "neutral" | "attention" | "fail" | "pass";
};

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Data overdue: field work ended this long ago and the data still isn't confirmed. */
export const DATA_OVERDUE_DAYS = 2;
/** Unsigned: a report with the client this long. */
export const UNSIGNED_DAYS = 7;
/** A client's order still missing this long after the job was made is late. */
export const ORDER_PENDING_DAYS = 14;
/** Requalifications due within this many days are worth a quote now. */
export const REQUAL_DAYS = 60;

/**
 * The home page: what waits on this person, as tiles with a count and a
 * link, by what their role can act on. A manager sees every tile; together
 * they are the Monday review.
 */
export async function homeFor(db: Database, actor: SessionUser) {
  const org = actor.organisationId;
  const tiles: Tile[] = [];
  const add = (t: Tile) => tiles.push(t);
  const manager = can(actor, "jobs.manage");
  const deviationsToo = can(actor, "deviation.manage");
  const nextDue = sql<string>`(${equipment.lastStudyOn} + make_interval(months => coalesce(${equipment.requalificationMonths}, ${clientCompanies.requalificationMonths})) - interval '1 day')::date`;
  const skip = Promise.resolve(null);
  // Every tile's read goes out at once: on a distant database each round trip costs ~250 ms,
  // so one after another they took seconds. The tiles are then added in their usual order.
  const [
    unread,
    mineRows,
    latest,
    lateRows,
    billing,
    expiry,
    openDeviations,
    capaRows,
    requalRows,
    boardRows,
    orderRows,
  ] = await Promise.all([
    unreadCount(db, actor),
    can(actor, "data.import") ? myStudies(db, actor) : skip,
    can(actor, "jobs.view")
      ? db
          .select({
            status: studyReports.status,
            releasedAt: studyReports.releasedAt,
            createdBy: studyReports.createdByUserId,
            frozenBy: studyReports.frozenByUserId,
          })
          .from(studyReports)
          .innerJoin(studies, eq(studies.id, studyReports.studyId))
          .innerJoin(jobs, eq(jobs.id, studies.jobId))
          .where(
            and(
              eq(studyReports.organisationId, org),
              ne(studyReports.status, "superseded"),
              ne(jobs.status, "cancelled"),
            ),
          )
      : Promise.resolve([]),
    manager
      ? db
          .select({ id: studies.id })
          .from(studies)
          .innerJoin(jobs, eq(jobs.id, studies.jobId))
          .where(
            and(
              eq(studies.organisationId, org),
              ne(studies.dataStatus, "received"),
              inArray(jobs.status, ["field_work", "data_issue"]),
              sql`exists (select 1 from ${studyEvents} e where e.study_id = ${studies.id} and e.kind = 'end' and not e.voided and e.at < ${daysAgo(DATA_OVERDUE_DAYS)})`,
            ),
          )
      : skip,
    can(actor, "jobs.money") ? billingOverview(db, actor) : skip,
    can(actor, "instruments.view") && (manager || can(actor, "instruments.manage"))
      ? expirySummary(db, actor)
      : skip,
    deviationsToo
      ? db
          .select({ assessed: deviations.assessment })
          .from(deviations)
          .innerJoin(studies, eq(studies.id, deviations.studyId))
          .innerJoin(jobs, eq(jobs.id, studies.jobId))
          .where(
            and(
              eq(deviations.organisationId, org),
              isNull(deviations.closedAt),
              ne(jobs.status, "cancelled"),
            ),
          )
      : skip,
    deviationsToo
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(capas)
          .where(
            and(
              eq(capas.organisationId, org),
              eq(capas.status, "open"),
              lt(capas.dueOn, todayIst()),
            ),
          )
      : skip,
    manager && can(actor, "clients.view")
      ? db
          .select({
            due: sql<number>`count(*) filter (where ${nextDue} >= current_date)::int`,
            overdue: sql<number>`count(*) filter (where ${nextDue} < current_date)::int`,
          })
          .from(equipment)
          .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
          .where(
            and(
              eq(equipment.organisationId, org),
              eq(equipment.active, true),
              sql`${equipment.lastStudyOn} is not null`,
              sql`${nextDue} <= current_date + ${REQUAL_DAYS}::int`,
            ),
          )
      : skip,
    can(actor, "jobs.view")
      ? db
          .select({ status: jobs.status, heldFrom: jobs.heldFrom })
          .from(jobs)
          .where(
            and(eq(jobs.organisationId, org), sql`${jobs.status} not in ('closed', 'cancelled')`),
          )
      : skip,
    // Jobs whose client's order (PO, SRF, ARC or AMC) hasn't come.
    manager || can(actor, "billing.record")
      ? db
          .select({ number: jobs.number, createdAt: jobs.createdAt })
          .from(jobs)
          .where(
            and(
              eq(jobs.organisationId, org),
              orderPendingSql,
              sql`${jobs.status} not in ('closed', 'cancelled')`,
            ),
          )
          .orderBy(jobs.createdAt)
      : skip,
  ]);

  // ---- field and data
  if (can(actor, "data.import")) {
    const mine = mineRows!;
    const today = mine.filter((s) => s.today && s.status !== "completed");
    const data = mine.filter(
      (s) => s.request !== null || (s.status === "completed" && s.dataStatus !== "received"),
    );
    const post = mine.filter((s) => s.postCalLeft > 0);
    add({
      key: "today",
      label: "On site today",
      count: today.length,
      href: "/studies",
      tone: today.length ? "attention" : "neutral",
    });
    add({
      key: "data",
      label: "Data to send or check",
      count: data.length,
      href: "/studies",
      tone: data.length ? "attention" : "neutral",
    });
    if (can(actor, "postcal.record")) {
      add({
        key: "postcal",
        label: "Post-calibration to do",
        count: post.length,
        href: "/studies",
        tone: post.length ? "attention" : "neutral",
      });
    }
    if (can(actor, "analysis.run")) {
      const analyse = mine.filter((s) => s.toAnalyse);
      add({
        key: "analyse",
        label: "To analyse",
        count: analyse.length,
        href: "/studies",
        tone: analyse.length ? "attention" : "neutral",
      });
    }
  }

  // ---- reports (latest revision of each study, cancelled jobs left out)
  const count = (statuses: string[]) => latest.filter((r) => statuses.includes(r.status)).length;
  if (can(actor, "reports.prepare")) {
    const drafts = latest.filter((r) => r.status === "draft" || r.status === "returned").length;
    add({
      key: "drafts",
      label: "Reports to draft or answer",
      count: drafts,
      href: "/reports",
      tone: drafts ? "attention" : "neutral",
    });
  }
  if (can(actor, "reports.check")) {
    const toCheck = latest.filter((r) => r.status === "checking" && r.frozenBy !== actor.id).length;
    add({
      key: "check",
      label: "Reports to check",
      count: toCheck,
      href: "/reviews",
      tone: toCheck ? "attention" : "neutral",
    });
    add({
      key: "release",
      label: "Checked, to release",
      count: count(["checked"]),
      href: "/reviews",
      tone: count(["checked"]) ? "attention" : "neutral",
    });
  }

  // ---- the manager's review
  if (manager) {
    const late = lateRows!;
    add({
      key: "data_overdue",
      label: "Data overdue",
      count: late.length,
      hint: `Field work ended over ${DATA_OVERDUE_DAYS} days ago`,
      href: "/studies?all=1",
      tone: late.length ? "fail" : "neutral",
    });
    const unsigned = latest.filter(
      (r) =>
        (r.status === "released" || r.status === "reviewed") &&
        r.releasedAt !== null &&
        r.releasedAt < daysAgo(UNSIGNED_DAYS),
    ).length;
    add({
      key: "unsigned",
      label: "Reports unsigned by clients",
      count: unsigned,
      hint: `With the client over ${UNSIGNED_DAYS} days (${count(["released", "reviewed"])} in all)`,
      href: "/reports",
      tone: unsigned ? "attention" : "neutral",
    });
  }

  if (orderRows) {
    const oldest = orderRows[0];
    const days = oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 86_400_000) : 0;
    add({
      key: "order_pending",
      label: "Client's order pending",
      count: orderRows.length,
      hint: oldest ? `Oldest ${oldest.number}, ${days} days` : undefined,
      href: "/jobs?order=pending",
      tone: orderRows.length ? (days > ORDER_PENDING_DAYS ? "fail" : "attention") : "neutral",
    });
  }

  if (can(actor, "jobs.money")) {
    const o = billing!;
    add({
      key: "invoice_due",
      label: "Invoice due",
      count: o.invoiceDue.length,
      hint: o.invoiceDue.length ? `Oldest WCR signed ${o.invoiceDue[0]!.days} days ago` : undefined,
      href: "/billing",
      tone: o.invoiceDue.some((x) => x.days > 25)
        ? "fail"
        : o.invoiceDue.length
          ? "attention"
          : "neutral",
    });
    add({
      key: "overdue",
      label: "Invoices overdue",
      count: o.totals.overdueCount,
      hint: `${inr(o.totals.overdue)} overdue of ${inr(o.totals.outstanding)} outstanding`,
      href: "/billing",
      tone: o.totals.overdueCount ? "fail" : "neutral",
    });
  }

  if (can(actor, "instruments.view") && (manager || can(actor, "instruments.manage"))) {
    const e = expiry!;
    const soon = e.counts.due_7 + e.counts.due_15 + e.counts.due_30;
    add({
      key: "instruments",
      label: "Instruments expiring in 30 days",
      count: soon,
      hint: `${e.counts.expired} expired${e.masters.length ? `, ${e.masters.length} masters need attention` : ""}`,
      href: "/instruments",
      tone: e.counts.expired || e.counts.due_7 ? "fail" : soon ? "attention" : "neutral",
    });
  }

  if (can(actor, "deviation.manage")) {
    const open = openDeviations!;
    const waiting = open.filter((d) => d.assessed !== "").length;
    add({
      key: "deviations",
      label: "Open deviations",
      count: open.length,
      hint: `${waiting} waiting for the client's decision, ${open.length - waiting} to assess`,
      href: "/deviations",
      tone: open.length ? "attention" : "neutral",
    });
    const [late] = capaRows!;
    add({
      key: "capa",
      label: "CAPAs overdue",
      count: late?.n ?? 0,
      href: "/deviations",
      tone: late?.n ? "fail" : "neutral",
    });
  }

  if (manager && can(actor, "clients.view")) {
    const [r] = requalRows!;
    add({
      key: "requal",
      label: `Requalifications due in ${REQUAL_DAYS} days`,
      count: r?.due ?? 0,
      hint: `${r?.overdue ?? 0} already past due`,
      href: "/clients",
      tone: r?.overdue ? "fail" : r?.due ? "attention" : "neutral",
    });
  }

  // ---- the board
  const board = boardRows
    ? BOARD_COLUMNS.map((c) => ({
        key: c.key,
        label: c.label,
        count: boardRows.filter((r) =>
          c.statuses.includes(boardStatus(r.status as JobStatus, r.heldFrom)),
        ).length,
      }))
    : [];

  return { tiles, board, unread };
}

export type Home = Awaited<ReturnType<typeof homeFor>>;
