import "server-only";

import { and, count, eq, gte, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { auditLog, gstinLookups } from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { recordAudit } from "@/lib/audit";

import {
  fetchGstinDetails,
  suggestShortName,
  type GstDetails,
  type GstLookupConfig,
  type GstLookupResult,
} from "./gst-lookup";

/** Re-use a lookup for this long before paying for a fresh one. */
export const GST_CACHE_DAYS = 30;
/** Per person per hour; a typo loop can't run up the bill. */
export const GST_LOOKUPS_PER_HOUR = 30;

export type GstFill = GstDetails & { shortName: string; fromCache: boolean };

/**
 * Details for a GSTIN, to fill the client and site forms.
 * Cached per organisation; every paid lookup is audited.
 */
export async function lookupGstin(
  db: Database,
  actor: SessionUser,
  rawGstin: string,
  config: GstLookupConfig | null,
  request: RequestInfo,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; fill: GstFill } | Extract<GstLookupResult, { ok: false }>> {
  assertCan(actor, "clients.manage");
  if (!config) {
    return { ok: false, reason: "setup", message: "GST lookup is not switched on." };
  }
  const gstin = String(rawGstin).trim().toUpperCase().slice(0, 15);

  const [cached] = await db
    .select()
    .from(gstinLookups)
    .where(
      and(
        eq(gstinLookups.organisationId, actor.organisationId),
        eq(gstinLookups.gstin, gstin),
        gte(gstinLookups.fetchedAt, sql`now() - make_interval(days => ${GST_CACHE_DAYS})`),
      ),
    );
  if (cached) {
    const details = cached.details as GstDetails;
    return {
      ok: true,
      fill: { ...details, shortName: suggestShortName(details), fromCache: true },
    };
  }

  const [recent] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.organisationId, actor.organisationId),
        eq(auditLog.actorUserId, actor.id),
        eq(auditLog.action, "gstin.looked_up"),
        gte(auditLog.occurredAt, sql`now() - interval '1 hour'`),
      ),
    );
  if ((recent?.n ?? 0) >= GST_LOOKUPS_PER_HOUR) {
    return {
      ok: false,
      reason: "busy",
      message: `You've looked up ${GST_LOOKUPS_PER_HOUR} GSTINs in the last hour. Try again later or type the details in.`,
    };
  }

  const result = await fetchGstinDetails(gstin, config, fetchImpl);
  // Only answers from the service are audited (and may be charged); local checks are not.
  if (result.ok || result.reason === "not_found") {
    await db.transaction(async (tx) => {
      if (result.ok) {
        await tx
          .insert(gstinLookups)
          .values({ organisationId: actor.organisationId, gstin, details: result.details })
          .onConflictDoUpdate({
            target: [gstinLookups.organisationId, gstinLookups.gstin],
            set: { details: result.details, fetchedAt: sql`now()` },
          });
      }
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: { type: "user", userId: actor.id },
        action: "gstin.looked_up",
        entityType: "gstin",
        entityId: gstin,
        summary: result.ok
          ? `${actor.name} looked up GSTIN ${gstin}: ${result.details.legalName} (${result.details.status || "status unknown"})`
          : `${actor.name} looked up GSTIN ${gstin}: not registered`,
        after: result.ok
          ? { legalName: result.details.legalName, status: result.details.status }
          : undefined,
        request,
      });
    });
  }
  if (!result.ok) return result;
  return {
    ok: true,
    fill: { ...result.details, shortName: suggestShortName(result.details), fromCache: false },
  };
}
