import "server-only";

import ExcelJS from "exceljs";

import { EQUIPMENT_TYPE_INFO, EQUIPMENT_TYPES } from "../equipment-types";
import {
  CLIENT_COLUMNS,
  EQUIPMENT_COLUMNS,
  matchHeaders,
  SHEET_NAMES,
  type ClientColumn,
  type ColumnSpec,
  type EquipmentColumn,
} from "./columns";
import type { SheetRow } from "./plan";

export const MAX_IMPORT_ROWS = 2000;
const DATE_COLUMNS = new Set<string>(["lastStudyOn"]);

export type ReadResult =
  | {
      ok: true;
      clients: SheetRow<ClientColumn>[];
      equipment: SheetRow<EquipmentColumn>[];
    }
  | { ok: false; message: string };

/** One cell as plain text, whatever Excel stored (number, date, formula, rich text…). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(Number(value.toPrecision(12)));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value)
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("error" in value) return "";
  }
  return String(value).trim();
}

/** "23.05.2026", "23/05/2026", "23-05-2026" (Indian day-first) → "2026-05-23". Else unchanged. */
export function dateText(text: string): string {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text.trim());
  if (!match) return text;
  const [, d, m, y] = match;
  return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

function readSheet<K extends string>(
  sheet: ExcelJS.Worksheet,
  columns: readonly (ColumnSpec & { key: K })[],
): { ok: true; rows: SheetRow<K>[] } | { ok: false; message: string } {
  // The header row is one of the first ten rows (people add titles above tables).
  let headerRow = 0;
  let indexes: Partial<Record<K, number>> = {};
  let missing: string[] = columns.filter((c) => c.required).map((c) => c.header);
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r += 1) {
    const values = sheet.getRow(r).values as ExcelJS.CellValue[];
    const header = Array.from({ length: values.length }, (_, i) => cellText(values[i] ?? null));
    const match = matchHeaders(header, columns);
    if (Object.keys(match.indexes).length === 0) continue;
    if (!headerRow || match.missing.length < missing.length) {
      ({ indexes, missing } = match);
      headerRow = r;
    }
    if (missing.length === 0) break;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      message: `The ${sheet.name} sheet is missing the column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. Start from the template.`,
    };
  }

  const rows: SheetRow<K>[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
    const values = sheet.getRow(r).values as ExcelJS.CellValue[];
    const cells: Partial<Record<K, string>> = {};
    let any = false;
    for (const column of columns) {
      const index = indexes[column.key];
      if (index === undefined) continue;
      let text = cellText(values[index] ?? null);
      if (DATE_COLUMNS.has(column.key)) text = dateText(text);
      if (text) any = true;
      cells[column.key] = text;
    }
    if (!any) continue;
    if (rows.length >= MAX_IMPORT_ROWS) {
      return {
        ok: false,
        message: `The ${sheet.name} sheet has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`,
      };
    }
    rows.push({ row: r, cells });
  }
  return { ok: true, rows };
}

/** Reads the Clients and Equipment sheets. Either may be missing, not both. */
export async function readImportWorkbook(bytes: Uint8Array): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    return {
      ok: false,
      message: "This file can't be read as an Excel workbook. Save it as .xlsx and try again.",
    };
  }
  const find = (name: string) =>
    workbook.worksheets.find((ws) => ws.name.trim().toLowerCase() === name.toLowerCase());
  const clientsSheet = find(SHEET_NAMES.clients);
  const equipmentSheet = find(SHEET_NAMES.equipment);
  if (!clientsSheet && !equipmentSheet) {
    return {
      ok: false,
      message: `Couldn't find a sheet named “${SHEET_NAMES.clients}” or “${SHEET_NAMES.equipment}”. Start from the template.`,
    };
  }
  const clients = clientsSheet
    ? readSheet(clientsSheet, CLIENT_COLUMNS)
    : { ok: true as const, rows: [] };
  if (!clients.ok) return clients;
  const equipment = equipmentSheet
    ? readSheet(equipmentSheet, EQUIPMENT_COLUMNS)
    : { ok: true as const, rows: [] };
  if (!equipment.ok) return equipment;
  if (clients.rows.length === 0 && equipment.rows.length === 0) {
    return { ok: false, message: "The sheets have headers but no rows to import." };
  }
  return { ok: true, clients: clients.rows, equipment: equipment.rows };
}

const BRAND = "FF002D8C";
const BRAND_SOFT = "FFE6ECF8";

function addDataSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly ColumnSpec[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({
    header: c.required ? `${c.header} *` : c.header,
    key: c.key,
    width: c.width ?? 14,
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: BRAND } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_SOFT } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  columns.forEach((c, i) => {
    if (c.note) header.getCell(i + 1).note = c.note;
  });
  return sheet;
}

/** The import template: instructions, an example, and the two sheets to fill. */
export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QTech";

  const help = workbook.addWorksheet("How to fill");
  help.columns = [{ width: 110 }];
  const lines: [string, Partial<ExcelJS.Font>?][] = [
    ["Import clients and equipment into QTech", { bold: true, size: 14, color: { argb: BRAND } }],
    [""],
    [
      "1. Clients sheet: one row per client site. Repeat the company columns on each row of the same client.",
    ],
    [
      "2. Equipment sheet: one row per equipment item. Client short name and Site name must match the Clients sheet or a client already in QTech.",
    ],
    ["3. Columns marked * are required. Leave other cells empty if you don't know them."],
    [
      "4. Existing records are matched by short name, site name and equipment ID. Empty cells keep what QTech has; filled cells replace it.",
    ],
    [
      "5. Departments are created automatically. Sites are not: add every site to the Clients sheet first.",
    ],
    [
      "6. Limits: Lowest and Highest temperature in °C. Leave one empty for a one-sided limit (e.g. Highest 25 for 'NMT 25 °C').",
    ],
    [
      "7. Dates as 23.05.2026 or as Excel dates. Upload the file in QTech → Clients → Import from Excel, check the preview, then import.",
    ],
    [""],
    ["Example (BE-WF-02 at Watson Pharma, Seawoods):", { bold: true }],
    ["Clients:   Watson Pharma Pvt Limited | Watson | … | Site name: Seawoods | City: Navi Mumbai"],
    [
      "Equipment: Watson | Seawoods | BA | BE-WF-02 | Cold Storage (Walk In Freezer) | Walk-in freezer | Walk In Freezer | Blue Star | NA | NA | | | | -24 | -30 | -15 | | | 9 | 10 | 24 | | 23.05.2026",
    ],
    [""],
    ["Equipment types:", { bold: true }],
    [EQUIPMENT_TYPES.map((t) => EQUIPMENT_TYPE_INFO[t].label).join(", ")],
  ];
  for (const [text, font] of lines) {
    const row = help.addRow([text]);
    if (font) row.font = font;
    row.alignment = { wrapText: true };
  }

  const lists = workbook.addWorksheet("Lists", { state: "veryHidden" });
  EQUIPMENT_TYPES.forEach((t, i) => (lists.getCell(i + 1, 1).value = EQUIPMENT_TYPE_INFO[t].label));
  ["Yes", "No"].forEach((v, i) => (lists.getCell(i + 1, 2).value = v));

  const clients = addDataSheet(workbook, SHEET_NAMES.clients, CLIENT_COLUMNS);
  const equipment = addDataSheet(workbook, SHEET_NAMES.equipment, EQUIPMENT_COLUMNS);

  const postCalColumn = CLIENT_COLUMNS.findIndex((c) => c.key === "postCalRequired") + 1;
  const typeColumn = EQUIPMENT_COLUMNS.findIndex((c) => c.key === "type") + 1;
  for (let r = 2; r <= 501; r += 1) {
    clients.getCell(r, postCalColumn).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ["Lists!$B$1:$B$2"],
    };
    equipment.getCell(r, typeColumn).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: false,
      formulae: [`Lists!$A$1:$A$${EQUIPMENT_TYPES.length}`],
    };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
