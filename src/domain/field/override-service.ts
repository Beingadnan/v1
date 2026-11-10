import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import { instruments, precalOverrides, studies, studyPrecal, users } from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { signRecordTx } from "@/domain/auth/signature-service";
import { isUuid } from "@/domain/clients/shared";
import { byRole, notify } from "@/domain/notifications/notify";
import { recordAudit } from "@/lib/audit";

import { FieldError } from "./errors";

/**
 * Overriding a pre- or post-calibration result (QA Tech, Nov 2026). The
 * reading and its computed pass/fail are never changed: an override adds the
 * result to use, with a reason, and counts only once a second person (a team
 * leader or manager) approves it with their password. The report prints the
 * computed result, the override and who approved it.
 */

/** The result in force for a study_precal row: an approved override's, else the computed one. */
export const effectiveResult = sql<string>`coalesce((select o.to_result from precal_overrides o
  where o.precal_id = "study_precal"."id" and o.status = 'approved'), "study_precal"."result")`;

const requestSchema = z.object({
  toResult: z.enum(["pass", "fail"], { message: "Pick pass or fail." }),
  reason: z
    .string()
    .trim()
    .min(10, "Say why, in a sentence: it goes into the report.")
    .max(1000, "Keep the reason under 1,000 characters."),
});

const user = (a: SessionUser) => ({ type: "user" as const, userId: a.id });
const LABEL = { pass: "Pass", fail: "Fail" } as const;

async function lockReading(tx: Transaction, actor: SessionUser, precalId: string) {
  if (!isUuid(precalId)) throw new FieldError("That reading does not exist.");
  const [row] = await tx
    .select({ p: studyPrecal, code: instruments.code, study: studies })
    .from(studyPrecal)
    .innerJoin(studies, eq(studies.id, studyPrecal.studyId))
    .innerJoin(instruments, eq(instruments.id, studyPrecal.instrumentId))
    .where(and(eq(studyPrecal.id, precalId), eq(studyPrecal.organisationId, actor.organisationId)))
    .for("update", { of: studies });
  if (!row) throw new FieldError("That reading does not exist.");
  return row;
}

export async function requestOverride(
  db: Database,
  actor: SessionUser,
  precalId: string,
  input: { toResult?: unknown; reason?: unknown },
  request?: RequestInfo,
): Promise<{ id: string }> {
  if (!can(actor, "field.perform") && !can(actor, "postcal.record")) {
    assertCan(actor, "analysis.approve");
  }
  const v = requestSchema.parse(input);
  return db.transaction(async (tx) => {
    const { p, code, study } = await lockReading(tx, actor, precalId);
    if (p.result === v.toResult) {
      throw new FieldError(`The reading already gives ${LABEL[v.toResult]}.`);
    }
    if (study.analysisApprovedAt) {
      throw new FieldError(
        "The analysis is approved: withdraw the approval before overriding a result.",
      );
    }
    const [live] = await tx
      .select({ status: precalOverrides.status })
      .from(precalOverrides)
      .where(
        and(
          eq(precalOverrides.precalId, p.id),
          sql`${precalOverrides.status} in ('requested', 'approved')`,
        ),
      );
    if (live) {
      throw new FieldError(
        live.status === "approved"
          ? "This result is already overridden."
          : "An override of this result is waiting for approval.",
      );
    }
    const [row] = await tx
      .insert(precalOverrides)
      .values({
        organisationId: actor.organisationId,
        studyId: study.id,
        precalId: p.id,
        fromResult: p.result,
        toResult: v.toResult,
        reason: v.reason,
        requestedByUserId: actor.id,
      })
      .returning({ id: precalOverrides.id });
    const phase = p.phase === "post" ? "post-calibration" : "pre-calibration";
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "precal.override_requested",
      entityType: "precal_override",
      entityId: row!.id,
      summary: `${actor.name} asked to override ${code}'s ${phase} result from ${LABEL[p.result as "pass"]} to ${LABEL[v.toResult]}: ${v.reason}`,
      after: { precalId: p.id, from: p.result, to: v.toResult, reason: v.reason },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: await byRole(tx, actor.organisationId, ["manager", "team_leader"]),
      except: actor.id,
      kind: "override_to_approve",
      title: `Approve an override: ${code} ${phase}`,
      body: `${actor.name} asks to take ${code} as ${LABEL[v.toResult]} instead of ${LABEL[p.result as "pass"]}: ${v.reason}`,
      href: `/studies/${study.id}?tab=${p.phase === "post" ? "postcal" : "precal"}`,
    });
    return { id: row!.id };
  });
}

export type DecideResult = { ok: true } | { ok: false; message: string };

/**
 * A team leader or manager other than the person who asked approves (with
 * their password: an electronic signature) or rejects (with a note).
 */
export async function decideOverride(
  db: Database,
  actor: SessionUser,
  overrideId: string,
  input: { approve: boolean; password?: string; note?: unknown },
  request: RequestInfo,
): Promise<DecideResult> {
  assertCan(actor, "analysis.approve");
  if (!isUuid(overrideId)) throw new FieldError("That override does not exist.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (!input.approve && note.length < 5) throw new FieldError("Say why it is rejected.");
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select()
      .from(precalOverrides)
      .where(
        and(
          eq(precalOverrides.id, overrideId),
          eq(precalOverrides.organisationId, actor.organisationId),
        ),
      )
      .for("update");
    if (!o) throw new FieldError("That override does not exist.");
    if (o.status !== "requested") throw new FieldError("This override was already decided.");
    if (o.requestedByUserId === actor.id) {
      throw new FieldError("A second person must decide: you asked for this override.");
    }
    const { code, study } = await lockReading(tx, actor, o.precalId);
    if (input.approve && study.analysisApprovedAt) {
      throw new FieldError("The analysis is approved: withdraw the approval first.");
    }
    let signatureId: string | null = null;
    if (input.approve) {
      const hash = createHash("sha256")
        .update(JSON.stringify([o.id, o.precalId, o.fromResult, o.toResult, o.reason]))
        .digest("hex");
      const signed = await signRecordTx(
        tx,
        actor,
        {
          meaning: "approved_by",
          entityType: "precal_override",
          entityId: o.id,
          recordHash: hash,
          reason: o.reason,
          password: input.password ?? "",
        },
        request,
      );
      if (!signed.ok) return { ok: false as const, message: signed.message };
      signatureId = signed.signature.id;
    }
    const status = input.approve ? "approved" : "rejected";
    await tx
      .update(precalOverrides)
      .set({
        status,
        decidedByUserId: actor.id,
        decidedAt: new Date(),
        signatureId,
        decisionNote: note,
      })
      .where(eq(precalOverrides.id, o.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: input.approve ? "precal.override_approved" : "precal.override_rejected",
      entityType: "precal_override",
      entityId: o.id,
      summary: input.approve
        ? `${actor.name} approved taking ${code} as ${LABEL[o.toResult as "pass"]} (by the readings ${LABEL[o.fromResult as "pass"]})`
        : `${actor.name} rejected the override of ${code}: ${note}`,
      before: { status: "requested" },
      after: { status, signatureId, note },
      request,
    });
    await notify(tx, {
      organisationId: actor.organisationId,
      to: [o.requestedByUserId],
      except: actor.id,
      kind: "override_to_approve",
      title: `Override ${status}: ${code}`,
      body: input.approve
        ? `${actor.name} approved taking ${code} as ${LABEL[o.toResult as "pass"]}.`
        : `${actor.name} rejected it: ${note}`,
      href: `/studies/${study.id}`,
    });
    return { ok: true as const };
  });
}

export type OverrideRow = {
  id: string;
  precalId: string;
  fromResult: string;
  toResult: string;
  reason: string;
  status: "requested" | "approved" | "rejected";
  requestedByUserId: string;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string;
};

/** A study's overrides, oldest first. */
export async function overridesOf(
  db: Database | Transaction,
  studyId: string,
): Promise<OverrideRow[]> {
  const asker = alias(users, "asker");
  const decider = alias(users, "decider");
  const rows = await db
    .select({
      id: precalOverrides.id,
      precalId: precalOverrides.precalId,
      fromResult: precalOverrides.fromResult,
      toResult: precalOverrides.toResult,
      reason: precalOverrides.reason,
      status: precalOverrides.status,
      requestedByUserId: precalOverrides.requestedByUserId,
      requestedBy: asker.name,
      requestedAt: precalOverrides.requestedAt,
      decidedBy: decider.name,
      decidedAt: precalOverrides.decidedAt,
      decisionNote: precalOverrides.decisionNote,
    })
    .from(precalOverrides)
    .innerJoin(asker, eq(asker.id, precalOverrides.requestedByUserId))
    .leftJoin(decider, eq(decider.id, precalOverrides.decidedByUserId))
    .where(eq(precalOverrides.studyId, studyId))
    .orderBy(asc(precalOverrides.requestedAt));
  return rows.map((r) => ({ ...r, status: r.status as OverrideRow["status"] }));
}
