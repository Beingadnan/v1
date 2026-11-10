"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { inviteClientUser } from "@/domain/auth/account-service";
import {
  createClientSite,
  createCompany,
  createContact,
  createDepartment,
  updateClientSite,
  updateCompany,
  updateContact,
  updateDepartment,
} from "@/domain/clients/company-service";
import {
  createEquipment,
  setEquipmentActive,
  updateEquipment,
} from "@/domain/clients/equipment-service";
import { isArea } from "@/domain/clients/equipment-types";
import { ClientsError } from "@/domain/clients/errors";
import type { GstLookupConfig } from "@/domain/clients/gst-lookup";
import { lookupGstin, type GstFill } from "@/domain/clients/gst-lookup-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/dal";
import { env } from "@/lib/env";
import { getRequestInfo } from "@/lib/request-info";

/**
 * Server actions for the Clients screens. Each one re-checks the session and
 * passes raw strings to a domain service, which validates them and checks the
 * person's permission. Nothing here trusts the browser.
 */

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const fields = <K extends string>(formData: FormData, names: readonly K[]) =>
  Object.fromEntries(names.map((name) => [name, field(formData, name)])) as Record<K, string>;

const COMPANY_FIELDS = [
  "name",
  "code",
  "gstin",
  "address",
  "notes",
  "postCalRequired",
  "requalificationMonths",
  "paymentTermsDays",
  "reportNumberFormat",
] as const;
const SITE_FIELDS = ["name", "code", "address", "city", "state", "gstin"] as const;
const CONTACT_FIELDS = ["siteId", "name", "designation", "email", "phone", "signatory"] as const;
const EQUIPMENT_FIELDS = [
  "siteId",
  "departmentId",
  "code",
  "name",
  "type",
  "location",
  "make",
  "model",
  "serialNo",
  "lengthM",
  "widthM",
  "heightM",
  "setPointC",
  "tempMinC",
  "tempMaxC",
  "rhMinPct",
  "rhMaxPct",
  "defaultChannels",
  "readingIntervalMinutes",
  "studyDurationHours",
  "requalificationMonths",
  "lastStudyOn",
  "notes",
] as const;

const saved = (changed: string[]) => (changed.length === 0 ? "Nothing changed." : "Saved.");

function refresh(companyId?: string) {
  revalidatePath("/clients");
  if (companyId) revalidatePath(`/clients/${companyId}`);
}

export async function createCompanyAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  const siteName = field(formData, "siteName").trim();
  const result = await runAction(async () => {
    const company = await createCompany(
      db,
      actor,
      {
        ...fields(formData, COMPANY_FIELDS),
        allowSimilar: field(formData, "allowSimilar"),
        // A first site is optional; its code defaults to its name.
        firstSite: siteName
          ? {
              name: siteName,
              code: field(formData, "siteCode").trim() || siteName,
              address: field(formData, "siteAddress"),
              city: field(formData, "siteCity"),
              state: field(formData, "siteState"),
              gstin: "",
            }
          : null,
      },
      await getRequestInfo(),
    );
    return { id: company.id };
  });
  if (result.ok) refresh();
  return result;
}

export async function updateCompanyAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const result = await runAction(async () =>
    updateCompany(
      db,
      actor,
      companyId,
      { ...fields(formData, COMPANY_FIELDS), active: field(formData, "active") },
      await getRequestInfo(),
    ),
  );
  if (!result.ok) return result;
  refresh(companyId);
  return { ok: true, data: undefined, message: saved(result.data.changed) };
}

export async function saveSiteAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const siteId = field(formData, "siteId");
  const values = fields(formData, SITE_FIELDS);
  const result = await runAction(async () => {
    if (siteId) {
      return (
        await updateClientSite(
          db,
          actor,
          siteId,
          { ...values, active: field(formData, "active") },
          await getRequestInfo(),
        )
      ).changed;
    }
    await createClientSite(db, actor, companyId, values, await getRequestInfo());
    return ["created"];
  });
  if (!result.ok) return result;
  refresh(companyId);
  return { ok: true, data: undefined, message: siteId ? saved(result.data) : "Site added." };
}

export async function saveDepartmentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const departmentId = field(formData, "departmentId");
  const result = await runAction(async () => {
    if (departmentId) {
      return (
        await updateDepartment(
          db,
          actor,
          departmentId,
          { name: field(formData, "name"), active: field(formData, "active") },
          await getRequestInfo(),
        )
      ).changed;
    }
    await createDepartment(
      db,
      actor,
      field(formData, "siteId"),
      { name: field(formData, "name") },
      await getRequestInfo(),
    );
    return ["created"];
  });
  if (!result.ok) return result;
  refresh(companyId);
  return {
    ok: true,
    data: undefined,
    message: departmentId ? saved(result.data) : "Department added.",
  };
}

export async function saveContactAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const contactId = field(formData, "contactId");
  const values = fields(formData, CONTACT_FIELDS);
  const result = await runAction(async () => {
    if (contactId) {
      return (
        await updateContact(
          db,
          actor,
          contactId,
          { ...values, active: field(formData, "active") },
          await getRequestInfo(),
        )
      ).changed;
    }
    await createContact(db, actor, companyId, values, await getRequestInfo());
    return ["created"];
  });
  if (!result.ok) return result;
  refresh(companyId);
  return { ok: true, data: undefined, message: contactId ? saved(result.data) : "Contact added." };
}

export async function saveEquipmentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const equipmentId = field(formData, "equipmentId");
  const values = {
    ...fields(formData, EQUIPMENT_FIELDS),
    cycles: formData.getAll("cycles").filter((c): c is string => typeof c === "string"),
    seasonalMapping: field(formData, "seasonalMapping"),
  };
  const result = await runAction(async () => {
    if (equipmentId) {
      const { changed } = await updateEquipment(
        db,
        actor,
        equipmentId,
        values,
        await getRequestInfo(),
      );
      return { id: equipmentId, changed };
    }
    const row = await createEquipment(db, actor, companyId, values, await getRequestInfo());
    return { id: row.id, changed: ["created"] };
  });
  if (!result.ok) return result;
  refresh(companyId);
  revalidatePath(`/clients/${companyId}/equipment/${result.data.id}`);
  return {
    ok: true,
    data: { id: result.data.id },
    message: equipmentId
      ? saved(result.data.changed)
      : isArea(values.type)
        ? "Room added."
        : "Equipment added.",
  };
}

export async function setEquipmentActiveAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const active = field(formData, "active") === "true";
  const result = await runAction(
    async () =>
      setEquipmentActive(
        db,
        actor,
        {
          equipmentId: field(formData, "equipmentId"),
          active,
          reason: field(formData, "reason"),
        },
        await getRequestInfo(),
      ),
    active ? "Equipment is back in use." : "Equipment retired. Its history stays.",
  );
  if (result.ok) {
    refresh(companyId);
    revalidatePath(`/clients/${companyId}/equipment/${field(formData, "equipmentId")}`);
  }
  return result;
}

export async function inviteClientUserAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ link: string; name: string; expiresAt: string }>> {
  const actor = await requireUser();
  const companyId = field(formData, "companyId");
  const result = await runAction(async () => {
    const { user, token, expiresAt } = await inviteClientUser(
      db,
      actor,
      {
        companyId,
        name: field(formData, "name"),
        email: field(formData, "email"),
        role: field(formData, "role"),
      },
      await getRequestInfo(),
    );
    return {
      link: `${env.APP_URL}/set-password?token=${token}`,
      name: user.name,
      expiresAt: expiresAt.toISOString(),
    };
  });
  if (result.ok) {
    refresh(companyId);
    revalidatePath("/users");
  }
  return result;
}

/** Cashfree keys from the server's environment; null when the lookup is switched off. */
function gstConfig(): GstLookupConfig | null {
  if (!env.CASHFREE_CLIENT_ID || !env.CASHFREE_CLIENT_SECRET) return null;
  return {
    clientId: env.CASHFREE_CLIENT_ID,
    clientSecret: env.CASHFREE_CLIENT_SECRET,
    environment: env.CASHFREE_ENV,
    publicKey: env.CASHFREE_PUBLIC_KEY,
  };
}

/** Details for a GSTIN from the GST lookup service, to fill a form. Changes no client record. */
export async function lookupGstinAction(gstin: string): Promise<ActionResult<GstFill>> {
  const actor = await requireUser();
  return runAction(async () => {
    const result = await lookupGstin(db, actor, String(gstin), gstConfig(), await getRequestInfo());
    if (!result.ok) throw new ClientsError(result.message);
    return result.fill;
  });
}
