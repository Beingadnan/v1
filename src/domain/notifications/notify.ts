import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { Database, Transaction } from "@/db/client-factory";
import { jobTeam, notifications, users } from "@/db/schema";
import type { SessionUser } from "@/domain/auth/session-service";
import type { EmailSender } from "@/lib/mail/mailer";

import { IMMEDIATE, type NotificationKind } from "./types";

type Exec = Database | Transaction;

/**
 * Hands something to people: one row each in their bell, written in the
 * caller's transaction so it can't be lost. The person who did it is left
 * out. Kinds in IMMEDIATE are emailed at once (when the person keeps email
 * on); the rest wait for the daily digest.
 */
export async function notify(
  tx: Exec,
  input: {
    organisationId: string;
    to: (string | null | undefined)[];
    except?: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    href: string;
  },
) {
  const ids = [...new Set(input.to.filter((x): x is string => Boolean(x)))].filter(
    (id) => id !== input.except,
  );
  if (ids.length === 0) return 0;
  const people = await tx
    .select({ id: users.id, emailAlerts: users.emailAlerts })
    .from(users)
    .where(
      and(
        inArray(users.id, ids),
        eq(users.organisationId, input.organisationId),
        eq(users.status, "active"),
      ),
    );
  if (people.length === 0) return 0;
  await tx.insert(notifications).values(
    people.map((p) => ({
      organisationId: input.organisationId,
      userId: p.id,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: (input.body ?? "").slice(0, 1000),
      href: input.href,
      emailStatus: IMMEDIATE.includes(input.kind) && p.emailAlerts ? "pending" : "none",
    })),
  );
  return people.length;
}

// ------------------------------------------------------------ recipients

/** Team leaders on the job, or every active manager when it has none. */
export async function jobLeads(tx: Exec, organisationId: string, jobId: string) {
  const leads = await tx
    .select({ id: jobTeam.userId })
    .from(jobTeam)
    .where(and(eq(jobTeam.jobId, jobId), eq(jobTeam.role, "team_leader")));
  if (leads.length) return leads.map((l) => l.id);
  return byRole(tx, organisationId, ["manager"]);
}

/** Active users with any of these roles. */
export async function byRole(tx: Exec, organisationId: string, roles: string[]) {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.status, "active"),
        inArray(users.role, roles),
      ),
    );
  return rows.map((r) => r.id);
}

/** A client company's active users, optionally only some roles. */
export async function clientPeople(tx: Exec, companyId: string, roles?: string[]) {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.clientCompanyId, companyId),
        eq(users.status, "active"),
        roles ? inArray(users.role, roles) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

// ------------------------------------------------------------- the bell

/** The person's latest notifications and how many are unread. */
export async function myNotifications(db: Database, actor: SessionUser, limit = 30) {
  const [rows, unread] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.id))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    unreadCount(db, actor),
  ]);
  return { rows, unread };
}

export async function unreadCount(db: Database, actor: SessionUser) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

/** Marks one (or all) of the person's notifications read; never someone else's. */
export async function markRead(db: Database, actor: SessionUser, id?: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, actor.id),
        isNull(notifications.readAt),
        id ? eq(notifications.id, id) : undefined,
      ),
    );
}

/** Turns the person's own email alerts and digest on or off. */
export async function setEmailAlerts(db: Database, actor: SessionUser, on: boolean) {
  await db.update(users).set({ emailAlerts: on }).where(eq(users.id, actor.id));
}

// -------------------------------------------------------------- delivery

const line = (n: { title: string; body: string; href: string }, appUrl: string) =>
  `- ${n.title}${n.body ? `\n  ${n.body}` : ""}\n  ${appUrl}${n.href}`;

/**
 * Sends the emails waiting to go (alerts marked for immediate email). Each is
 * claimed before sending, so two runs never send one twice. Without an email
 * provider they are marked skipped, and the bell still has them.
 */
export async function sendPending(db: Database, sender: EmailSender, appUrl: string, max = 50) {
  const pending = await db
    .select({ n: notifications, email: users.email })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.emailStatus, "pending"))
    .orderBy(asc(notifications.createdAt))
    .limit(max);
  let sent = 0;
  for (const { n, email } of pending) {
    const claimed = await db
      .update(notifications)
      .set({ emailStatus: "failed" })
      .where(and(eq(notifications.id, n.id), eq(notifications.emailStatus, "pending")))
      .returning({ id: notifications.id });
    if (!claimed.length) continue;
    const outcome = await sender.send({
      to: email,
      subject: n.title,
      text: `${line(n, appUrl)}\n\nQTech, QA Tech's calibration and validation system.\nTurn these emails off under Account in the app.`,
    });
    await db
      .update(notifications)
      .set({ emailStatus: outcome, emailedAt: outcome === "sent" ? new Date() : null })
      .where(eq(notifications.id, n.id));
    if (outcome === "sent") sent += 1;
  }
  return { tried: pending.length, sent };
}

/**
 * The daily digest: for each person with email on, their unread notifications
 * since their last digest (and anything not emailed), most recent first, at
 * most 20, plus extra lines from `extra` (overdue invoices for accounts and
 * managers). One email each; nothing is sent when there is nothing to say.
 */
export async function sendDigests(
  db: Database,
  sender: EmailSender,
  appUrl: string,
  extra: (user: { id: string; role: string; organisationId: string }) => Promise<string[]>,
  now = new Date(),
) {
  const people = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        eq(users.emailAlerts, true),
        or(
          isNull(users.digestSentAt),
          lt(users.digestSentAt, new Date(now.getTime() - 20 * 3600_000)),
        ),
      ),
    );
  let sent = 0;
  for (const u of people) {
    const items = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, u.id),
          isNull(notifications.readAt),
          u.digestSentAt ? gt(notifications.createdAt, u.digestSentAt) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(20);
    const more = await extra({ id: u.id, role: u.role, organisationId: u.organisationId });
    if (items.length === 0 && more.length === 0) continue;
    const text = [
      `Good morning ${u.name.split(/\s+/)[0] ?? u.name},`,
      "",
      ...(more.length ? [...more, ""] : []),
      ...(items.length
        ? ["Waiting for you in QTech:", ...items.map((n) => line(n, appUrl)), ""]
        : []),
      `${appUrl}/`,
      "",
      "Turn this daily email off under Account in the app.",
    ].join("\n");
    const outcome = await sender.send({
      to: u.email,
      subject: `QTech: ${items.length + more.length} thing${items.length + more.length === 1 ? "" : "s"} for today`,
      text,
    });
    if (outcome !== "failed") {
      await db.update(users).set({ digestSentAt: now }).where(eq(users.id, u.id));
    }
    if (outcome === "sent") sent += 1;
  }
  return { people: people.length, sent };
}
