/**
 * Validation for jobs, studies, readiness and the rate card, on the server.
 */
import { z } from "zod";

import { cyclesSchema } from "@/domain/clients/schemas";
import { isoDate, optionalIsoDate, type Loose } from "@/domain/instruments/schemas";

import { RATE_BASES, READINESS_ITEMS, SEASONS, WORK_TYPES } from "./types";

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

export const TEAM_ROLES = ["team_leader", "field_engineer", "report_preparer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  team_leader: "Team leader",
  field_engineer: "Field engineer",
  report_preparer: "Report preparer",
};

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

const headerFields = {
  siteId: z.preprocess(blankToNull, uuid("Pick a QA Tech site.").nullable()),
  title: text(160),
  poNumber: text(60),
  poDate: optionalIsoDate,
  poValue: money("PO value"),
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
});
export type StudyEditInput = Loose<z.input<typeof studyEditSchema>>;

export const readinessSchema = z.object({
  key: z.enum(READINESS_ITEMS),
  state: z.enum(["ready", "pending", "na"]),
  note: text(300),
});

export const teamInputSchema = teamSchema;

export const rateLineSchema = z.object({
  workType: z.enum(WORK_TYPES, { message: "Pick the work." }),
  equipmentType: text(40),
  durationHours: optionalInt("Duration", 1, 2000),
  basis: z.enum(RATE_BASES, { message: "Pick how it is charged." }),
  price: money("Price").refine((v) => v !== null, "Enter the price."),
  notes: text(300),
});
export type RateLineInput = Loose<z.input<typeof rateLineSchema>>;
