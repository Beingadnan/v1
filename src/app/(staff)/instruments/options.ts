import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { sites } from "@/db/schema";
import type { SessionUser } from "@/domain/auth/session-service";
import { listModels } from "@/domain/instruments/queries";

import type { ModelOption, Option } from "./instrument-dialogs";

/** QA Tech's own sites and the instrument models, for the instrument forms. */
export async function formOptions(
  actor: SessionUser,
): Promise<{ sites: Option[]; models: ModelOption[] }> {
  const [siteRows, models] = await Promise.all([
    db
      .select({ id: sites.id, code: sites.code, name: sites.name })
      .from(sites)
      .where(and(eq(sites.organisationId, actor.organisationId), eq(sites.active, true)))
      .orderBy(asc(sites.name)),
    listModels(db, actor),
  ]);
  return {
    sites: siteRows.map((s) => ({ id: s.id, label: `${s.name} (${s.code})` })),
    models: models.map((m) => ({
      id: m.id,
      type: m.type,
      make: m.make,
      model: m.model,
      equipmentName: m.equipmentName,
      rangeText: m.rangeText,
      resolutionText: m.resolutionText,
      accuracyText: m.accuracyText,
      calibrationSop: m.calibrationSop,
      intervalMonths: m.intervalMonths,
      quantities: m.quantities,
      accuracy: m.accuracy,
      defaultPoints: m.defaultPoints,
    })),
  };
}
