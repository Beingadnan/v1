import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/db/client-factory";
import {
  clientCompanies,
  clientDepartments,
  clientSites,
  equipment,
  storedFiles,
  type ClientCompany,
  type ClientSite,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { recordAudit } from "@/lib/audit";
import type { BlobStore } from "@/lib/storage/blob-store";

import {
  CLIENT_FIELD_LABELS,
  insertCompany,
  insertDepartment,
  insertSite,
  patchCompany,
  patchSite,
} from "../company-service";
import { applyEquipmentChanges, EQUIPMENT_LABELS, insertEquipment } from "../equipment-service";
import { ClientsError } from "../errors";
import { getEffectiveTypeDefaults } from "../type-defaults-service";
import { isUuid, rethrowUnique } from "../shared";
import { planCounts, planImport, type ImportPlan, type Snapshot } from "./plan";
import { readImportWorkbook } from "./workbook";

/** Everything the planner needs to know about what is already stored. */
async function loadSnapshot(executor: DbExecutor, organisationId: string): Promise<Snapshot> {
  const [companies, sites, departments, items] = await Promise.all([
    executor
      .select()
      .from(clientCompanies)
      .where(eq(clientCompanies.organisationId, organisationId)),
    executor.select().from(clientSites).where(eq(clientSites.organisationId, organisationId)),
    executor
      .select()
      .from(clientDepartments)
      .where(eq(clientDepartments.organisationId, organisationId)),
    executor.select().from(equipment).where(eq(equipment.organisationId, organisationId)),
  ]);
  const typeDefaults = await getEffectiveTypeDefaults(executor, organisationId);
  return { companies, sites, departments, equipment: items, typeDefaults };
}

async function loadFile(db: Database, blobs: BlobStore, actor: SessionUser, fileId: string) {
  if (!isUuid(fileId)) throw new ClientsError("Upload the file again.");
  const [file] = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, actor.organisationId)));
  if (!file) throw new ClientsError("Upload the file again.");
  if (file.fileType !== "xlsx") {
    throw new ClientsError(
      file.fileType === "xls"
        ? "This is an old .xls file. Open it in Excel, save it as .xlsx, and upload that."
        : "Upload an Excel (.xlsx) file made from the template.",
    );
  }
  return { file, bytes: await blobs.get(file.storageKey) };
}

async function readAndPlan(executor: DbExecutor, actor: SessionUser, bytes: Uint8Array) {
  const read = await readImportWorkbook(bytes);
  if (!read.ok) throw new ClientsError(read.message);
  const snapshot = await loadSnapshot(executor, actor.organisationId);
  return { plan: planImport(read, snapshot), rows: read.clients.length + read.equipment.length };
}

export type ImportPreview = {
  fileId: string;
  fileName: string;
  sha256: string;
  rows: number;
  counts: ReturnType<typeof planCounts>;
  errors: ImportPlan["errors"];
  /** What will change, in plain words, for the preview list. */
  changes: {
    kind: "client" | "site" | "department" | "equipment";
    action: "create" | "update";
    label: string;
    detail: string;
  }[];
};

const words = (keys: string[], labels: Record<string, string>) =>
  `changes ${keys.map((k) => labels[k] ?? k).join(", ")}`;

function describe(plan: ImportPlan): ImportPreview["changes"] {
  const changes: ImportPreview["changes"] = [];
  const companyName = new Map(plan.companies.map((c) => [c.key, c.values.code]));
  const siteName = new Map(plan.sites.map((s) => [s.key, s.values.name]));
  for (const c of plan.companies) {
    if (c.action === "unchanged") continue;
    changes.push({
      kind: "client",
      action: c.action,
      label: `${c.values.name} (${c.values.code})`,
      detail: c.action === "update" ? words(c.changed, CLIENT_FIELD_LABELS) : "new client",
    });
  }
  for (const s of plan.sites) {
    if (s.action === "unchanged") continue;
    changes.push({
      kind: "site",
      action: s.action,
      label: `${companyName.get(s.companyKey)} → ${s.values.name}`,
      detail: s.action === "update" ? words(s.changed, CLIENT_FIELD_LABELS) : "new site",
    });
  }
  for (const d of plan.newDepartments) {
    const site = plan.sites.find((s) => s.key === d.siteKey);
    changes.push({
      kind: "department",
      action: "create",
      label: `${site ? companyName.get(site.companyKey) : ""} → ${siteName.get(d.siteKey)} → ${d.name}`,
      detail: "new department",
    });
  }
  for (const e of plan.equipment) {
    if (e.action === "unchanged") continue;
    changes.push({
      kind: "equipment",
      action: e.action,
      label: `${companyName.get(e.companyKey)} → ${e.values.code} · ${e.values.name}`,
      detail: e.action === "update" ? words(e.changed, EQUIPMENT_LABELS) : "new equipment",
    });
  }
  return changes;
}

/** Reads the uploaded workbook and reports what an import would do. Changes nothing. */
export async function previewImport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  fileId: string,
): Promise<ImportPreview> {
  assertCan(actor, "clients.manage");
  const { file, bytes } = await loadFile(db, blobs, actor, fileId);
  const { plan, rows } = await readAndPlan(db, actor, bytes);
  return {
    fileId: file.id,
    fileName: file.firstFileName,
    sha256: file.sha256,
    rows,
    counts: planCounts(plan),
    errors: plan.errors,
    changes: describe(plan),
  };
}

const IMPORT_UNIQUE = {
  client_companies_org_name_key:
    "A client in the file was just added by someone else. Preview again.",
  client_companies_org_code_key:
    "A client in the file was just added by someone else. Preview again.",
  client_sites_company_name_key:
    "A site in the file was just added by someone else. Preview again.",
  client_sites_company_code_key:
    "Two sites of one client would get the same site code. Fix the Site code column.",
  client_departments_site_name_key:
    "A department in the file was just added by someone else. Preview again.",
  equipment_company_code_key:
    "Equipment in the file was just added by someone else. Preview again.",
};

/**
 * Applies the import in one transaction: everything or nothing. The plan is
 * rebuilt inside the transaction from the stored file, so what is applied
 * matches the database at that moment, not an older preview.
 */
export async function applyImport(
  db: Database,
  blobs: BlobStore,
  actor: SessionUser,
  fileId: string,
  request: RequestInfo,
): Promise<ReturnType<typeof planCounts>> {
  assertCan(actor, "clients.manage");
  const { file, bytes } = await loadFile(db, blobs, actor, fileId);
  try {
    return await db.transaction(async (tx) => {
      // One import at a time per organisation.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`clients-import:${actor.organisationId}`}))`,
      );
      const { plan } = await readAndPlan(tx, actor, bytes);
      if (plan.errors.length > 0) {
        throw new ClientsError(
          `The file has ${plan.errors.length} problem${plan.errors.length === 1 ? "" : "s"}. Fix them and upload it again.`,
        );
      }

      const companies = new Map<string, ClientCompany>();
      for (const c of plan.companies) {
        if (c.action === "create") {
          companies.set(c.key, await insertCompany(tx, actor, c.values, request));
          continue;
        }
        const [row] = await tx
          .select()
          .from(clientCompanies)
          .where(
            and(
              eq(clientCompanies.id, c.id!),
              eq(clientCompanies.organisationId, actor.organisationId),
            ),
          )
          .for("update");
        if (!row) throw new ClientsError("A client changed while importing. Preview again.");
        if (c.action === "update") await patchCompany(tx, actor, row, c.values, request);
        companies.set(c.key, row);
      }

      const sites = new Map<string, ClientSite>();
      for (const s of plan.sites) {
        const company = companies.get(s.companyKey)!;
        if (s.action === "create") {
          sites.set(s.key, await insertSite(tx, actor, company, s.values, request));
          continue;
        }
        const [row] = await tx
          .select()
          .from(clientSites)
          .where(and(eq(clientSites.id, s.id!), eq(clientSites.companyId, company.id)))
          .for("update");
        if (!row) throw new ClientsError("A site changed while importing. Preview again.");
        if (s.action === "update") await patchSite(tx, actor, row, s.values, request);
        sites.set(s.key, row);
      }

      const departmentIds = new Map<string, string>();
      for (const d of plan.newDepartments) {
        const site = sites.get(d.siteKey)!;
        departmentIds.set(d.key, (await insertDepartment(tx, actor, site, d.name, request)).id);
      }
      const departmentIdFor = async (
        key: string | null,
        siteId: string,
      ): Promise<string | null> => {
        if (!key) return null;
        if (key.startsWith("existing:")) return key.slice("existing:".length);
        const planned = departmentIds.get(key);
        if (planned) return planned;
        const name = key.split("|").at(-1)!;
        const [row] = await tx
          .select({ id: clientDepartments.id })
          .from(clientDepartments)
          .where(
            and(
              eq(clientDepartments.siteId, siteId),
              sql`lower(${clientDepartments.name}) = ${name}`,
            ),
          );
        if (!row) throw new ClientsError("A department changed while importing. Preview again.");
        return row.id;
      };

      for (const e of plan.equipment) {
        if (e.action === "unchanged") continue;
        const company = companies.get(e.companyKey)!;
        const site = sites.get(e.siteKey)!;
        const values = {
          ...e.values,
          siteId: site.id,
          departmentId: await departmentIdFor(e.departmentKey, site.id),
        };
        if (e.action === "create") {
          await insertEquipment(tx, actor, company, values, request);
        } else {
          const [current] = await tx
            .select()
            .from(equipment)
            .where(and(eq(equipment.id, e.id!), eq(equipment.companyId, company.id)))
            .for("update");
          if (!current) throw new ClientsError("Equipment changed while importing. Preview again.");
          await applyEquipmentChanges(tx, actor, company, current, values, request, {
            reason: `Excel import ${file.firstFileName}`,
          });
        }
      }

      const counts = planCounts(plan);
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: { type: "user", userId: actor.id },
        action: "clients.imported",
        entityType: "stored_file",
        entityId: file.id,
        summary: `${actor.name} imported ${file.firstFileName}: ${counts.companies.create} new clients, ${counts.sites.create} new sites, ${counts.equipment.create} new and ${counts.equipment.update} updated equipment`,
        after: { fileName: file.firstFileName, sha256: file.sha256, counts },
        request,
      });
      return counts;
    });
  } catch (error) {
    rethrowUnique(error, IMPORT_UNIQUE);
  }
}
