/**
 * Idempotently imports additional client sites, departments, equipment and
 * client-owned instruments extracted from fwtraceability_ into PostgreSQL.
 *
 *   npm run import:client-assets -- --file fixtures/clients/client-assets.json
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, createPool } from "@/db/client-factory";
import { clientCompanies, clientDepartments, clientSites, equipment } from "@/db/schema/clients";
import { instruments } from "@/db/schema/instruments";
import { insertDepartment, insertSite } from "@/domain/clients/company-service";
import { insertEquipment } from "@/domain/clients/equipment-service";
import { clientSiteSchema, departmentSchema, equipmentSchema } from "@/domain/clients/schemas";
import { insertInstrument } from "@/domain/instruments/instrument-service";
import { instrumentSchema } from "@/domain/instruments/schemas";

import { importActor } from "./import-actor";

const assetsFileSchema = z.object({
  sites: z
    .array(
      z.object({
        companyCode: z.string().min(1),
        name: z.string().min(1),
        code: z.string().min(1),
        city: z.string().optional(),
        state: z.string().optional(),
        address: z.string().optional(),
        gstin: z.string().optional(),
      }),
    )
    .default([]),
  departments: z
    .array(
      z.object({
        companyCode: z.string().min(1),
        siteName: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .default([]),
  equipment: z
    .array(
      z.object({
        companyCode: z.string().min(1),
        siteName: z.string().min(1),
        departmentName: z.string().nullable().optional(),
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        location: z.string().optional(),
        make: z.string().optional(),
        model: z.string().optional(),
        serialNo: z.string().optional(),
        lengthM: z.number().nullable().optional(),
        widthM: z.number().nullable().optional(),
        heightM: z.number().nullable().optional(),
        setPointC: z.number().nullable().optional(),
        tempMinC: z.number().nullable().optional(),
        tempMaxC: z.number().nullable().optional(),
        rhMinPct: z.number().nullable().optional(),
        rhMaxPct: z.number().nullable().optional(),
        defaultChannels: z.number().int().nullable().optional(),
        readingIntervalMinutes: z.number().int().nullable().optional(),
        studyDurationHours: z.number().int().nullable().optional(),
        requalificationMonths: z.number().int().nullable().optional(),
        lastStudyOn: z.string().nullable().optional(),
        cycles: z.array(z.string()).optional(),
        seasonalMapping: z.boolean().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  instruments: z
    .array(
      z.object({
        ownerCompanyCode: z.string().min(1),
        code: z.string().min(1),
        type: z.string().min(1),
        tier: z.string().min(1),
        make: z.string().optional(),
        model: z.string().optional(),
        serialNo: z.string().optional(),
        equipmentName: z.string().optional(),
        rangeText: z.string().optional(),
        resolutionText: z.string().optional(),
        accuracyText: z.string().optional(),
        intervalMonths: z.number().int().min(1).max(60),
        calibratedOn: z.string().nullable().optional(),
        dueOn: z.string().nullable().optional(),
        status: z.string().min(1),
        notes: z.string().optional(),
      }),
    )
    .default([]),
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string", default: "fixtures/clients/client-assets.json" },
      email: { type: "string" },
    },
  });

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const raw = await readFile(values.file, "utf8");
  const data = assetsFileSchema.parse(JSON.parse(raw));
  const request = { ip: null, userAgent: "cli:import-client-assets" };

  const pool = createPool(url, 2);
  try {
    const db = createDatabase(pool);
    const actor = await importActor(db, values.email);

    const counts = {
      sitesAdded: 0,
      sitesSkipped: 0,
      departmentsAdded: 0,
      departmentsSkipped: 0,
      equipmentAdded: 0,
      equipmentSkipped: 0,
      instrumentsAdded: 0,
      instrumentsSkipped: 0,
    };

    await db.transaction(async (tx) => {
      const companies = await tx
        .select()
        .from(clientCompanies)
        .where(eq(clientCompanies.organisationId, actor.organisationId));
      const companyByCode = new Map(companies.map((c) => [c.code.toLowerCase(), c]));

      function requireCompany(code: string) {
        const c = companyByCode.get(code.toLowerCase());
        if (!c) throw new Error(`Client company not found: ${code}`);
        return c;
      }

      const existingSites = await tx
        .select()
        .from(clientSites)
        .where(eq(clientSites.organisationId, actor.organisationId));
      const siteByNameKey = new Map(
        existingSites.map((s) => [`${s.companyId}::${s.name.toLowerCase()}`, s]),
      );
      const siteByCodeKey = new Map(
        existingSites.map((s) => [`${s.companyId}::${s.code.toLowerCase()}`, s]),
      );

      for (const s of data.sites) {
        const company = requireCompany(s.companyCode);
        const nameKey = `${company.id}::${s.name.toLowerCase()}`;
        const codeKey = `${company.id}::${s.code.toLowerCase()}`;
        if (siteByNameKey.has(nameKey) || siteByCodeKey.has(codeKey)) {
          counts.sitesSkipped++;
          continue;
        }
        const created = await insertSite(
          tx,
          actor,
          company,
          clientSiteSchema.parse({
            name: s.name,
            code: s.code,
            city: s.city ?? "",
            state: s.state ?? "",
            address: s.address ?? "",
            gstin: s.gstin ?? "",
          }),
          request,
        );
        siteByNameKey.set(nameKey, created);
        siteByCodeKey.set(codeKey, created);
        counts.sitesAdded++;
      }

      function requireSite(companyId: string, siteName: string) {
        const s = siteByNameKey.get(`${companyId}::${siteName.toLowerCase()}`);
        if (!s) throw new Error(`Client site not found: ${siteName} for company ${companyId}`);
        return s;
      }

      const existingDepts = await tx
        .select()
        .from(clientDepartments)
        .where(eq(clientDepartments.organisationId, actor.organisationId));
      const deptByKey = new Map(
        existingDepts.map((d) => [`${d.siteId}::${d.name.toLowerCase()}`, d]),
      );

      for (const d of data.departments) {
        const company = requireCompany(d.companyCode);
        const site = requireSite(company.id, d.siteName);
        const key = `${site.id}::${d.name.toLowerCase()}`;
        if (deptByKey.has(key)) {
          counts.departmentsSkipped++;
          continue;
        }
        const parsed = departmentSchema.parse({ name: d.name });
        const created = await insertDepartment(tx, actor, site, parsed.name, request);
        deptByKey.set(key, created);
        counts.departmentsAdded++;
      }

      const existingEquipment = await tx
        .select()
        .from(equipment)
        .where(eq(equipment.organisationId, actor.organisationId));
      const eqByKey = new Map(
        existingEquipment.map((e) => [`${e.companyId}::${e.code.toLowerCase()}`, e]),
      );

      for (const e of data.equipment) {
        const company = requireCompany(e.companyCode);
        const site = requireSite(company.id, e.siteName);
        const key = `${company.id}::${e.code.toLowerCase()}`;
        if (eqByKey.has(key)) {
          counts.equipmentSkipped++;
          continue;
        }
        const dept = e.departmentName
          ? deptByKey.get(`${site.id}::${e.departmentName.toLowerCase()}`)
          : null;
        if (e.departmentName && !dept) {
          throw new Error(
            `Department "${e.departmentName}" not found at ${company.code} / ${site.name} for equipment ${e.code}`,
          );
        }
        const created = await insertEquipment(
          tx,
          actor,
          company,
          equipmentSchema.parse({
            siteId: site.id,
            departmentId: dept?.id ?? null,
            code: e.code,
            name: e.name,
            type: e.type,
            location: e.location ?? "",
            make: e.make ?? "",
            model: e.model ?? "",
            serialNo: e.serialNo ?? "",
            lengthM: e.lengthM ?? null,
            widthM: e.widthM ?? null,
            heightM: e.heightM ?? null,
            setPointC: e.setPointC ?? null,
            tempMinC: e.tempMinC ?? null,
            tempMaxC: e.tempMaxC ?? null,
            rhMinPct: e.rhMinPct ?? null,
            rhMaxPct: e.rhMaxPct ?? null,
            defaultChannels: e.defaultChannels ?? null,
            readingIntervalMinutes: e.readingIntervalMinutes ?? null,
            studyDurationHours: e.studyDurationHours ?? null,
            requalificationMonths: e.requalificationMonths ?? null,
            lastStudyOn: e.lastStudyOn ?? null,
            cycles: e.cycles ?? [],
            seasonalMapping: e.seasonalMapping ?? false,
            notes: e.notes ?? "",
          }),
          request,
        );
        eqByKey.set(key, created);
        counts.equipmentAdded++;
      }

      const existingInstruments = await tx
        .select()
        .from(instruments)
        .where(eq(instruments.organisationId, actor.organisationId));
      const instByCode = new Map(existingInstruments.map((i) => [i.code.toLowerCase(), i]));

      for (const inst of data.instruments) {
        const owner = requireCompany(inst.ownerCompanyCode);
        const key = inst.code.toLowerCase();
        if (instByCode.has(key)) {
          counts.instrumentsSkipped++;
          continue;
        }
        const created = await insertInstrument(
          tx,
          actor,
          instrumentSchema.parse({
            code: inst.code,
            type: inst.type,
            tier: inst.tier,
            ownerCompanyId: owner.id,
            modelId: null,
            make: inst.make ?? "",
            model: inst.model ?? "",
            serialNo: inst.serialNo ?? "",
            equipmentName: inst.equipmentName ?? "",
            rangeText: inst.rangeText ?? "",
            resolutionText: inst.resolutionText ?? "",
            accuracyText: inst.accuracyText ?? "",
            intervalMonths: inst.intervalMonths,
            calibratedOn: inst.calibratedOn ?? null,
            dueOn: inst.dueOn ?? null,
            status: inst.status,
            notes: inst.notes ?? "",
          }),
          request,
        );
        instByCode.set(key, created);
        counts.instrumentsAdded++;
      }
    });

    console.log(
      [
        `Sites: +${counts.sitesAdded} (${counts.sitesSkipped} skipped)`,
        `Departments: +${counts.departmentsAdded} (${counts.departmentsSkipped} skipped)`,
        `Equipment: +${counts.equipmentAdded} (${counts.equipmentSkipped} skipped)`,
        `Client instruments: +${counts.instrumentsAdded} (${counts.instrumentsSkipped} skipped)`,
      ].join(" | "),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
