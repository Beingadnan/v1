import "server-only";

import ExcelJS from "exceljs";

import type { Cell, Sheet } from "./parse";

/** Sheets beyond this many rows are cut (a warehouse at 1 min for 7 days is ~10 000). */
export const MAX_ROWS = 60_000;

export type GridResult = { ok: true; sheets: Sheet[] } | { ok: false; error: string };

function plain(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    if ("result" in v) return plain(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((p) => p.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("error" in v) return null;
  }
  return null;
}

async function fromXlsx(bytes: Buffer): Promise<GridResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return {
      ok: false,
      error: "This Excel file can't be opened. Save it again as .xlsx and retry.",
    };
  }
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    const count = Math.min(ws.rowCount, MAX_ROWS);
    for (let r = 1; r <= count; r += 1) {
      const values = ws.getRow(r).values as ExcelJS.CellValue[];
      // exceljs rows are 1-based: drop the empty slot 0.
      rows.push(
        Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) =>
          plain(values[i + 1] ?? null),
        ),
      );
    }
    sheets.push({ name: ws.name, rows });
  });
  return { ok: true, sheets };
}

/** CSV or text export: comma, semicolon or tab, with or without quotes. */
export function fromCsv(textIn: string, name = "CSV"): Sheet {
  const textAll = textIn.replace(/^﻿/, "");
  const firstLines = textAll.split(/\r?\n/).slice(0, 20).join("\n");
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLines.split(d).length }));
  const delimiter = counts.sort((a, b) => b.n - a.n)[0]!.d;
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < textAll.length; i += 1) {
    const ch = textAll[i]!;
    if (quoted) {
      if (ch === '"' && textAll[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && textAll[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= MAX_ROWS) break;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { name, rows };
}

/** Turns an uploaded logger export into sheets of cells. */
export async function readGrid(bytes: Buffer, fileName: string): Promise<GridResult> {
  const lower = fileName.toLowerCase();
  const isZip = bytes.subarray(0, 2).toString("latin1") === "PK";
  if (isZip || lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return fromXlsx(bytes);
  if (lower.endsWith(".xls")) {
    return {
      ok: false,
      error:
        "Old .xls files can't be read. Open it in Excel and save as .xlsx (or CSV), then upload that.",
    };
  }
  const textAll = bytes.toString("utf8");
  if (textAll.includes("\u0000")) {
    return {
      ok: false,
      error: "This file isn't Excel or CSV. Export the logger data as .xlsx or CSV.",
    };
  }
  return { ok: true, sheets: [fromCsv(textAll, fileName)] };
}
