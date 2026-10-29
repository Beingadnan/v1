import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "@/db/client-factory";
import {
  clientCompanies,
  instrumentModels,
  instruments,
  sites,
  type Instrument,
  type InstrumentModel,
} from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { diff, isUuid, rethrowUnique } from "@/domain/clients/shared";
import { recordAudit } from "@/lib/audit";

import { InstrumentsError } from "./errors";
import { instrumentSchema, modelSchema, type InstrumentInput, type ModelInput } from "./schemas";
import { INSTRUMENT_TYPE_INFO } from "./types";

const MODEL_UNIQUE = { instrument_models_org_make_model_key: "This make and model already exist." };
const INSTRUMENT_UNIQUE = {
  instruments_org_code_key: "Another instrument already has this ID number.",
  instruments_org_serial_key: "Another instrument of this make already has this serial number.",
};

const user = (actor: SessionUser) => ({ type: "user" as const, userId: actor.id });

async function guarded<T>(messages: Record<string, string>, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    rethrowUnique(error, messages);
  }
}

// ---------------------------------------------------------------- models

export async function saveModel(
  db: Database,
  actor: SessionUser,
  modelId: string | null,
  input: ModelInput,
  request: RequestInfo,
): Promise<InstrumentModel> {
  assertCan(actor, "instruments.manage");
  const values = modelSchema.parse(input);
  return guarded(MODEL_UNIQUE, () =>
    db.transaction(async (tx) => {
      if (!modelId) {
        const [row] = await tx
          .insert(instrumentModels)
          .values({ ...values, organisationId: actor.organisationId, createdByUserId: actor.id })
          .returning();
        if (!row) throw new Error("Model insert returned no row");
        await recordAudit(tx, {
          organisationId: actor.organisationId,
          actor: user(actor),
          action: "instrument_model.created",
          entityType: "instrument_model",
          entityId: row.id,
          summary: `${actor.name} added model ${row.make} ${row.model}`,
          after: values,
          request,
        });
        return row;
      }
      if (!isUuid(modelId)) throw new InstrumentsError("That model does not exist.");
      const [current] = await tx
        .select()
        .from(instrumentModels)
        .where(
          and(
            eq(instrumentModels.id, modelId),
            eq(instrumentModels.organisationId, actor.organisationId),
          ),
        )
        .for("update");
      if (!current) throw new InstrumentsError("That model does not exist.");
      const comparable = {
        ...values,
        accuracy: JSON.stringify(values.accuracy),
        defaultPoints: JSON.stringify(values.defaultPoints),
        quantities: values.quantities.join(","),
      };
      const { before, after, changed } = diff(
        {
          ...current,
          accuracy: JSON.stringify(current.accuracy),
          defaultPoints: JSON.stringify(current.defaultPoints),
          quantities: current.quantities.join(","),
        },
        comparable,
      );
      if (changed.length === 0) return current;
      const [row] = await tx
        .update(instrumentModels)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(instrumentModels.id, current.id))
        .returning();
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "instrument_model.updated",
        entityType: "instrument_model",
        entityId: current.id,
        summary: `${actor.name} changed ${changed.join(", ")} of model ${values.make} ${values.model}`,
        before,
        after,
        request,
      });
      return row!;
    }),
  );
}

// ---------------------------------------------------------------- instruments

async function checkReferences(
  tx: Transaction,
  actor: SessionUser,
  values: z.output<typeof instrumentSchema>,
): Promise<InstrumentModel | null> {
  if (values.homeSiteId) {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, values.homeSiteId), eq(sites.organisationId, actor.organisationId)));
    if (!site) throw new InstrumentsError("Choose one of QA Tech's sites.");
  }
  if (values.ownerCompanyId) {
    const [owner] = await tx
      .select({ id: clientCompanies.id })
      .from(clientCompanies)
      .where(
        and(
          eq(clientCompanies.id, values.ownerCompanyId),
          eq(clientCompanies.organisationId, actor.organisationId),
        ),
      );
    if (!owner) throw new InstrumentsError("Choose one of the clients.");
  }
  if (!values.modelId) return null;
  const [model] = await tx
    .select()
    .from(instrumentModels)
    .where(
      and(
        eq(instrumentModels.id, values.modelId),
        eq(instrumentModels.organisationId, actor.organisationId),
      ),
    );
  if (!model) throw new InstrumentsError("Choose one of the models.");
  return model;
}

/** Blank make/model/name/range/accuracy text come from the model. */
function withModelDefaults(
  values: z.output<typeof instrumentSchema>,
  model: InstrumentModel | null,
): z.output<typeof instrumentSchema> {
  if (!model) return values;
  return {
    ...values,
    type: model.type as typeof values.type,
    make: values.make || model.make,
    model: values.model || model.model,
    equipmentName: values.equipmentName || model.equipmentName,
    rangeText: values.rangeText || model.rangeText,
    resolutionText: values.resolutionText || model.resolutionText,
    accuracyText: values.accuracyText || model.accuracyText,
  };
}

export async function insertInstrument(
  tx: Transaction,
  actor: SessionUser,
  input: z.output<typeof instrumentSchema>,
  request: RequestInfo,
): Promise<Instrument> {
  const model = await checkReferences(tx, actor, input);
  const values = withModelDefaults(input, model);
  const [row] = await tx
    .insert(instruments)
    .values({ ...values, organisationId: actor.organisationId, createdByUserId: actor.id })
    .returning();
  if (!row) throw new Error("Instrument insert returned no row");
  await recordAudit(tx, {
    organisationId: actor.organisationId,
    actor: user(actor),
    action: "instrument.created",
    entityType: "instrument",
    entityId: row.id,
    summary: `${actor.name} added ${INSTRUMENT_TYPE_INFO[values.type].label.toLowerCase()} ${row.code}${row.serialNo ? ` (serial ${row.serialNo})` : ""}`,
    after: values,
    request,
  });
  return row;
}

export async function createInstrument(
  db: Database,
  actor: SessionUser,
  input: InstrumentInput,
  request: RequestInfo,
): Promise<Instrument> {
  assertCan(actor, "instruments.manage");
  const values = instrumentSchema.parse(input);
  return guarded(INSTRUMENT_UNIQUE, () =>
    db.transaction((tx) => insertInstrument(tx, actor, values, request)),
  );
}

export async function updateInstrument(
  db: Database,
  actor: SessionUser,
  instrumentId: string,
  input: InstrumentInput & { reason?: unknown },
  request: RequestInfo,
): Promise<{ changed: string[] }> {
  assertCan(actor, "instruments.manage");
  const parsed = instrumentSchema.parse(input);
  if (!isUuid(instrumentId)) throw new InstrumentsError("That instrument does not exist.");
  return guarded(INSTRUMENT_UNIQUE, () =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(instruments)
        .where(
          and(
            eq(instruments.id, instrumentId),
            eq(instruments.organisationId, actor.organisationId),
          ),
        )
        .for("update");
      if (!current) throw new InstrumentsError("That instrument does not exist.");
      const model = await checkReferences(tx, actor, parsed);
      const values = withModelDefaults(parsed, model);
      const { before, after, changed } = diff(current, values);
      if (changed.length === 0) return { changed };
      // Taking an instrument out of use is a decision that needs a reason.
      const reason =
        typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined;
      if (changed.includes("status") && values.status !== "active" && !reason) {
        throw new InstrumentsError("Give a reason for taking this instrument out of use.");
      }
      await tx
        .update(instruments)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(instruments.id, current.id));
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actor: user(actor),
        action: "instrument.updated",
        entityType: "instrument",
        entityId: current.id,
        summary: `${actor.name} changed ${changed.join(", ")} of ${values.code}`,
        before,
        after,
        reason,
        request,
      });
      return { changed };
    }),
  );
}

/**
 * Next IDs in a series: "E-TRH0533" → E-TRH0534, E-TRH0535… keeping the
 * zero padding. Used when a batch of new loggers arrives.
 */
export function nextCodes(lastCode: string, count: number): string[] {
  const match = /^(.*?)(\d+)$/.exec(lastCode.trim());
  if (!match) return [];
  const [, prefix = "", digits = "0"] = match;
  const start = Number(digits);
  return Array.from(
    { length: count },
    (_, i) => `${prefix}${String(start + i + 1).padStart(digits.length, "0")}`,
  );
}

/** The highest existing ID with this prefix, e.g. "E-TRH" → "E-TRH0533". */
export async function lastCodeWithPrefix(
  tx: Transaction | Database,
  organisationId: string,
  prefix: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ code: instruments.code })
    .from(instruments)
    .where(
      and(
        eq(instruments.organisationId, organisationId),
        sql`${instruments.code} ~ ${`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[0-9]+$`}`,
      ),
    )
    .orderBy(sql`length(${instruments.code}) desc`, sql`${instruments.code} desc`)
    .limit(1);
  return row?.code ?? null;
}

export const bulkAddSchema = z.object({
  modelId: z.string().uuid("Choose the model."),
  homeSiteId: z.preprocess(blankToNullish, z.string().uuid().nullable()),
  /** Serial numbers, one per line or separated by commas/spaces (pasted from Excel). */
  serials: z.string().max(20000),
  /** ID prefix for the new loggers, e.g. "E-TRH". IDs continue from the highest one. */
  codePrefix: z
    .string()
    .trim()
    .min(1, "Enter the ID prefix, e.g. E-TRH.")
    .max(20)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, numbers and - _ . / only."),
  tier: z.enum(["working", "master"]).default("working"),
});

function blankToNullish(v: unknown) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;
}

/** Splits pasted text into serial numbers; keeps order, drops blanks and repeats. */
export function parseSerials(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/**
 * A batch of new loggers of one model: paste the serials, get consecutive IDs.
 * All or nothing; existing serials are refused with their row.
 */
export async function bulkAddInstruments(
  db: Database,
  actor: SessionUser,
  input: z.input<typeof bulkAddSchema>,
  request: RequestInfo,
): Promise<Instrument[]> {
  assertCan(actor, "instruments.manage");
  const values = bulkAddSchema.parse(input);
  const serials = parseSerials(values.serials);
  if (serials.length === 0) throw new InstrumentsError("Paste at least one serial number.");
  if (serials.length > 500) throw new InstrumentsError("Add at most 500 instruments at a time.");
  if (serials.some((s) => s.length > 60))
    throw new InstrumentsError("A serial number is too long.");
  return guarded(INSTRUMENT_UNIQUE, () =>
    db.transaction(async (tx) => {
      // One batch at a time per prefix, so two people can't take the same IDs.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`instrument-codes:${actor.organisationId}:${values.codePrefix.toLowerCase()}`}))`,
      );
      const last =
        (await lastCodeWithPrefix(tx, actor.organisationId, values.codePrefix)) ??
        `${values.codePrefix}0000`;
      const codes = nextCodes(last, serials.length);
      const created: Instrument[] = [];
      for (const [i, serialNo] of serials.entries()) {
        created.push(
          await insertInstrument(
            tx,
            actor,
            instrumentSchema.parse({
              modelId: values.modelId,
              type: "other", // replaced by the model's type
              tier: values.tier,
              code: codes[i],
              serialNo,
              homeSiteId: values.homeSiteId,
            }),
            request,
          ),
        );
      }
      return created;
    }),
  );
}
