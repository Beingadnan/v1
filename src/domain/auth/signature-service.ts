import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import { signatures, users, type Signature } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import { checkCredentials } from "./credentials";
import type { RequestInfo } from "./policy";
import { ROLE_LABELS, type Role } from "./roles";
import type { SessionUser } from "./session-service";

/** What a signature means. Extended as report and calibration sign-offs are built. */
export const SIGNATURE_MEANINGS = {
  done_by: "Done by (prepared)",
  checked_by: "Checked by",
  reviewed_by: "Reviewed by",
  approved_by: "Approved by",
  deviation_decision: "Deviation decision",
} as const;
export type SignatureMeaning = keyof typeof SIGNATURE_MEANINGS;

const signInput = z.object({
  meaning: z.enum(Object.keys(SIGNATURE_MEANINGS) as [SignatureMeaning, ...SignatureMeaning[]]),
  entityType: z.string().regex(/^[a-z_]+$/),
  entityId: z.string().min(1).max(200),
  recordHash: z.string().regex(/^[0-9a-f]{64}$/, "recordHash must be a SHA-256 hex digest"),
  reason: z.string().trim().max(500).optional(),
});

export type SignResult =
  | { ok: true; signature: Signature }
  | { ok: false; reason: "bad_password" | "locked" | "inactive"; message: string };

/**
 * Electronic signature: the signer re-enters their password at the moment of
 * signing. Name, role, meaning, time and the hash of the exact content are
 * stored together and can never be changed. Wrong passwords count toward the
 * same lockout as sign-in.
 */
export async function signRecord(
  db: Database,
  signer: SessionUser,
  input: z.input<typeof signInput> & { password: string },
  request: RequestInfo,
): Promise<SignResult> {
  return db.transaction((tx) => signRecordTx(tx, signer, input, request));
}

/**
 * The same, inside the caller's transaction, so a signature and the change it
 * signs commit together. On a wrong password nothing is signed; the caller
 * should change nothing else and let the transaction commit, so the failed
 * attempt and the lockout count are kept.
 */
export async function signRecordTx(
  tx: Transaction,
  signer: SessionUser,
  input: z.input<typeof signInput> & { password: string },
  request: RequestInfo,
): Promise<SignResult> {
  const data = signInput.parse(input);
  const [user] = await tx.select().from(users).where(eq(users.id, signer.id)).for("update");
  if (!user || user.status !== "active") {
    return { ok: false as const, reason: "inactive" as const, message: "Sign in again." };
  }

  const check = await checkCredentials(tx, user, input.password, { request, via: "signature" });
  if (check.outcome !== "ok") {
    await recordAudit(tx, {
      organisationId: user.organisationId,
      actor: { type: "user", userId: user.id },
      action: "signature.failed",
      entityType: data.entityType,
      entityId: data.entityId,
      summary: `${user.name} entered a wrong password while signing (${SIGNATURE_MEANINGS[data.meaning]})`,
      request,
    });
    return check.outcome === "locked"
      ? {
          ok: false as const,
          reason: "locked" as const,
          message: "Too many wrong passwords. Your account is locked for 15 minutes.",
        }
      : {
          ok: false as const,
          reason: "bad_password" as const,
          message: "That password is incorrect. Nothing was signed.",
        };
  }

  const [signature] = await tx
    .insert(signatures)
    .values({
      organisationId: user.organisationId,
      userId: user.id,
      signerName: user.name,
      signerRole: ROLE_LABELS[user.role as Role],
      meaning: data.meaning,
      entityType: data.entityType,
      entityId: data.entityId,
      recordHash: data.recordHash,
      reason: data.reason ?? null,
      ipAddress: request.ipAddress ?? null,
      userAgent: request.userAgent?.slice(0, 500) ?? null,
    })
    .returning();
  if (!signature) throw new Error("Signature insert returned no row");

  await recordAudit(tx, {
    organisationId: user.organisationId,
    actor: { type: "user", userId: user.id },
    action: "record.signed",
    entityType: data.entityType,
    entityId: data.entityId,
    summary: `${user.name} signed as ${SIGNATURE_MEANINGS[data.meaning]}`,
    after: { signatureId: signature.id, recordHash: data.recordHash, meaning: data.meaning },
    reason: data.reason,
    request,
  });
  return { ok: true as const, signature };
}
