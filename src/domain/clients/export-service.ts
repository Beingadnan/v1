import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";

import type { Database } from "@/db/client-factory";
import { clientCompanies, clientDepartments, clientSites, equipment } from "@/db/schema";
import { assertCan } from "@/domain/auth/permissions";
import type { SessionUser } from "@/domain/auth/session-service";

import { EQUIPMENT_TYPE_INFO, isEquipmentType } from "./equipment-types";
import { buildImportTemplate } from "./import/workbook";
import { dueStatus, todayInIndia } from "./requalification";
import { isUuid } from "./shared";
import { STUDY_CYCLE_LABELS, type StudyCycle } from "./study-defaults";

const nextDueSql = sql<string | null>`(
  ${equipment.lastStudyOn}
  + make_interval(months => coalesce(${equipment.requalificationMonths}, ${clientCompanies.requalificationMonths}))
  - interval '1 day'
)::date::text`;

const n = (v: string | number | null) => (v === null || v === "" ? "" : Number(v));
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

/**
 * The equipment register as an Excel file in the import template's layout:
 * people correct or extend it in Excel and import it back.
 */
export async function exportRegister(
  db: Database,
  actor: SessionUser,
  companyId?: string,
): Promise<{ bytes: Buffer; fileName: string } | null> {
  assertCan(actor, "clients.view");
  if (companyId !== undefined && !isUuid(companyId)) return null;
  const companyFilter = and(
    eq(clientCompanies.organisationId, actor.organisationId),
    companyId ? eq(clientCompanies.id, companyId) : undefined,
  );
  const companies = await db
    .select()
    .from(clientCompanies)
    .where(companyFilter)
    .orderBy(asc(clientCompanies.name));
  if (companyId && companies.length === 0) return null;
  const ids = companies.map((c) => c.id);
  if (ids.length === 0) {
    return { bytes: await buildImportTemplate(), fileName: "QTech equipment register.xlsx" };
  }
  const inCompanies = sql`in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
  const [sites, departments, items] = await Promise.all([
    db
      .select()
      .from(clientSites)
      .where(sql`${clientSites.companyId} ${inCompanies}`)
      .orderBy(asc(clientSites.name)),
    db
      .select()
      .from(clientDepartments)
      .where(sql`${clientDepartments.companyId} ${inCompanies}`),
    db
      .select()
      .from(equipment)
      .where(and(sql`${equipment.companyId} ${inCompanies}`, eq(equipment.active, true)))
      .orderBy(asc(equipment.code)),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const departmentById = new Map(departments.map((d) => [d.id, d]));

  const bytes = await buildImportTemplate({
    clients: sites.map((site) => {
      const c = companyById.get(site.companyId)!;
      return {
        companyName: c.name,
        companyCode: c.code,
        gstin: c.gstin,
        companyAddress: c.address,
        postCalRequired: c.postCalRequired ? "Yes" : "No",
        requalificationMonths: c.requalificationMonths,
        siteName: site.name,
        siteCode: site.code,
        siteAddress: site.address,
        city: site.city,
        state: site.state,
        siteGstin: site.gstin,
      };
    }),
    equipment: items.map((e) => ({
      client: companyById.get(e.companyId)!.code,
      site: siteById.get(e.siteId)?.name ?? "",
      department: e.departmentId ? (departmentById.get(e.departmentId)?.name ?? "") : "",
      code: e.code,
      name: e.name,
      type: isEquipmentType(e.type) ? EQUIPMENT_TYPE_INFO[e.type].label : e.type,
      location: e.location,
      make: e.make,
      model: e.model,
      serialNo: e.serialNo,
      lengthM: n(e.lengthM),
      widthM: n(e.widthM),
      heightM: n(e.heightM),
      setPointC: n(e.setPointC),
      tempMinC: n(e.tempMinC),
      tempMaxC: n(e.tempMaxC),
      rhMinPct: n(e.rhMinPct),
      rhMaxPct: n(e.rhMaxPct),
      defaultChannels: n(e.defaultChannels),
      readingIntervalMinutes: n(e.readingIntervalMinutes),
      studyDurationHours: n(e.studyDurationHours),
      requalificationMonths: n(e.requalificationMonths),
      lastStudyOn: dmy(e.lastStudyOn),
      cycles: (e.cycles as StudyCycle[]).map((c) => STUDY_CYCLE_LABELS[c]).join(", "),
      seasonalMapping: e.seasonalMapping ? "Yes" : "No",
      notes: e.notes,
    })),
  });
  const name = companyId
    ? `${companies[0]!.code} equipment register.xlsx`
    : "QTech equipment register.xlsx";
  return { bytes, fileName: name };
}

export type DueItem = {
  id: string;
  companyId: string;
  companyName: string;
  companyCode: string;
  siteName: string;
  department: string | null;
  code: string;
  name: string;
  type: string;
  lastStudyOn: string | null;
  nextDue: string | null;
  seasonalMapping: boolean;
  status: ReturnType<typeof dueStatus>;
};

/**
 * Equipment whose next study is overdue or due within `days`, soonest first,
 * plus (optionally) equipment with no study date recorded yet.
 */
export async function listDueEquipment(
  db: Database,
  actor: SessionUser,
  options: { days: number; includeUnknown?: boolean },
): Promise<DueItem[]> {
  assertCan(actor, "clients.view");
  const today = todayInIndia();
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + options.days);
  const untilIso = until.toISOString().slice(0, 10);
  const rows = await db
    .select({
      id: equipment.id,
      companyId: clientCompanies.id,
      companyName: clientCompanies.name,
      companyCode: clientCompanies.code,
      siteName: clientSites.name,
      department: clientDepartments.name,
      code: equipment.code,
      name: equipment.name,
      type: equipment.type,
      lastStudyOn: equipment.lastStudyOn,
      nextDue: nextDueSql,
      seasonalMapping: equipment.seasonalMapping,
    })
    .from(equipment)
    .innerJoin(clientCompanies, eq(clientCompanies.id, equipment.companyId))
    .innerJoin(clientSites, eq(clientSites.id, equipment.siteId))
    .leftJoin(clientDepartments, eq(clientDepartments.id, equipment.departmentId))
    .where(
      and(
        eq(equipment.organisationId, actor.organisationId),
        eq(equipment.active, true),
        eq(clientCompanies.active, true),
        options.includeUnknown
          ? sql`(${equipment.lastStudyOn} is null or ${nextDueSql} <= ${untilIso})`
          : sql`${nextDueSql} <= ${untilIso}`,
      ),
    )
    .orderBy(sql`${nextDueSql} asc nulls last`, asc(clientCompanies.name), asc(equipment.code));
  return rows.map((r) => ({ ...r, status: dueStatus(r.nextDue, today) }));
}

const STATUS_TEXT = {
  overdue: "Overdue",
  due_soon: "Due within 30 days",
  ok: "Due",
  none: "No study recorded",
};

/** The due list as a plain Excel sheet, to plan the month or send to a client. */
export async function exportDueList(items: DueItem[], title: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QTech";
  const sheet = workbook.addWorksheet("Requalification due", {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF002D8C" } };
  sheet.getCell("A2").value = `Made by QTech on ${dmy(todayInIndia())}`;
  sheet.getRow(3).values = [
    "Client",
    "Site",
    "Department",
    "Equipment ID",
    "Equipment",
    "Type",
    "Last study",
    "Next due",
    "Status",
    "Seasonal",
  ];
  sheet.getRow(3).font = { bold: true };
  sheet.columns = [28, 16, 14, 16, 32, 18, 12, 12, 20, 10].map((width) => ({ width }));
  items.forEach((item, i) => {
    sheet.getRow(4 + i).values = [
      item.companyName,
      item.siteName,
      item.department ?? "",
      item.code,
      item.name,
      isEquipmentType(item.type) ? EQUIPMENT_TYPE_INFO[item.type].label : item.type,
      dmy(item.lastStudyOn),
      dmy(item.nextDue),
      STATUS_TEXT[item.status],
      item.seasonalMapping ? "Summer + winter" : "",
    ];
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
