import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { clientCompanies, clientContracts, jobs, storedFiles } from "@/db/schema";
import { assertCan, can } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { isUuid, rethrowUnique, toNumeric } from "@/domain/clients/shared";
import { recordAudit } from "@/lib/audit";

import { JobsError } from "./errors";
import { contractSchema, type ContractInput } from "./schemas";
import { ORDER_TYPE_SHORT, type ContractType } from "./types";

/**
 * A client's ARC (annual rate contract) and AMC (annual maintenance
 * contract): kept on the client once, picked on each job they cover
 * (QA Tech, Nov 2026). Managers and accounts keep them.
 */

const user = (a: SessionUser) => ({ type: "user" as const, userId: a.id });

function assertCanKeep(actor: SessionUser) {
  if (!can(actor, "billing.record")) assertCan(actor, "jobs.manage");
}

const UNIQUE = {
  client_contracts_company_number_key: "This client already has a contract with that number.",
};

async function checkFile(db: Database, organisationId: string, fileId: string | null) {
  if (!fileId) return;
  const [file] = await db
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, organisationId)));
  if (!file) throw new JobsError("Upload the copy again.");
}

export async function saveContract(
  db: Database,
  actor: SessionUser,
  companyId: string,
  input: ContractInput,
  contractId: string | null,
  request?: RequestInfo,
): Promise<{ id: string }> {
  assertCanKeep(actor);
  const v = contractSchema.parse(input);
  if (!isUuid(companyId)) throw new JobsError("That client does not exist.");
  const [company] = await db
    .select({ id: clientCompanies.id, name: clientCompanies.name })
    .from(clientCompanies)
    .where(
      and(
        eq(clientCompanies.id, companyId),
        eq(clientCompanies.organisationId, actor.organisationId),
      ),
    );
  if (!company) throw new JobsError("That client does not exist.");
  await checkFile(db, actor.organisationId, v.fileId);
  const values = {
    kind: v.kind,
    number: v.number,
    validFrom: v.validFrom,
    validTo: v.validTo,
    value: toNumeric(v.value),
    notes: v.notes,
  };
  const label = `${ORDER_TYPE_SHORT[v.kind]} ${v.number}`;
  try {
    return await db.transaction(async (tx) => {
      if (contractId === null) {
        const [row] = await tx
          .insert(clientContracts)
          .values({
            organisationId: actor.organisationId,
            companyId,
            ...values,
            fileId: v.fileId,
            createdByUserId: actor.id,
          })
          .returning({ id: clientContracts.id });
        await recordAudit(tx, {
          organisationId: actor.organisationId,
          actor: user(actor),
          action: "contract.created",
          entityType: "client_contract",
          entityId: row!.id,
          summary: `${actor.name} added ${label} for ${company.name}, ${v.validFrom} to ${v.validTo}`,
          after: { ...values, fileId: v.fileId },
          request,
        });
        return { id: row!.id };
      }
      if (!isUuid(contractId)) throw new JobsError("That contract does not exist.");
      const [current] = await tx
        .select()
        .from(clientContracts)
        .where(
          and(
            eq(clientContracts.id, contractId),
            eq(clientContracts.organisationId, actor.organisationId),
            eq(clientContracts.companyId, companyId),
          ),
        )
        .for("update");
      if (!current) throw new JobsError("That contract does not exist.");
      if (current.kind !== v.kind) {
        const [used] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.contractId, contractId))
          .limit(1);
        if (used) throw new JobsError("Jobs are done under this contract: its kind can't change.");
      }
      // A new copy replaces the old one; leaving it out keeps what is there.
      const after = { ...values, fileId: v.fileId ?? current.fileId };
      await tx.update(clientContracts).set(after).where(eq(clientContracts.id, contractId));
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "contract.updated",
        entityType: "client_contract",
        entityId: contractId,
        summary: `${actor.name} changed ${label} for ${company.name}`,
        before: Object.fromEntries(
          Object.keys(after).map((k) => [k, current[k as keyof typeof after]]),
        ),
        after,
        request,
      });
      return { id: contractId };
    });
  } catch (error) {
    rethrowUnique(error, UNIQUE);
  }
}

export type ContractRow = {
  id: string;
  kind: ContractType;
  number: string;
  validFrom: string;
  validTo: string;
  value: string | null;
  fileId: string | null;
  notes: string;
  jobs: number;
};

/** A client's contracts, newest first, with how many jobs each covers. */
export async function listContracts(
  db: Database,
  actor: SessionUser,
  companyId: string,
): Promise<ContractRow[]> {
  assertCan(actor, "jobs.view");
  if (!isUuid(companyId)) return [];
  const rows = await db
    .select({
      id: clientContracts.id,
      kind: clientContracts.kind,
      number: clientContracts.number,
      validFrom: clientContracts.validFrom,
      validTo: clientContracts.validTo,
      value: clientContracts.value,
      fileId: clientContracts.fileId,
      notes: clientContracts.notes,
      jobs: sql<number>`(select count(*)::int from jobs j where j.contract_id = "client_contracts"."id")`,
    })
    .from(clientContracts)
    .where(
      and(
        eq(clientContracts.companyId, companyId),
        eq(clientContracts.organisationId, actor.organisationId),
      ),
    )
    .orderBy(desc(clientContracts.validTo), asc(clientContracts.number));
  return rows.map((r) => ({
    ...r,
    kind: r.kind as ContractType,
    value: can(actor, "jobs.money") ? r.value : null,
  }));
}

/** Contracts to pick on a job: id, kind, number and validity, for one client or all. */
export async function contractOptions(
  db: Database,
  actor: SessionUser,
  companyId?: string,
): Promise<
  {
    id: string;
    companyId: string;
    kind: string;
    number: string;
    validFrom: string;
    validTo: string;
  }[]
> {
  assertCan(actor, "jobs.view");
  if (companyId !== undefined && !isUuid(companyId)) return [];
  return db
    .select({
      id: clientContracts.id,
      companyId: clientContracts.companyId,
      kind: clientContracts.kind,
      number: clientContracts.number,
      validFrom: clientContracts.validFrom,
      validTo: clientContracts.validTo,
    })
    .from(clientContracts)
    .where(
      and(
        eq(clientContracts.organisationId, actor.organisationId),
        companyId ? eq(clientContracts.companyId, companyId) : undefined,
      ),
    )
    .orderBy(desc(clientContracts.validTo));
}
