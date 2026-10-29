/**
 * Columns of the clients/equipment import workbook. Headers are matched
 * loosely (case, spaces, "*" and units in brackets are ignored) so a sheet
 * people have retyped still imports.
 */
export type ColumnSpec = {
  key: string;
  header: string;
  /** Other header texts accepted for this column. */
  aliases?: string[];
  required?: boolean;
  width?: number;
  note?: string;
};

export const CLIENT_COLUMNS = [
  {
    key: "companyName",
    header: "Company name",
    required: true,
    width: 34,
    aliases: ["company", "client name", "client"],
  },
  {
    key: "companyCode",
    header: "Short name",
    required: true,
    width: 14,
    aliases: ["company code", "client code", "short code"],
    note: "Used in report numbers, e.g. Watson",
  },
  { key: "gstin", header: "GSTIN", width: 18 },
  {
    key: "companyAddress",
    header: "Registered address",
    width: 40,
    aliases: ["company address", "address"],
  },
  {
    key: "postCalRequired",
    header: "Post-cal required by SOP",
    width: 14,
    aliases: ["post cal required", "post-cal required", "post calibration required"],
    note: "Yes or No (temperature mapping)",
  },
  {
    key: "requalificationMonths",
    header: "Requalification months",
    width: 14,
    aliases: ["requalification", "requalification interval"],
  },
  {
    key: "siteName",
    header: "Site name",
    required: true,
    width: 18,
    aliases: ["site", "location", "region"],
  },
  {
    key: "siteCode",
    header: "Site code",
    width: 12,
    note: "For report numbers; empty uses the site name",
  },
  { key: "siteAddress", header: "Site address", width: 40 },
  { key: "city", header: "City", width: 16 },
  { key: "state", header: "State", width: 16 },
  { key: "siteGstin", header: "Site GSTIN", width: 18 },
] as const satisfies readonly ColumnSpec[];

export const EQUIPMENT_COLUMNS = [
  {
    key: "client",
    header: "Client short name",
    required: true,
    width: 16,
    aliases: ["client", "company", "short name", "company code"],
  },
  { key: "site", header: "Site name", required: true, width: 16, aliases: ["site", "location"] },
  { key: "department", header: "Department", width: 14, aliases: ["dept"] },
  {
    key: "code",
    header: "Equipment ID",
    required: true,
    width: 16,
    aliases: ["equipment id", "equipment code", "id"],
  },
  {
    key: "name",
    header: "Equipment name",
    required: true,
    width: 32,
    aliases: ["equipment", "name", "description"],
  },
  { key: "type", header: "Type", required: true, width: 18, aliases: ["equipment type"] },
  { key: "location", header: "Room / location", width: 18, aliases: ["room", "area"] },
  { key: "make", header: "Make", width: 14 },
  { key: "model", header: "Model", width: 14 },
  { key: "serialNo", header: "Serial no", width: 14, aliases: ["serial number", "serial"] },
  { key: "lengthM", header: "Length (m)", width: 10, aliases: ["length"] },
  { key: "widthM", header: "Width (m)", width: 10, aliases: ["width"] },
  { key: "heightM", header: "Height (m)", width: 10, aliases: ["height"] },
  { key: "setPointC", header: "Set point (°C)", width: 12, aliases: ["set point"] },
  {
    key: "tempMinC",
    header: "Lowest temp (°C)",
    width: 14,
    aliases: ["lowest temp", "min temp", "lower limit", "minimum"],
  },
  {
    key: "tempMaxC",
    header: "Highest temp (°C)",
    width: 14,
    aliases: ["highest temp", "max temp", "upper limit", "maximum"],
  },
  { key: "rhMinPct", header: "Lowest RH (%)", width: 12, aliases: ["lowest rh", "min rh"] },
  { key: "rhMaxPct", header: "Highest RH (%)", width: 12, aliases: ["highest rh", "max rh"] },
  {
    key: "defaultChannels",
    header: "Loggers",
    width: 9,
    aliases: ["no of channels", "channels", "number of loggers", "no of loggers"],
  },
  {
    key: "readingIntervalMinutes",
    header: "Reading interval (min)",
    width: 12,
    aliases: ["reading interval", "frequency of reading", "interval"],
  },
  {
    key: "studyDurationHours",
    header: "Study duration (h)",
    width: 12,
    aliases: ["study duration", "mapping duration", "duration"],
  },
  {
    key: "requalificationMonths",
    header: "Requalification months",
    width: 14,
    aliases: ["requalification"],
  },
  {
    key: "lastStudyOn",
    header: "Last study date",
    width: 14,
    aliases: ["last study", "mapping end date", "last mapping date"],
    note: "Date the last study ended, e.g. 23.05.2026",
  },
  {
    key: "cycles",
    header: "Study cycles",
    width: 26,
    aliases: ["cycles", "cycle type"],
    note: "Any of: Empty, Loaded, Door open, Power failure (comma separated). Empty uses the type's defaults.",
  },
  {
    key: "seasonalMapping",
    header: "Summer and winter mapping",
    width: 14,
    aliases: ["seasonal mapping", "seasonal"],
    note: "Yes for warehouses and stores affected by outside weather",
  },
  { key: "notes", header: "Notes", width: 24 },
] as const satisfies readonly ColumnSpec[];

export type ClientColumn = (typeof CLIENT_COLUMNS)[number]["key"];
export type EquipmentColumn = (typeof EQUIPMENT_COLUMNS)[number]["key"];

export const SHEET_NAMES = { clients: "Clients", equipment: "Equipment" } as const;

/** "Set point (°C) *" → "set point"; used to compare headers. */
export function normaliseHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[*:.]/g, " ")
    .replace(/[_\-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Maps each column key to the index of its header cell; reports missing required columns. */
export function matchHeaders<K extends string>(
  headerRow: string[],
  columns: readonly { key: K; header: string; aliases?: readonly string[]; required?: boolean }[],
): { indexes: Partial<Record<K, number>>; missing: string[] } {
  const normalised = headerRow.map(normaliseHeader);
  const indexes: Partial<Record<K, number>> = {};
  const used = new Set<number>();
  for (const column of columns) {
    const candidates = [column.header, ...(column.aliases ?? [])].map(normaliseHeader);
    const index = normalised.findIndex((h, i) => !used.has(i) && candidates.includes(h));
    if (index >= 0) {
      indexes[column.key] = index;
      used.add(index);
    }
  }
  const missing = columns
    .filter((c) => c.required && indexes[c.key] === undefined)
    .map((c) => c.header);
  return { indexes, missing };
}
