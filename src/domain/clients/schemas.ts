/**
 * Validation for client companies, sites, departments, contacts and equipment.
 * The same schemas check form submissions and Excel import rows, on the server.
 */
import { z } from "zod";

import { EQUIPMENT_TYPES } from "./equipment-types";
import { checkGstin } from "./gstin";
import { checkReportNumberFormat } from "./report-number";
import { STUDY_CYCLES } from "./study-defaults";

const bounded = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);
/** Optional text: a missing value is the same as an empty one. */
const text = (max: number) => bounded(max).default("");
const required = (max: number, message: string) => bounded(max).min(1, message);

const blankToNull = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    ? null
    : value;

/** Optional number from a form field or spreadsheet cell; "" becomes null. */
const optionalNumber = (label: string, min: number, max: number) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number({ message: `${label} must be a number.` })
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} must be at most ${max}.`)
      .nullable(),
  );

const optionalInteger = (label: string, min: number, max: number) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number({ message: `${label} must be a whole number.` })
      .int(`${label} must be a whole number.`)
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} must be at most ${max}.`)
      .nullable(),
  );

/** Checkbox ("on"), "true", "yes", "y", true → true. */
export const yesNo = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["on", "true", "yes", "y", "1"].includes(value.trim().toLowerCase());
}, z.boolean());

/** Empty, or a GSTIN whose state code and check character are right. */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((value, ctx) => {
    if (value === "") return;
    const check = checkGstin(value);
    if (!check.ok) ctx.addIssue({ code: "custom", message: check.message });
  });

/** Checkbox groups and spreadsheet lists ("Empty, Door open") → known cycle ids. */
export const cyclesSchema = z.preprocess(
  (value) => {
    const items = Array.isArray(value)
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? value.split(/[,;\n]+/)
        : [];
    return items.map((item) =>
      String(item)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
    );
  },
  z
    .array(
      z.enum(STUDY_CYCLES, { message: "Cycles can be Empty, Loaded, Door open or Power failure." }),
    )
    .transform((list) => STUDY_CYCLES.filter((c) => list.includes(c))),
);

/** Codes go into report numbers: letters, digits, spaces, - _ . & ( ). */
const code = (label: string) =>
  required(40, `Enter the ${label}.`).regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._&()-]*$/,
    `The ${label} can use letters, numbers, spaces and - _ . & ( ) only.`,
  );

export const companySchema = z.object({
  name: required(200, "Enter the company name."),
  code: code("short name"),
  gstin: gstinSchema,
  address: text(500),
  notes: text(2000),
  postCalRequired: yesNo,
  requalificationMonths: z.coerce
    .number({ message: "Requalification interval must be a number of months." })
    .int("Use whole months.")
    .min(1, "Requalification interval must be at least 1 month.")
    .max(60, "Requalification interval must be at most 60 months."),
  reportNumberFormat: text(120).superRefine((value, ctx) => {
    const check = checkReportNumberFormat(value);
    if (!check.ok) ctx.addIssue({ code: "custom", message: check.message });
  }),
});
export type CompanyInput = z.input<typeof companySchema>;

export const clientSiteSchema = z
  .object({
    name: required(100, "Enter the site name."),
    code: code("site code"),
    address: text(500),
    city: text(100),
    state: text(100),
    gstin: gstinSchema,
  })
  // The GSTIN's first two digits name the state: fill it in when left empty.
  .transform((site) => {
    if (site.state || !site.gstin) return site;
    const check = checkGstin(site.gstin);
    return check.ok ? { ...site, state: check.state } : site;
  });
export type ClientSiteInput = z.input<typeof clientSiteSchema>;

export const departmentSchema = z.object({
  name: required(100, "Enter the department name."),
});

export const contactSchema = z.object({
  siteId: z.preprocess(blankToNull, z.string().uuid().nullable()),
  name: required(120, "Enter the contact's name."),
  designation: text(120),
  email: z.union([
    z.literal(""),
    z.string().trim().toLowerCase().email("Enter a valid email address."),
  ]),
  phone: text(60),
  signatory: z.preprocess(blankToNull, z.enum(["reviewed_by", "approved_by"]).nullable()),
});
export type ContactInput = z.input<typeof contactSchema>;

const isoDate = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-05-23.")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That date does not exist.")
    .nullable(),
);

const equipmentFields = {
  siteId: z.string().uuid("Choose the site."),
  departmentId: z.preprocess(blankToNull, z.string().uuid().nullable()),
  code: required(60, "Enter the equipment ID.").regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._/()-]*$/,
    "The equipment ID can use letters, numbers, spaces and - _ . / ( ) only.",
  ),
  name: required(200, "Enter the equipment name."),
  type: z.enum(EQUIPMENT_TYPES, { message: "Choose the equipment type." }),
  location: text(200),
  make: text(100),
  model: text(100),
  serialNo: text(100),
  lengthM: optionalNumber("Length", 0.01, 10000),
  widthM: optionalNumber("Width", 0.01, 10000),
  heightM: optionalNumber("Height", 0.01, 1000),
  setPointC: optionalNumber("Set point", -273, 1000),
  tempMinC: optionalNumber("Lowest temperature", -273, 1000),
  tempMaxC: optionalNumber("Highest temperature", -273, 1000),
  rhMinPct: optionalNumber("Lowest RH", 0, 100),
  rhMaxPct: optionalNumber("Highest RH", 0, 100),
  defaultChannels: optionalInteger("Number of loggers", 1, 500),
  readingIntervalMinutes: optionalInteger("Reading interval", 1, 1440),
  studyDurationHours: optionalInteger("Study duration", 1, 2160),
  requalificationMonths: optionalInteger("Requalification interval", 1, 60),
  lastStudyOn: isoDate,
  cycles: cyclesSchema,
  seasonalMapping: yesNo,
  notes: text(2000),
};

type Limits = {
  setPointC: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  rhMinPct: number | null;
  rhMaxPct: number | null;
};

/** Limits the right way round and the set point inside them. Shared with type defaults. */
export function checkLimits(v: Limits, ctx: z.RefinementCtx): void {
  if (v.tempMinC !== null && v.tempMaxC !== null && v.tempMinC >= v.tempMaxC) {
    ctx.addIssue({
      code: "custom",
      path: ["tempMaxC"],
      message: "The highest temperature must be above the lowest.",
    });
  }
  if (v.rhMinPct !== null && v.rhMaxPct !== null && v.rhMinPct >= v.rhMaxPct) {
    ctx.addIssue({
      code: "custom",
      path: ["rhMaxPct"],
      message: "The highest RH must be above the lowest.",
    });
  }
  if (
    v.setPointC !== null &&
    ((v.tempMinC !== null && v.setPointC < v.tempMinC) ||
      (v.tempMaxC !== null && v.setPointC > v.tempMaxC))
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["setPointC"],
      message: "The set point is outside the acceptance limits.",
    });
  }
}

export const equipmentSchema = z.object(equipmentFields).superRefine((v, ctx) => {
  checkLimits(v, ctx);
  if (v.lastStudyOn && v.lastStudyOn > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({
      code: "custom",
      path: ["lastStudyOn"],
      message: "The last study can't be in the future.",
    });
  }
});

/** Per-type defaults (Settings): the study fields of equipment, same rules. */
export const typeDefaultsSchema = z
  .object({
    setPointC: equipmentFields.setPointC,
    tempMinC: equipmentFields.tempMinC,
    tempMaxC: equipmentFields.tempMaxC,
    rhMinPct: equipmentFields.rhMinPct,
    rhMaxPct: equipmentFields.rhMaxPct,
    defaultChannels: equipmentFields.defaultChannels,
    readingIntervalMinutes: equipmentFields.readingIntervalMinutes,
    studyDurationHours: equipmentFields.studyDurationHours,
    requalificationMonths: equipmentFields.requalificationMonths,
    cycles: equipmentFields.cycles,
    seasonalMapping: equipmentFields.seasonalMapping,
  })
  .superRefine(checkLimits);
/** Raw form or spreadsheet values; the schema decides what is acceptable. */
export type EquipmentInput = { [K in keyof z.input<typeof equipmentSchema>]?: unknown };
export type EquipmentValues = z.output<typeof equipmentSchema>;
