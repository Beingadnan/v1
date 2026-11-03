/**
 * Reads QA Tech's own FT-05 calibration certificates kept as Excel workbooks
 * (one certificate per sheet, e.g. "TRH-3601 to TRH-3620.xlsx"): the header
 * grid, the reference standards used and the observation blocks with every
 * reading. Pure: no database; tested against the real layouts.
 *
 * The sheets are laid out for printing, with merged cells repeating a label
 * across columns, so values are found by label ("Date of Calibration" → the
 * first different cell to its right) rather than by fixed addresses. A later
 * sheet often copies the header from the first one with a formula Excel never
 * calculated ('20 DATA LOGGER 1'!E3); those references are followed.
 */
import ExcelJS from "exceljs";

import { cellText, dateText } from "@/domain/clients/import/workbook";

import { cleanDecimal } from "./calibration-math";
import type { Quantity } from "./types";

export type WorkbookMaster = {
  name: string;
  make: string;
  model: string;
  serialNo: string;
  validUntil: string | null;
  certificateNo: string;
};

export type WorkbookCertificate = {
  sheet: string;
  number: string;
  calibratedOn: string | null;
  validUntil: string | null;
  customerName: string;
  customerAddress: string;
  location: string;
  department: string;
  equipmentName: string;
  make: string;
  model: string;
  rangeText: string;
  resolutionText: string;
  sopNo: string;
  conditionOnReceipt: string;
  accuracyText: string;
  environmentTemperature: string;
  environmentHumidity: string;
  masters: WorkbookMaster[];
  points: { quantity: Quantity; reference: string; condition: string }[];
  /** In print order. */
  instruments: { code: string; serialNo: string }[];
  /** readings[point][instrument], "" when the cell was empty. */
  readings: string[][];
};

type Grid = { text: (r: number, c: number) => string; rows: number; cols: number };

/** Text of a cell, following a plain reference to another sheet when Excel left no value. */
function gridOf(sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook): Grid {
  const resolve = (cell: ExcelJS.Cell, depth: number): string => {
    const value = cell.value;
    const text = cellText(value);
    if (text !== "" || depth > 3) return text;
    if (
      value &&
      typeof value === "object" &&
      "formula" in value &&
      typeof value.formula === "string"
    ) {
      const ref = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/.exec(value.formula.trim());
      if (ref) {
        const other = workbook.getWorksheet(ref[1]!);
        if (other) return resolve(other.getCell(`${ref[2]}${ref[3]}`), depth + 1);
      }
    }
    return "";
  };
  const cache = new Map<string, string>();
  return {
    rows: sheet.rowCount,
    cols: sheet.columnCount,
    text: (r, c) => {
      const key = `${r}:${c}`;
      let v = cache.get(key);
      if (v === undefined) {
        v = resolve(sheet.getRow(r).getCell(c), 0).replace(/\s+/g, " ").trim();
        cache.set(key, v);
      }
      return v;
    },
  };
}

const lc = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function findLabel(
  g: Grid,
  match: RegExp,
  fromRow = 1,
  toRow = g.rows,
): { r: number; c: number } | null {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= g.cols; c++) if (match.test(lc(g.text(r, c)))) return { r, c };
  }
  return null;
}

/** The first non-empty cell to the right of a label that is not the label repeated. */
function valueRightOf(g: Grid, at: { r: number; c: number } | null): string {
  if (!at) return "";
  const label = g.text(at.r, at.c);
  for (let c = at.c + 1; c <= g.cols; c++) {
    const v = g.text(at.r, c);
    if (v && v !== label) return v;
  }
  return "";
}

function labelValue(g: Grid, match: RegExp, toRow = 20): string {
  return valueRightOf(g, findLabel(g, match, 1, toRow));
}

function isoDate(text: string): string | null {
  const t = dateText(text.trim());
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? t : null;
}

/** Does this sheet look like an FT-05 certificate? */
export function isCertificateSheet(sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook): boolean {
  const g = gridOf(sheet, workbook);
  return (
    findLabel(g, /^certificate no/, 1, 15) !== null &&
    findLabel(g, /^date of calibration/, 1, 15) !== null &&
    findLabel(g, /actual output|^master reading/, 1, g.rows) !== null
  );
}

export function readCertificateSheet(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
): { certificate: WorkbookCertificate | null; problems: string[] } {
  const g = gridOf(sheet, workbook);
  const problems: string[] = [];
  const where = `Sheet “${sheet.name}”`;

  const number = labelValue(g, /^certificate no/);
  const calibratedOn = isoDate(labelValue(g, /^date of calibration/));
  const dueText = labelValue(g, /^due date/);
  const validUntil = isoDate(dueText);
  if (!number)
    return { certificate: null, problems: [`${where}: no certificate number; skipped.`] };
  if (!calibratedOn) {
    return {
      certificate: null,
      problems: [`${where} (${number}): no date of calibration; skipped.`],
    };
  }
  if (dueText && !validUntil && !/^n\.?a\.?$/i.test(dueText)) {
    problems.push(
      `${where} (${number}): due date “${dueText}” is not a date; recorded without one.`,
    );
  }

  // Customer: the name on the label's row, the address on the next row with the same label.
  const customerAt = findLabel(g, /^customer name/, 1, 20);
  let customerName = valueRightOf(g, customerAt);
  let customerAddress = "";
  if (customerAt && lc(g.text(customerAt.r + 1, customerAt.c)).startsWith("customer name")) {
    customerAddress = valueRightOf(g, { r: customerAt.r + 1, c: customerAt.c });
  }
  if (customerName.includes("\n")) {
    [customerName = "", customerAddress = ""] = [
      customerName.split("\n")[0]!,
      customerName.split("\n").slice(1).join(", "),
    ];
  }

  // Environmental conditions: "Temperature: 22 °C" and "Humidity: 51 %RH", wherever they sit.
  const envAt = findLabel(g, /^environmental condition/, 1, 25);
  let envText = "";
  if (envAt) {
    for (let r = envAt.r; r <= envAt.r + 1; r++) {
      const seen = new Set<string>();
      for (let c = envAt.c + 1; c <= g.cols; c++) {
        const v = g.text(r, c);
        if (v && !seen.has(v)) {
          seen.add(v);
          envText += ` ${v}`;
        }
      }
    }
  }
  const temp = /temp[a-z]*\s*:?\s*(-?\d+(?:\.\d+)?)\s*°?\s*c/i.exec(envText);
  const hum = /(?:humidity|rh)\s*:?\s*(\d+(?:\.\d+)?)\s*%/i.exec(envText);

  // Reference standards table.
  const masters: WorkbookMaster[] = [];
  const refHead = findLabel(g, /^name of equipment/, 1, g.rows);
  if (refHead) {
    const col: Record<string, number> = {};
    for (let c = refHead.c; c <= g.cols; c++) {
      const h = lc(g.text(refHead.r, c));
      if (/^make/.test(h) && col.make === undefined) col.make = c;
      else if (/^model/.test(h) && col.model === undefined) col.model = c;
      else if (/^serial/.test(h) && col.serial === undefined) col.serial = c;
      else if (/^due/.test(h) && col.due === undefined) col.due = c;
      else if (/^cert/.test(h) && col.cert === undefined) col.cert = c;
    }
    for (let r = refHead.r + 1; r <= g.rows; r++) {
      const name = g.text(r, refHead.c);
      if (!name || /observation|^sr\.? ?no/i.test(name)) break;
      const at = (k: string) => (col[k] === undefined ? "" : g.text(r, col[k]!));
      if (!at("cert") && !at("serial")) continue;
      masters.push({
        name,
        make: at("make"),
        model: at("model"),
        serialNo: at("serial"),
        validUntil: isoDate(at("due")),
        certificateNo: at("cert"),
      });
    }
  }

  // Observation blocks: a header row naming the serial/ID column, then pairs of rows
  // ("Actual Output in °C", "Deviation °C") per test point.
  const points: WorkbookCertificate["points"] = [];
  const instruments: WorkbookCertificate["instruments"] = [];
  const cells = new Map<string, string>(); // `${point}|${instrument}` → reading
  // Each block starts with a "Master Reading … UUC Reading" row; the row under it
  // names the instruments in consecutive columns right of the UUC heading.
  for (let hr = 1; hr <= g.rows; hr++) {
    let uucCol = 0;
    let hasMaster = false;
    for (let c = 1; c <= g.cols; c++) {
      const h = lc(g.text(hr, c));
      if (/^master reading/.test(h)) hasMaster = true;
      if (/^uuc reading/.test(h) && !uucCol) uucCol = c;
    }
    if (!hasMaster || !uucCol) continue;
    const head = hr + 1;
    let tempCol = 0;
    let rhCol = 0;
    for (let c = 1; c < uucCol; c++) {
      const h = lc(g.text(head, c));
      if (/°c|deg/.test(h) && !tempCol) tempCol = c;
      if (/rh/.test(h) && !rhCol) rhCol = c;
    }
    const block: number[] = [];
    const blockCols: number[] = [];
    let previous = "";
    for (let c = uucCol + 1; c <= g.cols; c++) {
      const raw = g.text(head, c);
      if (!raw) break; // the table ends at the first empty heading; working cells sit further right
      if (raw === previous) continue; // a merged heading repeated
      // A bare reading (-25.2, 15.3) is a working cell right of the table, not a logger.
      if (/^-?\d+(\.\d+)?$/.test(raw.trim()) && !/^\d{6,12}$/.test(raw.trim())) break;
      previous = raw;
      const parts = raw.split(/[\s/]+/).filter(Boolean);
      const serialNo = parts.find((p) => /^\d{6,12}$/.test(p)) ?? "";
      const code = parts.filter((p) => p !== serialNo).join(" ");
      let index = instruments.findIndex(
        (i) =>
          (serialNo !== "" && i.serialNo === serialNo) ||
          (code !== "" && i.code.toLowerCase() === code.toLowerCase()),
      );
      if (index < 0) {
        instruments.push({ code, serialNo });
        index = instruments.length - 1;
      }
      block.push(index);
      blockCols.push(c);
    }
    // Elitech sheets print "Serial No." on one row and "ID No." on the row under it.
    if (
      /^serial/.test(lc(g.text(head, uucCol)).trim()) &&
      /^id\.? ?no/.test(lc(g.text(head + 1, uucCol)).trim())
    ) {
      blockCols.forEach((c, i) => {
        const id = g.text(head + 1, c).trim();
        const inst = instruments[block[i]!]!;
        if (!id || inst.code.toLowerCase() === id.toLowerCase()) return;
        if (!inst.serialNo) inst.serialNo = inst.code;
        inst.code = id;
      });
    }
    let r = head + 1;
    for (; r <= g.rows; r++) {
      if (
        [...Array(Math.min(g.cols, 30)).keys()].some((i) =>
          /^master reading/.test(lc(g.text(r, i + 1))),
        )
      )
        break;
      if (/^remarks/.test(lc(g.text(r, 1))) || /^remarks/.test(lc(g.text(r, 2)))) break;
      const label = lc(g.text(r, uucCol));
      if (!/actual output|^reading/.test(label)) continue;
      const quantity: Quantity = /rh|humid/.test(label) ? "humidity" : "temperature";
      const tText = tempCol ? g.text(r, tempCol) : "";
      const hText = rhCol ? g.text(r, rhCol) : "";
      const refText = quantity === "humidity" ? hText : tText;
      const otherText = quantity === "humidity" ? tText : hText;
      const reference = cleanDecimal(refText);
      if (reference === null) {
        problems.push(
          `${where} (${number}) row ${r}: master reading “${refText}” is not a number; point skipped.`,
        );
        continue;
      }
      const condNumber = /-?\d+(?:\.\d+)?/.exec(otherText)?.[0];
      const condition = condNumber
        ? quantity === "humidity"
          ? `${condNumber} °C`
          : `${condNumber} %RH`
        : "";
      let p = points.findIndex(
        (x) => x.quantity === quantity && x.reference === reference && x.condition === condition,
      );
      if (p < 0) {
        points.push({ quantity, reference, condition });
        p = points.length - 1;
      }
      blockCols.forEach((c, i) => {
        const v = g.text(r, c);
        if (v === "" || v === "-") return;
        const reading = cleanDecimal(v);
        if (reading === null) {
          problems.push(
            `${where} (${number}) row ${r}: reading “${v}” is not a number; left empty.`,
          );
          return;
        }
        cells.set(`${p}|${block[i]}`, reading);
      });
    }
    hr = r - 1;
  }
  if (instruments.length === 0) {
    return {
      certificate: null,
      problems: [
        ...problems,
        `${where} (${number}): no instruments found in the observation table; skipped.`,
      ],
    };
  }

  return {
    certificate: {
      sheet: sheet.name,
      number,
      calibratedOn,
      validUntil,
      customerName,
      customerAddress,
      location: labelValue(g, /^location/),
      department: labelValue(g, /^department/),
      equipmentName: labelValue(g, /^equipment name/),
      make: labelValue(g, /^make$/),
      model: labelValue(g, /^model$/),
      rangeText: labelValue(g, /^range/),
      resolutionText: labelValue(g, /^resolution/),
      sopNo: labelValue(g, /^calibration sop/),
      conditionOnReceipt: labelValue(g, /^condition on receipt/),
      accuracyText: labelValue(g, /^accuracy/),
      environmentTemperature: temp ? `${temp[1]} °C` : "",
      environmentHumidity: hum ? `${hum[1]} %RH` : "",
      masters,
      points,
      instruments,
      readings: points.map((_, p) => instruments.map((_, i) => cells.get(`${p}|${i}`) ?? "")),
    },
    problems,
  };
}
