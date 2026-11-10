import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { users } from "@/db/schema";
import { can } from "@/domain/auth/permissions";
import { toSessionUser } from "@/domain/auth/session-service";
import { billingOverview } from "@/domain/billing/queries";
import type { EmailSender } from "@/lib/mail/mailer";

import { sendDigests, sendPending } from "./notify";
import { sendReminders } from "./reminders";

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/**
 * The daily run: the reminders (order pending, invoice pending, contract
 * ending), alert emails still waiting, then one digest per person. Accounts
 * and managers also get the overdue invoices and invoices due.
 */
export async function dailyDigest(db: Database, sender: EmailSender, appUrl: string) {
  const reminders = await sendReminders(db);
  const pending = await sendPending(db, sender, appUrl, 500);
  const digests = await sendDigests(db, sender, appUrl, async (u) => {
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    const actor = row ? toSessionUser(row) : null;
    if (!actor || !can(actor, "jobs.money")) return [];
    const o = await billingOverview(db, actor);
    const out: string[] = [];
    if (o.totals.overdueCount) {
      out.push(
        `${o.totals.overdueCount} invoice${o.totals.overdueCount === 1 ? "" : "s"} overdue: ${inr(o.totals.overdue)} (${appUrl}/billing)`,
      );
      for (const v of o.open.filter((x) => x.overdueDays > 0).slice(0, 5)) {
        out.push(`  ${v.number}, ${v.company}: ${inr(v.balance)}, ${v.overdueDays} days overdue`);
      }
    }
    if (o.invoiceDue.length) {
      out.push(
        `${o.invoiceDue.length} job${o.invoiceDue.length === 1 ? "" : "s"} to invoice (WCR signed).`,
      );
    }
    return out;
  });
  return { reminders, pending, digests, emailConfigured: sender.configured };
}
