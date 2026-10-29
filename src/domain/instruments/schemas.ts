/**
 * Validation for instrument models, instruments and certificates. The same
 * schemas check forms and spreadsheet imports, on the server.
 */
import { z } from "zod";

import { cleanDecimal } from "./calibration-math";
import { INSTRUMENT_STATUSES, INSTRUMENT_TIERS, INSTRUMENT_TYPES, QUANTITIES } from "./types";

const bounded = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);
const text = (max: number) => bounded(max).default("");
const required = (max: number, message: string) => bounded(max).min(1, message);
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-26.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "That date does not exist.");
export const optionalIsoDate = z.preprocess(blankToNull, isoDate.nullable());

/** A decimal as typed ("−25.084"), kept as an exact string. */
export const decimalText = (label: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? v : (cleanDecimal(v) ?? v)),
    z
      .string({ message: `Enter ${label}.` })
      .regex(/^-?\d+(\.\d+)?$/, `${label} must be a number.`)
      .refine((v) => v.replace(/[-.]/g, "").length <= 15, `${label} has too many digits.`),
  );

const optionalPositive = (label: string, max: number) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number({ message: `${label} must be a number.` })
      .positive(`${label} must be more than 0.`)
      .max(max, `${label} must be at most ${max}.`)
      .nullable(),
  );

/** Accuracy as entered: one ± tolerance per quantity, optionally narrower in one band. */
export const accuracySchema = z
  .object({
    temperature: optionalPositive("Temperature accuracy", 100),
    temperatureBandFrom: z.preprocess(blankToNull, z.coerce.number().nullable()),
    temperatureBandTo: z.preprocess(blankToNull, z.coerce.number().nullable()),
    temperatureBandTolerance: optionalPositive("Accuracy inside the band", 100),
    humidity: optionalPositive("Humidity accuracy", 50),
    pressure: optionalPositive("Pressure accuracy", 1000),
  })
  .superRefine((v, ctx) => {
    const band = [v.temperatureBandFrom, v.temperatureBandTo, v.temperatureBandTolerance];
    if (band.some((x) => x !== null) && band.some((x) => x === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["temperatureBandTolerance"],
        message: "Fill in the band's from, to and accuracy, or leave all three empty.",
      });
    }
    if (
      v.temperatureBandFrom !== null &&
      v.temperatureBandTo !== null &&
      v.temperatureBandFrom >= v.temperatureBandTo
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["temperatureBandTo"],
        message: "The band's end must be above its start.",
      });
    }
  })
  .transform((v) => {
    const spec: import("./calibration-math").AccuracySpec = {};
    if (v.temperature !== null) {
      spec.temperature = {
        tolerance: v.temperature,
        bands:
          v.temperatureBandFrom !== null &&
          v.temperatureBandTo !== null &&
          v.temperatureBandTolerance !== null
            ? [
                {
                  from: v.temperatureBandFrom,
                  to: v.temperatureBandTo,
                  tolerance: v.temperatureBandTolerance,
                },
              ]
            : [],
      };
    }
    if (v.humidity !== null) spec.humidity = { tolerance: v.humidity };
    if (v.pressure !== null) spec.pressure = { tolerance: v.pressure };
    return spec;
  });

export const pointSchema = z.object({
  quantity: z.enum(QUANTITIES, { message: "Choose °C or %RH for each point." }),
  reference: z.string().trim().max(20),
  condition: text(40),
});

export const modelSchema = z.object({
  type: z.enum(INSTRUMENT_TYPES, { message: "Choose the instrument type." }),
  make: required(60, "Enter the make."),
  model: required(60, "Enter the model."),
  equipmentName: required(120, "Enter the name printed on certificates, e.g. Portable Datalogger."),
  quantities: z
    .array(z.enum(QUANTITIES))
    .min(1, "Choose what it measures.")
    .transform((list) => QUANTITIES.filter((q) => list.includes(q))),
  rangeText: text(120),
  resolutionText: text(80),
  accuracy: accuracySchema,
  accuracyText: text(300),
  calibrationSop: text(60),
  defaultPoints: z.array(pointSchema).max(20).default([]),
  intervalMonths: z.coerce.number().int().min(1).max(60).default(12),
});
/**
 * What a caller may pass: every field optional and unchecked, because the
 * schema (with its preprocessing) is the check. Fields listed in `Keep` stay typed.
 */
export type Loose<T, Keep extends keyof T = never> = { [K in Exclude<keyof T, Keep>]?: unknown } & {
  [K in Keep]: T[K];
};
export type ModelInput = Loose<z.input<typeof modelSchema>>;
export type ExternalCertificateInput = Loose<z.input<typeof externalCertificateSchema>>;

export const instrumentSchema = z.object({
  modelId: z.preprocess(blankToNull, z.string().uuid().nullable()),
  type: z.enum(INSTRUMENT_TYPES, { message: "Choose the instrument type." }),
  tier: z.enum(INSTRUMENT_TIERS).default("working"),
  code: required(40, "Enter QA Tech's ID number, e.g. E-TRH0524.").regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._/()-]*$/,
    "The ID can use letters, numbers, spaces and - _ . / ( ) only.",
  ),
  serialNo: text(60),
  make: text(60),
  model: text(60),
  equipmentName: text(120),
  rangeText: text(120),
  resolutionText: text(80),
  accuracyText: text(300),
  homeSiteId: z.preprocess(blankToNull, z.string().uuid().nullable()),
  ownerCompanyId: z.preprocess(blankToNull, z.string().uuid().nullable()),
  status: z.enum(INSTRUMENT_STATUSES).default("active"),
  intervalMonths: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(60).nullable()),
  notes: text(2000),
});
export type InstrumentInput = { [K in keyof z.input<typeof instrumentSchema>]?: unknown };

/** An outside lab's certificate for one or more instruments. */
export const externalCertificateSchema = z
  .object({
    number: required(80, "Enter the certificate number."),
    ulrNo: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .default("")
      .refine(
        (v) => v === "" || /^[A-Z]{2}\d{4,6}\d{2}\d{8}[FP]$/.test(v),
        "A NABL ULR number looks like CC287926000000394F.",
      ),
    labName: required(120, "Enter the laboratory's name."),
    labAccreditation: text(60),
    calibratedOn: isoDate,
    calibratedUntil: optionalIsoDate,
    validUntil: optionalIsoDate,
    issuedOn: optionalIsoDate,
    remarks: text(2000),
  })
  .superRefine((v, ctx) => {
    if (v.validUntil && v.validUntil < v.calibratedOn) {
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "The due date can't be before the calibration date.",
      });
    }
    if (v.calibratedUntil && v.calibratedUntil < v.calibratedOn) {
      ctx.addIssue({
        code: "custom",
        path: ["calibratedUntil"],
        message: "The last calibration day can't be before the first.",
      });
    }
  });

/** Header of a QA Tech (internal) calibration, the FT-05 top half. */
export const calibrationHeaderSchema = z.object({
  siteId: z.string().uuid("Choose the QA Tech site."),
  certificateKind: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,6}$/, "Choose the certificate kind."),
  calibratedOn: isoDate,
  validUntil: optionalIsoDate,
  customerCompanyId: z.preprocess(blankToNull, z.string().uuid().nullable()),
  title: text(200),
  location: text(120),
  department: text(120),
  equipmentName: required(120, "Enter the equipment name."),
  make: text(60),
  model: text(60),
  rangeText: text(120),
  resolutionText: text(80),
  accuracyText: text(300),
  sopNo: text(60),
  conditionOnReceipt: text(60),
  environmentTemperature: text(40),
  environmentHumidity: text(40),
  remarks: text(2000),
});
