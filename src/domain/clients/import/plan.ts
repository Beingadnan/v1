/**
 * Works out what an import would do, without touching the database: which
 * clients, sites, departments and equipment are new, which change and how,
 * and which rows have problems. Pure, so it is easy to test and the preview
 * shows exactly what "Import" will apply.
 *
 * Rules
 * - Clients are matched by short name; sites by name or code within the client;
 *   departments by name within the site; equipment by ID within the client.
 *   All matching ignores upper/lower case.
 * - For existing records, empty cells keep what is stored. Only filled cells change.
 * - Departments named on equipment rows are created when missing. Sites are not:
 *   a typo would create a duplicate site, so a missing site is an error.
 * - Nothing is applied while any row has an error.
 */
import { DEFAULT_REPORT_NUMBER_FORMAT } from "../report-number";
import { equipmentTypeFromText, EQUIPMENT_TYPE_INFO, EQUIPMENT_TYPES } from "../equipment-types";
import { clientSiteSchema, companySchema, equipmentSchema, type EquipmentValues } from "../schemas";
import type { ClientColumn, EquipmentColumn } from "./columns";

export type SheetRow<K extends string> = { row: number; cells: Partial<Record<K, string>> };

export type ExistingCompany = {
  id: string;
  name: string;
  code: string;
  gstin: string;
  address: string;
  notes: string;
  postCalRequired: boolean;
  requalificationMonths: number;
  reportNumberFormat: string;
};
export type ExistingSite = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
};
export type ExistingDepartment = { id: string; siteId: string; name: string };
export type ExistingEquipment = Record<string, unknown> & {
  id: string;
  companyId: string;
  siteId: string;
  departmentId: string | null;
  code: string;
};

export type Snapshot = {
  companies: ExistingCompany[];
  sites: ExistingSite[];
  departments: ExistingDepartment[];
  equipment: ExistingEquipment[];
};

export type RowError = { sheet: "Clients" | "Equipment"; row: number; message: string };
type Action = "create" | "update" | "unchanged";

export type PlannedCompany = {
  key: string;
  action: Action;
  id?: string;
  values: ReturnType<typeof companySchema.parse>;
  changed: string[];
};
export type PlannedSite = {
  key: string;
  companyKey: string;
  action: Action;
  id?: string;
  values: ReturnType<typeof clientSiteSchema.parse>;
  changed: string[];
};
export type PlannedDepartment = { key: string; siteKey: string; name: string; id?: string };
export type PlannedEquipment = {
  row: number;
  companyKey: string;
  siteKey: string;
  departmentKey: string | null;
  action: Action;
  id?: string;
  values: Omit<EquipmentValues, "siteId" | "departmentId">;
  changed: string[];
};

export type ImportPlan = {
  errors: RowError[];
  companies: PlannedCompany[];
  sites: PlannedSite[];
  /** Only departments that will be created. */
  newDepartments: PlannedDepartment[];
  equipment: PlannedEquipment[];
};

const lower = (s: string) => s.trim().toLowerCase();
const filled = (v: string | undefined): v is string => v !== undefined && v.trim() !== "";
/** Placeholder ids so the equipment schema can check everything else before ids exist. */
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

function parseYesNo(value: string): boolean | null {
  const v = lower(value);
  if (["yes", "y", "true", "1", "required"].includes(v)) return true;
  if (["no", "n", "false", "0", "not required"].includes(v)) return false;
  return null;
}

function same(a: unknown, b: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => !same(before[k], after[k]));
}

function firstIssue(
  error: { issues: { message: string; path: PropertyKey[] }[] },
  labels: Record<string, string>,
) {
  const issue = error.issues[0];
  if (!issue) return "Check this row.";
  const field = labels[String(issue.path[0] ?? "")];
  return field ? `${field}: ${issue.message}` : issue.message;
}

const COMPANY_LABELS: Record<string, string> = {
  name: "Company name",
  code: "Short name",
  gstin: "GSTIN",
  address: "Registered address",
  requalificationMonths: "Requalification months",
};
const SITE_LABELS: Record<string, string> = {
  name: "Site name",
  code: "Site code",
  gstin: "Site GSTIN",
};
const EQUIPMENT_LABELS: Record<string, string> = {
  code: "Equipment ID",
  name: "Equipment name",
  type: "Type",
  lengthM: "Length",
  widthM: "Width",
  heightM: "Height",
  setPointC: "Set point",
  tempMinC: "Lowest temp",
  tempMaxC: "Highest temp",
  rhMinPct: "Lowest RH",
  rhMaxPct: "Highest RH",
  defaultChannels: "Loggers",
  readingIntervalMinutes: "Reading interval",
  studyDurationHours: "Study duration",
  requalificationMonths: "Requalification months",
  lastStudyOn: "Last study date",
};

const COMPANY_FIELDS = [
  "name",
  "code",
  "gstin",
  "address",
  "notes",
  "postCalRequired",
  "requalificationMonths",
  "reportNumberFormat",
] as const;
const SITE_FIELDS = ["name", "code", "address", "city", "state", "gstin"] as const;
const EQUIPMENT_VALUE_FIELDS = [
  "code",
  "name",
  "type",
  "location",
  "make",
  "model",
  "serialNo",
  "lengthM",
  "widthM",
  "heightM",
  "setPointC",
  "tempMinC",
  "tempMaxC",
  "rhMinPct",
  "rhMaxPct",
  "defaultChannels",
  "readingIntervalMinutes",
  "studyDurationHours",
  "requalificationMonths",
  "lastStudyOn",
  "notes",
] as const;

const pick = <T extends Record<string, unknown>, K extends readonly (keyof T)[]>(obj: T, keys: K) =>
  Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K[number]>;

export function planImport(
  sheets: { clients: SheetRow<ClientColumn>[]; equipment: SheetRow<EquipmentColumn>[] },
  snapshot: Snapshot,
): ImportPlan {
  const errors: RowError[] = [];
  const companies = new Map<string, PlannedCompany>(); // key: lower(code)
  const sites = new Map<string, PlannedSite>(); // key: companyKey + "|" + lower(name)
  const newDepartments = new Map<string, PlannedDepartment>();
  const equipment: PlannedEquipment[] = [];

  const existingCompanyByCode = new Map(snapshot.companies.map((c) => [lower(c.code), c]));
  const existingCompanyByName = new Map(snapshot.companies.map((c) => [lower(c.name), c]));
  const companyKeyByName = new Map<string, string>();

  // ------------------------------------------------------------ Clients sheet
  for (const { row, cells } of sheets.clients) {
    const err = (message: string) => errors.push({ sheet: "Clients", row, message });
    const code = cells.companyCode?.trim() ?? "";
    const name = cells.companyName?.trim() ?? "";
    if (!code || !name) {
      err("Fill in Company name and Short name.");
      continue;
    }
    const key = lower(code);

    let postCal: boolean | undefined;
    if (filled(cells.postCalRequired)) {
      const parsed = parseYesNo(cells.postCalRequired);
      if (parsed === null) {
        err(`Post-cal required by SOP: write Yes or No, not “${cells.postCalRequired}”.`);
        continue;
      }
      postCal = parsed;
    }

    const provided: Record<string, unknown> = { name, code };
    if (filled(cells.gstin)) provided.gstin = cells.gstin;
    if (filled(cells.companyAddress)) provided.address = cells.companyAddress;
    if (postCal !== undefined) provided.postCalRequired = postCal;
    if (filled(cells.requalificationMonths))
      provided.requalificationMonths = cells.requalificationMonths;

    let planned = companies.get(key);
    if (!planned) {
      const existing = existingCompanyByCode.get(key);
      const sameName = existingCompanyByName.get(lower(name));
      if (!existing && sameName) {
        err(
          `${sameName.name} already exists with short name “${sameName.code}”. Use that short name.`,
        );
        continue;
      }
      if (companyKeyByName.has(lower(name)) && companyKeyByName.get(lower(name)) !== key) {
        err(`${name} appears with two different short names in this sheet.`);
        continue;
      }
      const base: Record<string, unknown> = existing
        ? pick(existing, COMPANY_FIELDS)
        : {
            gstin: "",
            address: "",
            notes: "",
            postCalRequired: false,
            requalificationMonths: 12,
            reportNumberFormat: DEFAULT_REPORT_NUMBER_FORMAT,
          };
      const parsed = companySchema.safeParse({ ...base, ...provided });
      if (!parsed.success) {
        err(firstIssue(parsed.error, COMPANY_LABELS));
        continue;
      }
      const changed = existing ? changedKeys(existing, parsed.data) : [];
      planned = {
        key,
        action: existing ? (changed.length ? "update" : "unchanged") : "create",
        id: existing?.id,
        values: parsed.data,
        changed,
      };
      companies.set(key, planned);
      companyKeyByName.set(lower(name), key);
    } else {
      // The same client on another row (another site): company cells must agree.
      const again = companySchema.safeParse({ ...planned.values, ...provided });
      const differs = again.success ? changedKeys(planned.values, again.data) : ["?"];
      if (differs.length > 0) {
        const label = COMPANY_LABELS[differs[0]!] ?? "A company detail";
        err(
          `${label} differs from an earlier row for ${code}. Use the same value on every row of a client.`,
        );
        continue;
      }
    }

    // Site on this row.
    const siteName = cells.siteName?.trim() ?? "";
    if (!siteName) {
      err("Fill in Site name.");
      continue;
    }
    const siteKey = `${key}|${lower(siteName)}`;
    if (sites.has(siteKey)) {
      err(`Site ${siteName} is listed twice for ${code}.`);
      continue;
    }
    const existingSite = planned.id
      ? snapshot.sites.find(
          (s) =>
            s.companyId === planned!.id &&
            (lower(s.name) === lower(siteName) || lower(s.code) === lower(siteName)),
        )
      : undefined;
    const siteProvided: Record<string, unknown> = { name: existingSite?.name ?? siteName };
    if (filled(cells.siteCode)) siteProvided.code = cells.siteCode;
    if (filled(cells.siteAddress)) siteProvided.address = cells.siteAddress;
    if (filled(cells.city)) siteProvided.city = cells.city;
    if (filled(cells.state)) siteProvided.state = cells.state;
    if (filled(cells.siteGstin)) siteProvided.gstin = cells.siteGstin;
    const siteBase: Record<string, unknown> = existingSite
      ? pick(existingSite, SITE_FIELDS)
      : { code: siteName, address: "", city: "", state: "", gstin: "" };
    const site = clientSiteSchema.safeParse({ ...siteBase, ...siteProvided });
    if (!site.success) {
      err(firstIssue(site.error, SITE_LABELS));
      continue;
    }
    const siteChanged = existingSite ? changedKeys(existingSite, site.data) : [];
    sites.set(siteKey, {
      key: siteKey,
      companyKey: key,
      action: existingSite ? (siteChanged.length ? "update" : "unchanged") : "create",
      id: existingSite?.id,
      values: site.data,
      changed: siteChanged,
    });
  }

  // ------------------------------------------------------------ Equipment sheet
  const seenEquipment = new Set<string>();
  for (const { row, cells } of sheets.equipment) {
    const err = (message: string) => errors.push({ sheet: "Equipment", row, message });
    const clientText = cells.client?.trim() ?? "";
    const siteText = cells.site?.trim() ?? "";
    const code = cells.code?.trim() ?? "";
    if (!clientText || !siteText || !code) {
      err("Fill in Client short name, Site name and Equipment ID.");
      continue;
    }

    // Client: planned in this sheet, or already in QTech (by short name, then full name).
    let companyKey = lower(clientText);
    let company = companies.get(companyKey);
    if (!company) {
      const existing =
        existingCompanyByCode.get(lower(clientText)) ??
        existingCompanyByName.get(lower(clientText));
      if (!existing) {
        err(`Client “${clientText}” isn't in QTech or the Clients sheet.`);
        continue;
      }
      companyKey = lower(existing.code);
      company = companies.get(companyKey);
      if (!company) {
        company = {
          key: companyKey,
          action: "unchanged",
          id: existing.id,
          values: companySchema.parse(pick(existing, COMPANY_FIELDS)),
          changed: [],
        };
        companies.set(companyKey, company);
      }
    }

    // Site: planned in this sheet, or existing for this client (by name or code).
    let siteKey = `${companyKey}|${lower(siteText)}`;
    let site = sites.get(siteKey);
    if (!site) {
      site = [...sites.values()].find(
        (s) => s.companyKey === companyKey && lower(s.values.code) === lower(siteText),
      );
      if (site) siteKey = site.key;
    }
    if (!site && company.id) {
      const existing = snapshot.sites.find(
        (s) =>
          s.companyId === company!.id &&
          (lower(s.name) === lower(siteText) || lower(s.code) === lower(siteText)),
      );
      if (existing) {
        siteKey = `${companyKey}|${lower(existing.name)}`;
        site = sites.get(siteKey) ?? {
          key: siteKey,
          companyKey,
          action: "unchanged",
          id: existing.id,
          values: clientSiteSchema.parse(pick(existing, SITE_FIELDS)),
          changed: [],
        };
        sites.set(siteKey, site);
      }
    }
    if (!site) {
      err(
        `Site “${siteText}” isn't listed for ${company.values.code}. Add it to the Clients sheet or fix the name.`,
      );
      continue;
    }

    const dupKey = `${companyKey}|${lower(code)}`;
    if (seenEquipment.has(dupKey)) {
      err(`Equipment ID ${code} appears twice for ${company.values.code}.`);
      continue;
    }
    seenEquipment.add(dupKey);

    // Department: existing at this site, planned already, or new.
    let departmentKey: string | null = null;
    const departmentText = cells.department?.trim() ?? "";
    if (departmentText) {
      departmentKey = `${siteKey}|${lower(departmentText)}`;
      const existing = site.id
        ? snapshot.departments.find(
            (d) => d.siteId === site!.id && lower(d.name) === lower(departmentText),
          )
        : undefined;
      if (!existing && !newDepartments.has(departmentKey)) {
        if (departmentText.length > 100) {
          err("Department: use at most 100 characters.");
          continue;
        }
        newDepartments.set(departmentKey, { key: departmentKey, siteKey, name: departmentText });
      }
    }

    // Type: accept common spellings; explain when unknown.
    let type: string | undefined;
    if (filled(cells.type)) {
      const found = equipmentTypeFromText(cells.type);
      if (!found) {
        err(
          `Type “${cells.type}” isn't known. Use one of: ${EQUIPMENT_TYPES.map((t) => EQUIPMENT_TYPE_INFO[t].label).join(", ")}.`,
        );
        continue;
      }
      type = found;
    }

    const existing = company.id
      ? snapshot.equipment.find(
          (e) => e.companyId === company!.id && lower(String(e.code)) === lower(code),
        )
      : undefined;
    const provided: Record<string, unknown> = {};
    for (const field of EQUIPMENT_VALUE_FIELDS) {
      const value = cells[field as EquipmentColumn];
      if (filled(value)) provided[field] = value;
    }
    if (type) provided.type = type;
    const base: Record<string, unknown> = existing
      ? Object.fromEntries(EQUIPMENT_VALUE_FIELDS.map((f) => [f, existing[f] ?? ""]))
      : { location: "", make: "", model: "", serialNo: "", notes: "" };
    const parsed = equipmentSchema.safeParse({
      ...base,
      ...provided,
      siteId: PLACEHOLDER_ID,
      departmentId: null,
    });
    if (!parsed.success) {
      err(firstIssue(parsed.error, EQUIPMENT_LABELS));
      continue;
    }
    const { siteId: _site, departmentId: _dept, ...values } = parsed.data;
    void _site;
    void _dept;

    let changed: string[] = [];
    if (existing) {
      changed = changedKeys(existing, values);
      const existingDepartmentName = snapshot.departments.find(
        (d) => d.id === existing.departmentId,
      )?.name;
      if (site.id !== existing.siteId) changed.push("siteId");
      if (departmentText && lower(departmentText) !== lower(existingDepartmentName ?? "")) {
        changed.push("departmentId");
      }
    }
    equipment.push({
      row,
      companyKey,
      siteKey,
      // An empty department cell on an existing record keeps its department.
      departmentKey: departmentText
        ? departmentKey
        : existing?.departmentId
          ? `existing:${String(existing.departmentId)}`
          : null,
      action: existing ? (changed.length ? "update" : "unchanged") : "create",
      id: existing?.id,
      values,
      changed,
    });
  }

  return {
    errors,
    companies: [...companies.values()],
    sites: [...sites.values()],
    newDepartments: [...newDepartments.values()],
    equipment,
  };
}

export function planCounts(plan: ImportPlan) {
  const count = <T extends { action: Action }>(items: T[], action: Action) =>
    items.filter((i) => i.action === action).length;
  return {
    companies: { create: count(plan.companies, "create"), update: count(plan.companies, "update") },
    sites: { create: count(plan.sites, "create"), update: count(plan.sites, "update") },
    departments: { create: plan.newDepartments.length },
    equipment: {
      create: count(plan.equipment, "create"),
      update: count(plan.equipment, "update"),
      unchanged: count(plan.equipment, "unchanged"),
    },
  };
}
