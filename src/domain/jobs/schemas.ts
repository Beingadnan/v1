/**
 * Validation for jobs, studies and readiness, on the server.
 */
import { z } from "zod";

import { cyclesSchema, yesNo } from "@/domain/clients/schemas";
import { isoDate, optionalIsoDate, type Loose } from "@/domain/instruments/schemas";

import { CONTRACT_TYPES, ORDER_TYPES, READINESS_ITEMS, SEASONS, WORK_TYPES } from "./types";

const bounded = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);
const text = (max: number) => bounded(max).default("");
const blankToNull = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;
const uuid = (message: string) => z.string().uuid(message);

const MULTIPLIERS: [RegExp, number][] = [
  [/^(cr|crore|crores)$/, 10_000_000],
  [/^(l|lac|lacs|lakh|lakhs)$/, 100_000],
  [/^(k|thousand)$/, 1_000],
];

/**
 * Rupees the way people type them: "₹1,25,000", "Rs. 18,000/-", "INR 4500.50",
 * "15k", "1.5 lakh", "2 cr". Anything else is refused.
 */
export function parseRupees(text: string): number | string {
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/\/-\s*$/, "")
    .replace(/^(₹|rs\.?|inr)\s*/, "")
    .replace(/,/g, "")
    .trim();
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(clean);
  if (!match) return text;
  const [, amount, unit] = match;
  if (!unit) return Number(amount);
  const multiplier = MULTIPLIERS.find(([re]) => re.test(unit!))?.[1];
  return multiplier ? Math.round(Number(amount) * multiplier * 100) / 100 : text;
}

export const money = (label: string) =>
  z.preprocess(
    (v) => {
      const clean = blankToNull(v);
      return typeof clean === "string" ? parseRupees(clean) : clean;
    },
    z
      .number({ message: `${label} must be an amount in rupees, like 18000, 18,000 or 1.5 lakh.` })
      .min(0, `${label} can't be negative.`)
      .max(1_000_000_000, `${label} is too large.`)
      .nullable(),
  );

const optionalInt = (label: string, min: number, max: number) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number({ message: `${label} must be a whole number.` })
      .int(`${label} must be a whole number.`)
      .min(min, `${label} must be at least ${min}.`)
      .max(max, `${label} must be at most ${max}.`)
      .nullable(),
  );

export { TEAM_ROLES, TEAM_ROLE_LABELS, type TeamRole } from "./types";
import { TEAM_ROLES } from "./types";

const teamSchema = z
  .array(z.object({ userId: uuid("Pick a person."), role: z.enum(TEAM_ROLES) }))
  .max(30, "At most 30 people on a job.")
  .default([]);

/** Longest a single job may be planned for; longer work is split into jobs. */
const MAX_DAYS = 120;

const dates = <T extends { plannedStart: string; plannedEnd: string }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.plannedEnd < v.plannedStart) {
    ctx.addIssue({
      code: "custom",
      path: ["plannedEnd"],
      message: "The end date is before the start.",
    });
  }
  const days = (Date.parse(v.plannedEnd) - Date.parse(v.plannedStart)) / 86_400_000;
  if (days > MAX_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["plannedEnd"],
      message: `Plan at most ${MAX_DAYS} days per job. Check the year of the dates.`,
    });
  }
};

/** The client's order: a PO or SRF of its own, or an ARC/AMC on the client that covers the job. */
const orderFields = {
  orderType: z.enum(ORDER_TYPES, { message: "Pick PO, SRF, ARC or AMC." }).default("po"),
  poNumber: text(60),
  poDate: optionalIsoDate,
  poValue: money("Order value"),
  contractId: z.preprocess(blankToNull, uuid("Pick the contract.").nullable()).default(null),
};

const headerFields = {
  siteId: z.preprocess(blankToNull, uuid("Pick a QA Tech site.").nullable()),
  title: text(160),
  ...orderFields,
  quotedValue: money("Quoted value"),
  plannedStart: isoDate,
  plannedEnd: isoDate,
  notes: text(2000),
};

export const studyOptionsSchema = z.object({
  equipmentId: uuid("Pick equipment."),
  workType: z.enum(WORK_TYPES).optional(),
  loggerCount: optionalInt("Loggers", 0, 500).optional(),
  cycles: cyclesSchema.optional(),
  season: z.enum(SEASONS).optional(),
  /** Yes/no per study; the client's SOP decides when left out. */
  preCal: yesNo.optional(),
  postCal: yesNo.optional(),
});

export const jobSchema = z
  .object({
    companyId: uuid("Pick a client."),
    clientSiteId: uuid("Pick the client's site."),
    ...headerFields,
    team: teamSchema,
    items: z
      .array(studyOptionsSchema)
      .min(1, "Pick at least one equipment item.")
      .max(200, "At most 200 items per job."),
  })
  .superRefine(dates);
export type JobInput = Loose<z.input<typeof jobSchema>>;

export const jobHeaderSchema = z.object(headerFields).superRefine(dates);

/** Recording the order when it comes, after the job was made; the copy is optional. */
export const orderSchema = z.object({
  ...orderFields,
  fileId: z.preprocess(blankToNull, uuid("Upload the copy again.").nullable()).default(null),
});
export type OrderInput = Loose<z.input<typeof orderSchema>>;

/** An ARC or AMC on a client. */
export const contractSchema = z
  .object({
    kind: z.enum(CONTRACT_TYPES, { message: "Pick ARC or AMC." }),
    number: bounded(60).min(1, "Enter the contract number."),
    validFrom: isoDate,
    validTo: isoDate,
    value: money("Contract value"),
    fileId: z.preprocess(blankToNull, uuid("Upload the copy again.").nullable()).default(null),
    notes: text(500),
  })
  .superRefine((v, ctx) => {
    if (v.validTo < v.validFrom) {
      ctx.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "The contract can't end before it starts.",
      });
    }
  });
export type ContractInput = Loose<z.input<typeof contractSchema>>;
export type JobHeaderInput = Loose<z.input<typeof jobHeaderSchema>>;

export const studyEditSchema = z.object({
  workType: z.enum(WORK_TYPES),
  loggerCount: z.coerce
    .number({ message: "Loggers must be a whole number." })
    .int("Loggers must be a whole number.")
    .min(0, "Loggers can't be negative.")
    .max(500, "At most 500 loggers per study."),
  cycles: cyclesSchema,
  season: z.enum(SEASONS).default(""),
  durationHours: optionalInt("Duration", 1, 2000),
  intervalMinutes: optionalInt("Interval", 1, 1440),
  preCalRequired: yesNo,
  postCalRequired: yesNo,
});
export type StudyEditInput = Loose<z.input<typeof studyEditSchema>>;

export const readinessSchema = z.object({
  key: z.enum(READINESS_ITEMS),
  state: z.enum(["ready", "pending", "na"]),
  note: text(300),
});

export const teamInputSchema = teamSchema;
