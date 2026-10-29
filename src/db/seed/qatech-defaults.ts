import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { instrumentModels, organisationSettings, sites } from "@/db/schema";

/** QA Tech's real details and branch sites (confirmed by the client, 28 Oct 2026). */
export const QATECH_SITES = [
  { code: "BHW", name: "Bhiwandi" },
  { code: "IND", name: "Indore" },
  { code: "BDD", name: "Baddi" },
  { code: "NGP", name: "Nagpur" },
  { code: "HDP", name: "Hadapsar" },
  { code: "SLK", name: "Sri Lanka" },
] as const;

/**
 * Logger models whose specifications are printed on QA Tech's own FT-05
 * certificates (ebro: PDL-17 of 26.03.2026; Testo: Zydus Ambernath, 24.08.2026).
 * Other models are added in Instruments → Models once their specs are confirmed.
 */
export const QATECH_MODELS = [
  {
    type: "portable_logger",
    make: "ebro",
    model: "EBI 20-TH1",
    equipmentName: "Temp. & RH Datalogger",
    quantities: ["temperature", "humidity"],
    rangeText: "-30 to 70 °C, 0 to 100 %RH",
    resolutionText: "0.1",
    accuracy: {
      temperature: { tolerance: 0.8, bands: [{ from: -20, to: 40, tolerance: 0.5 }] },
      humidity: { tolerance: 3 },
    },
    accuracyText:
      "± 0.5 °C (-20 to 40 °C), ± 0.8 °C for the remaining range & ± 3 % at 10 to 90 % RH",
    calibrationSop: "QATECH/CAL-026",
    defaultPoints: [
      { quantity: "temperature", reference: "-25", condition: "" },
      { quantity: "temperature", reference: "15", condition: "50 %RH" },
      { quantity: "temperature", reference: "60", condition: "" },
      { quantity: "humidity", reference: "20", condition: "25 °C" },
      { quantity: "humidity", reference: "50", condition: "25 °C" },
      { quantity: "humidity", reference: "90", condition: "25 °C" },
    ],
    intervalMonths: 12,
  },
  {
    type: "portable_logger",
    make: "Testo",
    model: "174H",
    equipmentName: "Portable Datalogger",
    quantities: ["temperature", "humidity"],
    rangeText: "-20 to 70 °C, 0 to 100 %RH",
    resolutionText: "0.1 °C, 0.1 %RH",
    accuracy: { temperature: { tolerance: 0.5 }, humidity: { tolerance: 3 } },
    accuracyText: "± 0.5 °C (-20 to 70 °C), ± 3 %RH (2 %RH to 98 %RH) at 25 °C",
    calibrationSop: "QATECH/CAL-026",
    defaultPoints: [
      { quantity: "temperature", reference: "-20", condition: "" },
      { quantity: "temperature", reference: "15", condition: "50 %RH" },
      { quantity: "temperature", reference: "65", condition: "" },
      { quantity: "humidity", reference: "20", condition: "25 °C" },
      { quantity: "humidity", reference: "65", condition: "25 °C" },
      { quantity: "humidity", reference: "87", condition: "25 °C" },
    ],
    intervalMonths: 12,
  },
] as const;

/**
 * Fill QA Tech's letterhead details, sites and logger models. Only fills empty values, so it
 * never overwrites changes an admin made in Settings. Safe to run repeatedly.
 */
export async function ensureQatechDefaults(db: Database, organisationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(organisationSettings)
      .where(eq(organisationSettings.organisationId, organisationId))
      .for("update");
    if (settings && settings.address === "") {
      await tx
        .update(organisationSettings)
        .set({
          legalName: "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)",
          shortName: "QA Tech",
          address:
            "Gala No. 1 & 2, 1st Floor, Bldg. No. F-6, Angel Logistic Park, Thane - Nasik Highway, Village - Pimplas, Near Kalyan Phata, Taluka - Bhiwandi, Dist: Thane - 421 302",
          phone: "+91 98338 62756 / 98339 74756",
          email: "admin@qatech.co.in",
          website: "www.qatech.co.in",
          gstin: "27AAACQ1042P1ZB",
        })
        .where(eq(organisationSettings.organisationId, organisationId));
    }
    await tx
      .insert(sites)
      .values(QATECH_SITES.map((site) => ({ ...site, organisationId })))
      .onConflictDoNothing({ target: [sites.organisationId, sites.code] });
    // Models: added only if missing (unique on make + model), never overwritten.
    for (const model of QATECH_MODELS) {
      await tx
        .insert(instrumentModels)
        .values({
          ...model,
          organisationId,
          quantities: [...model.quantities],
          defaultPoints: model.defaultPoints.map((p) => ({ ...p })),
          accuracy: JSON.parse(JSON.stringify(model.accuracy)),
        })
        .onConflictDoNothing();
    }
  });
}
