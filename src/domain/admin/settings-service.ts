import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/client-factory";
import { organisationSettings, sites, storedFiles, type Site } from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { gstinSchema } from "@/domain/clients/schemas";
import { checkNumberFormat } from "@/domain/numbering/format";
import { recordAudit } from "@/lib/audit";

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

const text = (max: number) => z.string().trim().max(max);

export const organisationDetailsSchema = z.object({
  legalName: text(200).min(2, "Enter the legal name."),
  shortName: text(60).min(2, "Enter a short name."),
  address: text(500),
  phone: text(100),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]),
  website: text(200),
  gstin: gstinSchema,
});

export const numberFormatsSchema = z
  .object({ jobNumberFormat: text(60), certificateNumberFormat: text(60) })
  .superRefine((v, ctx) => {
    const job = checkNumberFormat(v.jobNumberFormat, { needsSite: false });
    if (!job.ok) ctx.addIssue({ code: "custom", path: ["jobNumberFormat"], message: job.message });
    const cert = checkNumberFormat(v.certificateNumberFormat, { needsSite: true, needsKind: true });
    if (!cert.ok) {
      ctx.addIssue({ code: "custom", path: ["certificateNumberFormat"], message: cert.message });
    }
  });

const decimal = (label: string, min: number, max: number) =>
  z.coerce
    .number({ message: `${label} must be a number.` })
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

export const calculationDefaultsSchema = z.object({
  mktActivationEnergyKjMol: decimal("Activation energy", 1, 500),
  f0ReferenceTempC: decimal("Reference temperature", 50, 200),
  f0ZValueC: decimal("z-value", 1, 50),
  sessionIdleMinutes: z.coerce.number().int().min(5).max(240),
});

/** Plain names for the audit trail. */
const SETTING_LABELS: Record<string, string> = {
  legalName: "legal name",
  shortName: "short name",
  address: "address",
  phone: "phone",
  email: "email",
  website: "website",
  gstin: "GSTIN",
  jobNumberFormat: "job number format",
  certificateNumberFormat: "certificate number format",
  mktActivationEnergyKjMol: "MKT activation energy",
  f0ReferenceTempC: "F0 reference temperature",
  f0ZValueC: "F0 z-value",
  sessionIdleMinutes: "inactivity sign-out time",
};

type SettingsPatch =
  | { section: "details"; values: z.input<typeof organisationDetailsSchema> }
  | { section: "numbers"; values: z.input<typeof numberFormatsSchema> }
  | { section: "calculations"; values: z.input<typeof calculationDefaultsSchema> };

function parsePatch(patch: SettingsPatch): Record<string, string | number> {
  switch (patch.section) {
    case "details":
      return organisationDetailsSchema.parse(patch.values);
    case "numbers":
      return numberFormatsSchema.parse(patch.values);
    case "calculations": {
      const v = calculationDefaultsSchema.parse(patch.values);
      return {
        mktActivationEnergyKjMol: v.mktActivationEnergyKjMol.toFixed(3),
        f0ReferenceTempC: v.f0ReferenceTempC.toFixed(2),
        f0ZValueC: v.f0ZValueC.toFixed(2),
        sessionIdleMinutes: v.sessionIdleMinutes,
      };
    }
  }
}

/** Update one section of the organisation settings; only changed fields are audited. */
export async function updateSettings(
  db: Database,
  actor: SessionUser,
  patch: SettingsPatch,
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "settings.manage");
  const values = parsePatch(patch);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(organisationSettings)
      .where(eq(organisationSettings.organisationId, actor.organisationId))
      .for("update");
    if (!current) throw new SettingsError("Settings are missing. Run the seed command.");

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      const old = current[key as keyof typeof current];
      if (String(old) !== String(value)) {
        before[key] = old;
        after[key] = value;
      }
    }
    const changed = Object.keys(after);
    if (changed.length === 0) return { changed };

    await tx
      .update(organisationSettings)
      .set({ ...after, updatedAt: new Date(), updatedByUserId: actor.id })
      .where(eq(organisationSettings.organisationId, actor.organisationId));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "settings.updated",
      entityType: "organisation_settings",
      entityId: actor.organisationId,
      summary: `${actor.name} changed ${changed.map((key) => SETTING_LABELS[key] ?? key).join(", ")}`,
      before,
      after,
      request,
    });
    return { changed };
  });
}

/**
 * The letterhead image printed across the top of reports, certificates and
 * sheets (a PNG or JPEG strip, as QA Tech's paper letterhead). null removes
 * it: the documents then print the organisation's name and address as text.
 */
export async function setLetterhead(
  db: Database,
  actor: SessionUser,
  fileId: string | null,
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "settings.manage");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(organisationSettings)
      .where(eq(organisationSettings.organisationId, actor.organisationId))
      .for("update");
    if (!current) throw new SettingsError("Settings are missing. Run the seed command.");
    let name = "";
    if (fileId) {
      const [file] = await tx
        .select()
        .from(storedFiles)
        .where(
          and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, actor.organisationId)),
        );
      if (!file) throw new SettingsError("That file was not uploaded.");
      if (!/^image\/(png|jpeg)$/.test(file.mimeType)) {
        throw new SettingsError(
          "Upload the letterhead as a PNG or JPEG image (a scan or export of the top strip of your letterhead).",
        );
      }
      name = file.firstFileName;
    }
    if (current.letterheadFileId === fileId) return;
    await tx
      .update(organisationSettings)
      .set({ letterheadFileId: fileId, updatedAt: new Date(), updatedByUserId: actor.id })
      .where(eq(organisationSettings.organisationId, actor.organisationId));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "settings.updated",
      entityType: "organisation_settings",
      entityId: actor.organisationId,
      summary: fileId
        ? `${actor.name} set the letterhead image (${name})`
        : `${actor.name} removed the letterhead image`,
      before: { letterheadFileId: current.letterheadFileId },
      after: { letterheadFileId: fileId },
      request,
    });
  });
}

export const siteSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, "Use 2–5 capital letters, e.g. BHW."),
  name: text(100).min(2, "Enter the site name."),
  address: text(500),
});

export async function createSite(
  db: Database,
  actor: SessionUser,
  input: z.input<typeof siteSchema>,
  request: RequestInfo,
): Promise<Site> {
  assertCan(actor, "settings.manage");
  const values = siteSchema.parse(input);
  return db.transaction(async (tx) => {
    const [site] = await tx
      .insert(sites)
      .values({ ...values, organisationId: actor.organisationId })
      .onConflictDoNothing({ target: [sites.organisationId, sites.code] })
      .returning();
    if (!site) throw new SettingsError(`A site with code ${values.code} already exists.`);
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "site.created",
      entityType: "site",
      entityId: site.id,
      summary: `${actor.name} added site ${site.code} (${site.name})`,
      after: values,
      request,
    });
    return site;
  });
}

/**
 * Sites can be renamed or switched off, but their code never changes: it is
 * part of every certificate number already issued for that site.
 */
export async function updateSite(
  db: Database,
  actor: SessionUser,
  input: { siteId: string; name: string; address: string; active: boolean },
  request: RequestInfo,
): Promise<void> {
  assertCan(actor, "settings.manage");
  const values = siteSchema.omit({ code: true }).parse(input);
  await db.transaction(async (tx) => {
    const [site] = await tx
      .select()
      .from(sites)
      .where(and(eq(sites.id, input.siteId), eq(sites.organisationId, actor.organisationId)))
      .for("update");
    if (!site) throw new SettingsError("That site does not exist.");
    const next = { ...values, active: input.active };
    await tx.update(sites).set(next).where(eq(sites.id, site.id));
    await recordAudit(tx, {
      organisationId: actor.organisationId,
      actor: { type: "user", userId: actor.id },
      action: "site.updated",
      entityType: "site",
      entityId: site.id,
      summary: `${actor.name} updated site ${site.code}${site.active !== input.active ? (input.active ? " (switched on)" : " (switched off)") : ""}`,
      before: { name: site.name, address: site.address, active: site.active },
      after: next,
      request,
    });
  });
}
