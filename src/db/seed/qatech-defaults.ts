import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { organisationSettings, sites } from "@/db/schema";

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
 * Fill QA Tech's letterhead details and sites. Only fills empty values, so it
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
  });
}
