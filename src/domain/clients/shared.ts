import "server-only";

import { and, eq } from "drizzle-orm";

import type { Transaction } from "@/db/client-factory";
import { clientCompanies, type ClientCompany } from "@/db/schema";
import type { SessionUser } from "@/domain/auth/session-service";

import { ClientsError } from "./errors";

/** Locks a company of the actor's organisation. Other organisations' ids look missing. */
export async function lockCompany(
  tx: Transaction,
  actor: SessionUser,
  companyId: string,
): Promise<ClientCompany> {
  if (!isUuid(companyId)) throw new ClientsError("That client does not exist.");
  const [company] = await tx
    .select()
    .from(clientCompanies)
    .where(
      and(
        eq(clientCompanies.id, companyId),
        eq(clientCompanies.organisationId, actor.organisationId),
      ),
    )
    .for("update");
  if (!company) throw new ClientsError("That client does not exist.");
  return company;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Turns a unique-index violation into a message for the person. Postgres
 * reports the index name; drizzle wraps the driver error in `cause`.
 */
export function rethrowUnique(error: unknown, messages: Record<string, string>): never {
  const pgError = findPgError(error);
  if (pgError?.code === "23505" && pgError.constraint && messages[pgError.constraint]) {
    throw new ClientsError(messages[pgError.constraint]!);
  }
  throw error;
}

function findPgError(error: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return null;
}

type Plain = string | number | boolean | null | readonly string[];

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  // numeric columns come back as "-30.00"; compare them as numbers.
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

/** Only the fields that change, as before/after snapshots for the audit trail. */
export function diff(
  current: Record<string, unknown>,
  next: Record<string, Plain>,
): { before: Record<string, unknown>; after: Record<string, Plain>; changed: string[] } {
  const before: Record<string, unknown> = {};
  const after: Record<string, Plain> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!same(current[key], value)) {
      before[key] = current[key] ?? null;
      after[key] = value;
    }
  }
  return { before, after, changed: Object.keys(after) };
}

/** Numbers go into numeric columns as strings; null stays null. */
export function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}
