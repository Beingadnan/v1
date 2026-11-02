"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  createSite,
  setLetterhead,
  updateSettings,
  updateSite,
} from "@/domain/admin/settings-service";
import { saveTypeDefaults } from "@/domain/clients/type-defaults-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function savedMessage(changed: string[]): string {
  return changed.length === 0 ? "Nothing changed." : "Saved.";
}

async function save(
  section: "details" | "numbers" | "calculations",
  values: Record<string, string>,
): Promise<ActionResult> {
  const actor = await requireUser();
  const request = await getRequestInfo();
  const result = await runAction(async () => {
    // The schema for each section validates and converts these strings on the server.
    const { changed } = await updateSettings(
      db,
      actor,
      { section, values } as Parameters<typeof updateSettings>[2],
      request,
    );
    return changed;
  });
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ok: true, data: undefined, message: savedMessage(result.data) };
}

export async function saveDetailsAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  return save("details", {
    legalName: field(formData, "legalName"),
    shortName: field(formData, "shortName"),
    address: field(formData, "address"),
    phone: field(formData, "phone"),
    email: field(formData, "email"),
    website: field(formData, "website"),
    gstin: field(formData, "gstin"),
    udyamNumber: field(formData, "udyamNumber"),
  });
}

export async function saveNumbersAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  return save("numbers", {
    jobNumberFormat: field(formData, "jobNumberFormat"),
    certificateNumberFormat: field(formData, "certificateNumberFormat"),
  });
}

export async function saveCalculationsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return save("calculations", {
    mktActivationEnergyKjMol: field(formData, "mktActivationEnergyKjMol"),
    f0ReferenceTempC: field(formData, "f0ReferenceTempC"),
    f0ZValueC: field(formData, "f0ZValueC"),
    sessionIdleMinutes: field(formData, "sessionIdleMinutes"),
  });
}

export async function createSiteAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createSite(
      db,
      actor,
      {
        code: field(formData, "code"),
        name: field(formData, "name"),
        address: field(formData, "address"),
      },
      await getRequestInfo(),
    );
  }, "Site added.");
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function updateSiteAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateSite(
      db,
      actor,
      {
        siteId: field(formData, "siteId"),
        name: field(formData, "name"),
        address: field(formData, "address"),
        active: field(formData, "active") === "on",
      },
      await getRequestInfo(),
    );
  }, "Site updated.");
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function saveTypeDefaultsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const names = [
    "setPointC",
    "tempMinC",
    "tempMaxC",
    "rhMinPct",
    "rhMaxPct",
    "defaultChannels",
    "readingIntervalMinutes",
    "studyDurationHours",
    "requalificationMonths",
    "seasonalMapping",
  ];
  const result = await runAction(async () => {
    const { changed } = await saveTypeDefaults(
      db,
      actor,
      field(formData, "type"),
      {
        ...Object.fromEntries(names.map((n) => [n, field(formData, n)])),
        cycles: formData.getAll("cycles").filter((c): c is string => typeof c === "string"),
      },
      await getRequestInfo(),
    );
    return changed;
  });
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ok: true, data: undefined, message: savedMessage(result.data) };
}

export async function setLetterheadAction(fileId: string | null): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(
    async () => setLetterhead(db, actor, fileId, await getRequestInfo()),
    fileId
      ? "Letterhead saved. Reports and certificates print it from now on."
      : "Letterhead removed.",
  );
  if (result.ok) revalidatePath("/settings");
  return result;
}
