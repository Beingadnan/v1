/**
 * Registers QA Tech's client companies and their sites from a JSON file
 * (e.g. derived from `fwtraceability_`). Idempotent: re-running skips
 * companies and sites that already exist.
 *
 *   npm run import:clients -- --file fixtures/clients/clients.json
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { createDatabase, createPool } from "@/db/client-factory";
import { clientCompanies, clientSites, type ClientCompany } from "@/db/schema";
import { insertCompany, insertSite } from "@/domain/clients/company-service";
import { companyNameKey } from "@/domain/clients/names";
import { clientSiteSchema, companySchema } from "@/domain/clients/schemas";

import { importActor } from "./import-actor";

type ClientEntry = {
  name: string;
  code: string;
  gstin?: string;
  address?: string;
  notes?: string;
  postCalRequired?: boolean;
  requalificationMonths?: number;
  paymentTermsDays?: number;
  reportNumberFormat?: string;
  sites?: Array<{
    name: string;
    code: string;
    address?: string;
    city?: string;
    state?: string;
    gstin?: string;
  }>;
};

type ClientsFile = {
  companies: ClientEntry[];
};

const DEFAULT_FORMAT = "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}";
const request = { ipAddress: "127.0.0.1", userAgent: "import-clients script" };

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { file: { type: "string" }, email: { type: "string" } },
  });
  if (!values.file) {
    throw new Error(
      "Usage: npm run import:clients -- --file <clients.json> [--email <admin email>]",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const data = JSON.parse(await readFile(values.file, "utf8")) as ClientsFile;
  const pool = createPool(url, 2);
  try {
    const db = createDatabase(pool);
    const actor = await importActor(db, values.email);
    const org = actor.organisationId;

    const existingCompanies = await db
      .select()
      .from(clientCompanies)
      .where(eq(clientCompanies.organisationId, org));
    const existingSites = await db
      .select()
      .from(clientSites)
      .where(eq(clientSites.organisationId, org));

    const byCode = new Map(existingCompanies.map((c) => [c.code.toLowerCase(), c]));
    const byNameKey = new Map(existingCompanies.map((c) => [companyNameKey(c.name), c]));
    const sitesByCompany = new Map<string, Set<string>>();
    for (const s of existingSites) {
      let set = sitesByCompany.get(s.companyId);
      if (!set) {
        set = new Set();
        sitesByCompany.set(s.companyId, set);
      }
      set.add(s.code.toLowerCase());
      set.add(s.name.toLowerCase());
    }

    let companiesAdded = 0;
    let sitesAdded = 0;

    await db.transaction(async (tx) => {
      for (const entry of data.companies) {
        const parsedCompany = companySchema.parse({
          name: entry.name,
          code: entry.code,
          gstin: entry.gstin ?? "",
          address: entry.address ?? "",
          notes: entry.notes ?? "",
          postCalRequired: entry.postCalRequired ?? false,
          requalificationMonths: entry.requalificationMonths ?? 12,
          paymentTermsDays: entry.paymentTermsDays ?? 45,
          reportNumberFormat: entry.reportNumberFormat ?? DEFAULT_FORMAT,
        });

        let company: ClientCompany | undefined =
          byCode.get(parsedCompany.code.toLowerCase()) ??
          byNameKey.get(companyNameKey(parsedCompany.name));

        if (!company) {
          company = await insertCompany(tx, actor, parsedCompany, request);
          byCode.set(company.code.toLowerCase(), company);
          byNameKey.set(companyNameKey(company.name), company);
          companiesAdded += 1;
        }

        const knownSites = sitesByCompany.get(company.id) ?? new Set<string>();
        sitesByCompany.set(company.id, knownSites);

        for (const siteEntry of entry.sites ?? []) {
          const parsedSite = clientSiteSchema.parse({
            name: siteEntry.name,
            code: siteEntry.code,
            address: siteEntry.address ?? "",
            city: siteEntry.city ?? "",
            state: siteEntry.state ?? "",
            gstin: siteEntry.gstin ?? "",
          });
          if (
            knownSites.has(parsedSite.code.toLowerCase()) ||
            knownSites.has(parsedSite.name.toLowerCase())
          ) {
            continue;
          }
          await insertSite(tx, actor, company, parsedSite, request);
          knownSites.add(parsedSite.code.toLowerCase());
          knownSites.add(parsedSite.name.toLowerCase());
          sitesAdded += 1;
        }
      }
    });

    console.log(
      `Clients: ${companiesAdded} added (${data.companies.length - companiesAdded} already present). Sites: ${sitesAdded} added.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
  console.error((e instanceof Error ? e.message : String(e)) + cause);
  process.exit(1);
});
