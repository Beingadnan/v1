import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientCompanies,
  clientContacts,
  clientDepartments,
  clientSites,
  type ClientCompany,
  type ClientContact,
  type ClientDepartment,
  type ClientSite,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { recordAudit } from "@/lib/audit";

import { ClientsError } from "./errors";
import { companyNameKey } from "./names";
import {
  clientSiteSchema,
  companySchema,
  contactSchema,
  departmentSchema,
  yesNo,
  type ClientSiteInput,
  type CompanyInput,
  type ContactInput,
} from "./schemas";
import { diff, isUuid, lockCompany, rethrowUnique } from "./shared";

const COMPANY_UNIQUE = {
  client_companies_org_name_key: "A client with this name already exists.",
  client_companies_org_code_key: "Another client already uses this short name.",
};
const SITE_UNIQUE = {
  client_sites_company_name_key: "This client already has a site with that name.",
  client_sites_company_code_key: "This client already has a site with that code.",
};
const DEPARTMENT_UNIQUE = {
  client_departments_site_name_key: "This site already has a department with that name.",
};

export const CLIENT_FIELD_LABELS: Record<string, string> = {
  name: "name",
  code: "short name",
  gstin: "GSTIN",
  address: "address",
  notes: "notes",
  postCalRequired: "post-calibration rule",
  requalificationMonths: "requalification interval",
  reportNumberFormat: "report number format",
  city: "city",
  state: "state",
  active: "status",
  designation: "designation",
  email: "email",
  phone: "phone",
  signatory: "report signatory",
  siteId: "site",
};
const labelled = (keys: string[]) => keys.map((k) => CLIENT_FIELD_LABELS[k] ?? k).join(", ");

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

/** Wraps inserts/updates so a duplicate name becomes a readable message. */
async function guarded<T>(messages: Record<string, string>, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    rethrowUnique(error, messages);
  }
}

// ---------------------------------------------------------------- companies

export async function createCompany(
  db: Database,
  actor: SessionUser,
  input: CompanyInput & { firstSite?: ClientSiteInput | null; allowSimilar?: unknown },
  request: RequestInfo,
): Promise<ClientCompany> {
  assertCan(actor, "clients.manage");
  const values = companySchema.parse(input);
  const firstSite = input.firstSite ? clientSiteSchema.parse(input.firstSite) : null;

  return guarded({ ...COMPANY_UNIQUE, ...SITE_UNIQUE }, () =>
    db.transaction(async (tx) => {
      if (!yesNo.parse(input.allowSimilar ?? false)) {
        const existing = await tx
          .select({ name: clientCompanies.name, code: clientCompanies.code })
          .from(clientCompanies)
          .where(eq(clientCompanies.organisationId, actor.organisationId));
        const twin = existing.find((c) => companyNameKey(c.name) === companyNameKey(values.name));
        if (twin) {
          throw new ClientsError(
            `${twin.name} (${twin.code}) already exists and looks like the same company. If this really is a different company, tick “This is a different company” and save again.`,
          );
        }
      }
      const company = await insertCompany(tx, actor, values, request);
      if (firstSite) await insertSite(tx, actor, company, firstSite, request);
      return company;
    }),
  );
}

/** Inside a transaction; shared with the Excel import. */
export async function insertCompany(
  tx: Transaction,
  actor: SessionUser,
  values: z.output<typeof companySchema>,
  request: RequestInfo,
): Promise<ClientCompany> {
  const [company] = await tx
    .insert(clientCompanies)
    .values({ ...values, organisationId: actor.organisationId, createdByUserId: actor.id })
    .returning();
  if (!company) throw new Error("Company insert returned no row");
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "client.created",
    entityType: "client_company",
    entityId: company.id,
    summary: `${actor.name} added client ${company.name} (${company.code})`,
    after: values,
    request,
  });
  return company;
}

/** Applies changed fields only, audited; inside a transaction. Shared with the import. */
export async function patchCompany(
  tx: Transaction,
  actor: SessionUser,
  company: ClientCompany,
  values: Partial<z.output<typeof companySchema>> & { active?: boolean },
  request: RequestInfo,
): Promise<string[]> {
  const { before, after, changed } = diff(company, values);
  if (changed.length === 0) return changed;
  await tx
    .update(clientCompanies)
    .set({ ...after, updatedAt: new Date() })
    .where(eq(clientCompanies.id, company.id));
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "client.updated",
    entityType: "client_company",
    entityId: company.id,
    summary: `${actor.name} changed ${labelled(changed)} for ${values.name ?? company.name}`,
    before,
    after,
    request,
  });
  return changed;
}

export async function updateCompany(
  db: Database,
  actor: SessionUser,
  companyId: string,
  input: CompanyInput & { active?: unknown },
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "clients.manage");
  const values = { ...companySchema.parse(input), active: yesNo.parse(input.active ?? true) };

  return guarded(COMPANY_UNIQUE, () =>
    db.transaction(async (tx) => {
      const company = await lockCompany(tx, actor, companyId);
      return { changed: await patchCompany(tx, actor, company, values, request) };
    }),
  );
}

// ---------------------------------------------------------------- sites

/** Inside a transaction; shared with the Excel import. */
export async function insertSite(
  tx: Transaction,
  actor: SessionUser,
  company: ClientCompany,
  values: z.output<typeof clientSiteSchema>,
  request: RequestInfo,
): Promise<ClientSite> {
  const [site] = await tx
    .insert(clientSites)
    .values({
      ...values,
      organisationId: actor.organisationId,
      companyId: company.id,
      createdByUserId: actor.id,
    })
    .returning();
  if (!site) throw new Error("Site insert returned no row");
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "client_site.created",
    entityType: "client_site",
    entityId: site.id,
    summary: `${actor.name} added site ${site.name} to ${company.name}`,
    after: values,
    request,
  });
  return site;
}

export async function createClientSite(
  db: Database,
  actor: SessionUser,
  companyId: string,
  input: ClientSiteInput,
  request: RequestInfo,
): Promise<ClientSite> {
  assertCan(actor, "clients.manage");
  const values = clientSiteSchema.parse(input);
  return guarded(SITE_UNIQUE, () =>
    db.transaction(async (tx) => {
      const company = await lockCompany(tx, actor, companyId);
      return insertSite(tx, actor, company, values, request);
    }),
  );
}

async function lockSite(tx: Transaction, actor: SessionUser, siteId: string): Promise<ClientSite> {
  if (!isUuid(siteId)) throw new ClientsError("That site does not exist.");
  const [site] = await tx
    .select()
    .from(clientSites)
    .where(and(eq(clientSites.id, siteId), eq(clientSites.organisationId, actor.organisationId)))
    .for("update");
  if (!site) throw new ClientsError("That site does not exist.");
  return site;
}

export async function updateClientSite(
  db: Database,
  actor: SessionUser,
  siteId: string,
  input: ClientSiteInput & { active?: unknown },
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "clients.manage");
  const values = { ...clientSiteSchema.parse(input), active: yesNo.parse(input.active ?? true) };
  return guarded(SITE_UNIQUE, () =>
    db.transaction(async (tx) => {
      const site = await lockSite(tx, actor, siteId);
      return { changed: await patchSite(tx, actor, site, values, request) };
    }),
  );
}

/** Applies changed fields only, audited; inside a transaction. Shared with the import. */
export async function patchSite(
  tx: Transaction,
  actor: SessionUser,
  site: ClientSite,
  values: Partial<z.output<typeof clientSiteSchema>> & { active?: boolean },
  request: RequestInfo,
): Promise<string[]> {
  const { before, after, changed } = diff(site, values);
  if (changed.length === 0) return changed;
  await tx
    .update(clientSites)
    .set({ ...after, updatedAt: new Date() })
    .where(eq(clientSites.id, site.id));
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "client_site.updated",
    entityType: "client_site",
    entityId: site.id,
    summary: `${actor.name} changed ${labelled(changed)} for site ${values.name ?? site.name}`,
    before,
    after,
    request,
  });
  return changed;
}

// ---------------------------------------------------------------- departments

export async function createDepartment(
  db: Database,
  actor: SessionUser,
  siteId: string,
  input: { name: string },
  request: RequestInfo,
): Promise<ClientDepartment> {
  assertCan(actor, "clients.manage");
  const values = departmentSchema.parse(input);
  return guarded(DEPARTMENT_UNIQUE, () =>
    db.transaction(async (tx) => {
      const site = await lockSite(tx, actor, siteId);
      const department = await insertDepartment(tx, actor, site, values.name, request);
      return department;
    }),
  );
}

/** Also used by the Excel import, which creates departments it hasn't seen. */
export async function insertDepartment(
  tx: Transaction,
  actor: SessionUser,
  site: ClientSite,
  name: string,
  request: RequestInfo,
): Promise<ClientDepartment> {
  const [department] = await tx
    .insert(clientDepartments)
    .values({
      organisationId: actor.organisationId,
      companyId: site.companyId,
      siteId: site.id,
      name,
      createdByUserId: actor.id,
    })
    .returning();
  if (!department) throw new Error("Department insert returned no row");
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "client_department.created",
    entityType: "client_department",
    entityId: department.id,
    summary: `${actor.name} added department ${name} at ${site.name}`,
    after: { name, siteId: site.id },
    request,
  });
  return department;
}

export async function updateDepartment(
  db: Database,
  actor: SessionUser,
  departmentId: string,
  input: { name: string; active?: unknown },
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "clients.manage");
  const values = { ...departmentSchema.parse(input), active: yesNo.parse(input.active ?? true) };
  if (!isUuid(departmentId)) throw new ClientsError("That department does not exist.");
  return guarded(DEPARTMENT_UNIQUE, () =>
    db.transaction(async (tx) => {
      const [department] = await tx
        .select()
        .from(clientDepartments)
        .where(
          and(
            eq(clientDepartments.id, departmentId),
            eq(clientDepartments.organisationId, actor.organisationId),
          ),
        )
        .for("update");
      if (!department) throw new ClientsError("That department does not exist.");
      const { before, after, changed } = diff(department, values);
      if (changed.length === 0) return { changed };
      await tx
        .update(clientDepartments)
        .set({ ...after, updatedAt: new Date() })
        .where(eq(clientDepartments.id, department.id));
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "client_department.updated",
        entityType: "client_department",
        entityId: department.id,
        summary: `${actor.name} changed ${labelled(changed)} for department ${values.name}`,
        before,
        after,
        request,
      });
      return { changed };
    }),
  );
}

// ---------------------------------------------------------------- contacts

async function checkSiteOfCompany(
  tx: Transaction,
  company: ClientCompany,
  siteId: string | null,
): Promise<void> {
  if (!siteId) return;
  const [site] = await tx
    .select({ id: clientSites.id })
    .from(clientSites)
    .where(and(eq(clientSites.id, siteId), eq(clientSites.companyId, company.id)));
  if (!site) throw new ClientsError("Choose one of this client's sites.");
}

export async function createContact(
  db: Database,
  actor: SessionUser,
  companyId: string,
  input: ContactInput,
  request: RequestInfo,
): Promise<ClientContact> {
  assertCan(actor, "clients.manage");
  const values = contactSchema.parse(input);
  return db.transaction(async (tx) => {
    const company = await lockCompany(tx, actor, companyId);
    await checkSiteOfCompany(tx, company, values.siteId);
    const [contact] = await tx
      .insert(clientContacts)
      .values({
        ...values,
        organisationId: actor.organisationId,
        companyId: company.id,
        createdByUserId: actor.id,
      })
      .returning();
    if (!contact) throw new Error("Contact insert returned no row");
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "client_contact.created",
      entityType: "client_contact",
      entityId: contact.id,
      summary: `${actor.name} added contact ${contact.name} at ${company.name}`,
      after: values,
      request,
    });
    return contact;
  });
}

export async function updateContact(
  db: Database,
  actor: SessionUser,
  contactId: string,
  input: ContactInput & { active?: unknown },
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "clients.manage");
  const values = { ...contactSchema.parse(input), active: yesNo.parse(input.active ?? true) };
  if (!isUuid(contactId)) throw new ClientsError("That contact does not exist.");
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.organisationId, actor.organisationId),
        ),
      )
      .for("update");
    if (!contact) throw new ClientsError("That contact does not exist.");
    const company = await lockCompany(tx, actor, contact.companyId);
    await checkSiteOfCompany(tx, company, values.siteId);
    const { before, after, changed } = diff(contact, values);
    if (changed.length === 0) return { changed };
    await tx
      .update(clientContacts)
      .set({ ...after, updatedAt: new Date() })
      .where(eq(clientContacts.id, contact.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: user(actor),
      action: "client_contact.updated",
      entityType: "client_contact",
      entityId: contact.id,
      summary: `${actor.name} changed ${labelled(changed)} for contact ${values.name}`,
      before,
      after,
      request,
    });
    return { changed };
  });
}
