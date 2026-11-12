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
  /** QA Tech IDs printed for the master ("ID NO. QATM/CAL/TL-30"), when the sheet gives IDs, not serials. */
  codes?: string[];
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

/**
 * The value beside a label, or under it: some sheets print "Date of Calibration |
 * Due Date | Issue Date | Certificate No." as one row of headings with the values below.
 */
function rightOrBelow(g: Grid, match: RegExp, looksRight: (v: string) => boolean): string {
  const at = findLabel(g, match, 1, 20);
  if (!at) return "";
  const right = valueRightOf(g, at);
  if (right && looksRight(right)) return right;
  const below = g.text(at.r + 1, at.c);
  if (below && looksRight(below)) return below;
  return right;
}

function isoDate(text: string): string | null {
  const t = dateText(text.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  // A typed 30.02.2027 is not a date: JavaScript would quietly roll it into March.
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null;
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

  const number = rightOrBelow(g, /^certificate no/, (v) => /\d/.test(v) && v.includes("/"));
  const calibratedOn = isoDate(rightOrBelow(g, /^date of calibration/, (v) => !!isoDate(v)));
  const dueText = rightOrBelow(g, /^due date/, (v) => !!isoDate(v) || /^n\.?a\.?$/i.test(v));
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

// ------------------------------------------------- one instrument per sheet

/**
 * The other FT-05 layout: one instrument per sheet ("T-TRH0364.xls", Sikkim's
 * Testo loggers), with "Instrument Code No.", "Serial No." and observation
 * tables of Input / Master Reading / UUC Reading per quantity, and a
 * "Calibration standards used" table that names the masters by QA Tech ID.
 */
export function isSingleCertificateSheet(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
): boolean {
  const g = gridOf(sheet, workbook);
  return (
    findLabel(g, /^calibration certificate no/, 1, 8) !== null &&
    findLabel(g, /^instrument code\b/, 1, 8) !== null &&
    findLabel(g, /^uuc reading/, 1, g.rows) !== null
  );
}

/** The value after "Label :" in the same cell, else the next cell right that isn't ":" or the label. */
function fieldValue(g: Grid, match: RegExp, toRow = 20): string {
  const at = findLabel(g, match, 1, toRow);
  if (!at) return "";
  const own = /:\s*(.+)$/.exec(g.text(at.r, at.c))?.[1]?.trim();
  if (own) return own;
  const label = g.text(at.r, at.c);
  for (let c = at.c + 1; c <= g.cols; c++) {
    const v = g.text(at.r, c);
    if (v && v !== ":" && v !== label) return v.replace(/^:\s*/, "");
  }
  return "";
}

export function readSingleCertificateSheet(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
): { certificate: WorkbookCertificate | null; problems: string[] } {
  const g = gridOf(sheet, workbook);
  const where = `Sheet “${sheet.name}”`;
  const number = fieldValue(g, /^calibration certificate no/, 6);
  const code = fieldValue(g, /^instrument code\b/, 6);
  const calibratedOn = isoDate(fieldValue(g, /^calibration date/));
  const validUntil = isoDate(fieldValue(g, /^calibration due date/));
  if (!number)
    return { certificate: null, problems: [`${where}: no certificate number; skipped.`] };
  if (!calibratedOn) {
    return { certificate: null, problems: [`${where} (${number}): no calibration date; skipped.`] };
  }
  const serial = fieldValue(g, /^serial no/).replace(/\.0+$/, "");
  const makeModel = fieldValue(g, /^make ?& ?model/);
  const [make = "", model = ""] = makeModel.split(/\s*&\s*/);
  const customerAt = findLabel(g, /^customer name/, 1, 10);
  const customerName = fieldValue(g, /^customer name/, 10);
  let customerAddress = "";
  if (customerAt) {
    for (let c = 1; c <= g.cols && !customerAddress; c++) {
      const v = g.text(customerAt.r + 1, c);
      if (v && !/^instrument/i.test(v)) customerAddress = v;
    }
  }
  // These sit in one cell with their label ("Calibration SOP NO. : QATECH/CAL-026").
  const cellWith = (match: RegExp) => {
    const at = findLabel(g, match, 1, 25);
    return at ? g.text(at.r, at.c) : "";
  };
  const sop = /sop no\.?\s*:?\s*([A-Z0-9/-]+)/i.exec(cellWith(/sop no/));
  const envT = /temperature\s*:\s*(.+)$/i.exec(cellWith(/^temperature\s*:/));
  const envH = /humidity\s*:\s*(.+)$/i.exec(cellWith(/humidity\s*:/));

  // Observation tables: a heading row with Master and UUC Reading, a units row, then
  // one row per point while the first column is a number.
  const points: WorkbookCertificate["points"] = [];
  const readings: string[][] = [];
  const problems: string[] = [];
  for (let hr = 1; hr <= g.rows; hr++) {
    let masterCol = 0;
    let uucCol = 0;
    for (let c = 1; c <= g.cols; c++) {
      const h = lc(g.text(hr, c));
      if (/^master reading/.test(h) && !masterCol) masterCol = c;
      if (/^uuc reading/.test(h) && !uucCol) uucCol = c;
    }
    if (!masterCol || !uucCol) continue;
    let srCol = 1;
    for (let c = 1; c < masterCol; c++) if (/^sr\.? ?no/.test(lc(g.text(hr, c)))) srCol = c;
    // The units row ("°C" or "%RH") sits a row or two under the heading.
    let unitRow = hr + 1;
    while (unitRow <= hr + 3 && !g.text(unitRow, masterCol)) unitRow += 1;
    const unit = lc(g.text(unitRow, masterCol));
    const quantity: Quantity = /rh|%/.test(unit) ? "humidity" : "temperature";
    let r = unitRow;
    for (; r <= g.rows; r++) {
      const sr = g.text(r, srCol);
      if (!sr && points.length && !g.text(r, masterCol)) break;
      if (!/^\d+$/.test(sr)) {
        // Merged heading cells repeat above the first point; after the points, the table ends.
        if (r <= unitRow + 1 || !sr) continue;
        break;
      }
      const reference = cleanDecimal(g.text(r, masterCol));
      const reading = cleanDecimal(g.text(r, uucCol));
      if (reference === null) {
        problems.push(
          `${where} (${number}) row ${r}: master reading “${g.text(r, masterCol)}” is not a number; point skipped.`,
        );
        continue;
      }
      points.push({ quantity, reference, condition: "" });
      readings.push([reading ?? ""]);
    }
    hr = r - 1;
  }
  if (points.length === 0) {
    return {
      certificate: null,
      problems: [...problems, `${where} (${number}): no readings found; skipped.`],
    };
  }

  // Standards used: the name cell holds "… MAKE : ISOTECH, ID NO. QATM/CAL/TL-02 B (Sensor), …".
  const masters: WorkbookMaster[] = [];
  const head = findLabel(g, /^name,? make/, 1, g.rows);
  if (head) {
    const col: Record<string, number> = {};
    for (let c = head.c + 1; c <= g.cols; c++) {
      const h = lc(g.text(head.r, c));
      if (/^cert/.test(h) && col.cert === undefined) col.cert = c;
      else if (/valid|due/.test(h) && col.due === undefined) col.due = c;
    }
    for (let r = head.r + 1; r <= g.rows; r++) {
      const text = g.text(r, head.c);
      if (!text || /^remark/i.test(text)) break;
      const make = /make\s*:\s*([^,&]+)/i.exec(text)?.[1]?.trim() ?? "";
      const ids = (/id\.? ?no\.?\s*:?\s*(.+)$/i.exec(text)?.[1] ?? "")
        .split(/,|\band\b/i)
        .map((x) =>
          x
            .replace(/\((sensor|indicator)\)/gi, "")
            .replace(/\s+/g, "")
            .trim(),
        )
        .filter((x) => /[A-Z]+-?\d/i.test(x));
      masters.push({
        name: text
          .split(/\s*make\s*:/i)[0]!
          .replace(/,\s*$/, "")
          .trim(),
        make,
        model: "",
        serialNo: "",
        validUntil: isoDate(col.due ? g.text(r, col.due) : ""),
        certificateNo: col.cert ? g.text(r, col.cert) : "",
        codes: ids,
      });
    }
  }

  return {
    certificate: {
      sheet: sheet.name,
      number,
      calibratedOn,
      validUntil,
      customerName,
      customerAddress,
      location: fieldValue(g, /^location/),
      department: fieldValue(g, /^section/),
      equipmentName: fieldValue(g, /^instrument\/?equipment name/),
      make,
      model,
      rangeText: fieldValue(g, /^range/),
      resolutionText: fieldValue(g, /^least count/),
      sopNo: sop?.[1] ?? "",
      conditionOnReceipt: "",
      accuracyText: fieldValue(g, /^specified accuracy/),
      environmentTemperature: envT?.[1]?.trim() ?? "",
      environmentHumidity: envH?.[1]?.trim() ?? "",
      masters,
      points,
      instruments: [{ code, serialNo: /^\d{6,12}$/.test(serial) ? serial : "" }],
      readings,
    },
    problems,
  };
}
