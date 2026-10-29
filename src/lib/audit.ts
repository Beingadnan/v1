import "server-only";

import { z } from "zod";

import type { DbExecutor } from "@/db/client-factory";
import { auditLog } from "@/db/schema";

/**
 * Every audited action the app can record. Adding a new action means adding it
 * here, so the audit trail vocabulary stays consistent and searchable.
 */
export const AUDIT_ACTIONS = [
  "organisation.created",
  "file.stored",
  "file.reused",
  "user.invited",
  "user.role_changed",
  "user.deactivated",
  "user.reactivated",
  "user.setup_link_issued",
  "user.password_set",
  "user.password_changed",
  "user.login_succeeded",
  "user.login_failed",
  "user.locked_out",
  "user.logged_out",
  "user.sessions_revoked",
  "settings.updated",
  "site.created",
  "site.updated",
  "client.created",
  "client.updated",
  "client_site.created",
  "client_site.updated",
  "client_department.created",
  "client_department.updated",
  "client_contact.created",
  "client_contact.updated",
  "equipment.created",
  "equipment.updated",
  "clients.imported",
  "gstin.looked_up",
  "instrument_model.created",
  "instrument_model.updated",
  "instrument.created",
  "instrument.updated",
  "instruments.imported",
  "certificate.created",
  "certificate.updated",
  "certificate.submitted",
  "certificate.checked",
  "certificate.returned",
  "certificate.issued",
  "certificate.cancelled",
  "record.signed",
  "signature.failed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const MAX_SNAPSHOT_BYTES = 64 * 1024;

const auditEventSchema = z
  .object({
    organisationId: z.string().uuid(),
    actor: z.discriminatedUnion("type", [
      z.object({ type: z.literal("user"), userId: z.string().uuid() }),
      z.object({ type: z.literal("system") }),
    ]),
    action: z.enum(AUDIT_ACTIONS),
    entityType: z.string().regex(/^[a-z_]+$/, "entityType must be snake_case"),
    entityId: z.string().min(1).max(200),
    summary: z.string().min(1).max(500),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    request: z
      .object({
        requestId: z.string().max(100).optional(),
        ipAddress: z.ipv4().or(z.ipv6()).optional(),
        userAgent: z.string().max(500).optional(),
      })
      .optional(),
  })
  .superRefine((event, ctx) => {
    for (const key of ["before", "after"] as const) {
      const value = event[key];
      if (value === undefined) continue;
      const size = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
      if (size > MAX_SNAPSHOT_BYTES) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} snapshot is ${size} bytes; store large data as a file and audit its hash instead`,
        });
      }
    }
  });

export type AuditEvent = z.input<typeof auditEventSchema>;

/**
 * Write one audit row.
 *
 * Pass the same transaction that performs the change being audited, so the
 * change and its audit record commit or roll back together. Invalid events
 * throw: an action that cannot be audited must not happen silently.
 */
export async function recordAudit(executor: DbExecutor, event: AuditEvent): Promise<bigint> {
  const e = auditEventSchema.parse(event);
  const [row] = await executor
    .insert(auditLog)
    .values({
      organisationId: e.organisationId,
      actorType: e.actor.type,
      actorUserId: e.actor.type === "user" ? e.actor.userId : null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: e.summary,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
      requestId: e.request?.requestId ?? null,
      ipAddress: e.request?.ipAddress ?? null,
      userAgent: e.request?.userAgent ?? null,
    })
    .returning({ id: auditLog.id });

  if (!row) throw new Error("Audit insert returned no row");
  return row.id;
}
