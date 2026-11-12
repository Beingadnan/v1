/**
 * Reading QA Tech's existing instrument files and planning what an import
 * would add. Pure: no database, so it is unit-tested against the real layouts.
 *
 * Three kinds of file are read, sheet by sheet:
 * - lists with columns (ID No., Serial No., Certificate No., dates…), found by
 *   their headings in any order; a batch's certificate number written only on
 *   its first row is carried down to the rows below with the same date;
 * - bare serial lists (a delivery note, "Data logger details"): serials with
 *   no QA Tech ID, which can be given IDs from a prefix;
 * - FT-05 certificate workbooks, one certificate per sheet with every reading
 *   (see certificate-workbook.ts); a certificate spread over several sheets is
 *   joined back into one.
 */
import ExcelJS from "exceljs";

import { cellText, dateText } from "@/domain/clients/import/workbook";

import { firstCodes, lastCodeIn, nextCodes } from "./codes";
import { INSTRUMENT_CODE } from "./schemas";
import {
  isCertificateSheet,
  isSingleCertificateSheet,
  readCertificateSheet,
  readSingleCertificateSheet,
  type WorkbookCertificate,
} from "./certificate-workbook";
import {
  INSTRUMENT_TYPE_INFO,
  instrumentTypeFromText,
  type InstrumentType,
  type Quantity,
} from "./types";

export type ListRow = {
  sheet: string;
  row: number;
  name: string;
  make: string;
  model: string;
  code: string;
  serialNo: string;
  certificateNo: string;
  rangeText: string;
  calibratedOn: string | null;
  validUntil: string | null;
  /** Filled when the number was carried down from a row above. */
  carried: boolean;
};

const COLUMNS: { key: keyof ListRow; match: RegExp }[] = [
  { key: "name", match: /^(instrument|equipment) ?name|^instrument$|^description/ },
  { key: "make", match: /^make/ },
  { key: "model", match: /^model/ },
  { key: "code", match: /^(id|i\.d\.?) ?(no|number)|^instrument id|^id$|^qa ?tech id/ },
  // "Sr. No." alone is a row number; "Data Logger Sr.No." and "Serial no" are serials.
  { key: "serialNo", match: /serial|^s\/?n\b|logger sr\.? ?no|^sr\.? ?no\.? of instrument/ },
  { key: "certificateNo", match: /^cert(ificate)? ?(no|number)/ },
  { key: "rangeText", match: /^range/ },
  { key: "calibratedOn", match: /^cal(ibration|\.)? ?date|^date of cal/ },
  { key: "validUntil", match: /^(cal(ibration|\.)? )?due ?date|^due/ },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const SERIAL = /^\d{6,12}$/;

function isoOrNull(text: string): string | null {
  const t = dateText(text.trim());
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? t : null;
}

export type ReadResult = {
  rows: ListRow[];
  workbookCertificates: WorkbookCertificate[];
  problems: string[];
};

/** Header-less sheet: the column that is mostly unique 6–12 digit numbers holds serials. */
function guessSerialColumn(sheet: ExcelJS.Worksheet): { col: number; firstRow: number } | null {
  const counts = new Map<number, { serials: Set<string>; filled: number; firstRow: number }>();
  for (let r = 1; r <= Math.min(80, sheet.rowCount); r++) {
    const values = sheet.getRow(r).values as ExcelJS.CellValue[];
    values.forEach((v, c) => {
      const text = cellText(v ?? null);
      if (!text) return;
      const entry = counts.get(c) ?? { serials: new Set<string>(), filled: 0, firstRow: 0 };
      entry.filled += 1;
      if (SERIAL.test(text)) {
        entry.serials.add(text);
        if (!entry.firstRow) entry.firstRow = r;
      }
      counts.set(c, entry);
    });
  }
  let best: { col: number; firstRow: number; n: number } | null = null;
  for (const [col, e] of counts) {
    if (
      e.serials.size >= 3 &&
      e.serials.size >= 0.8 * e.filled - 2 &&
      (!best || e.serials.size > best.n)
    ) {
      best = { col, firstRow: e.firstRow, n: e.serials.size };
    }
  }
  return best ? { col: best.col, firstRow: best.firstRow } : null;
}

/**
 * Column groups in a header row. A list printed as blocks side by side
 * (Sr. No. | Serial No. | ID, three times across) gives one group per block.
 */
function headerGroups(values: ExcelJS.CellValue[]): Partial<Record<keyof ListRow, number>>[] {
  const groups: Partial<Record<keyof ListRow, number>>[] = [];
  let current: Partial<Record<keyof ListRow, number>> = {};
  values.forEach((v, i) => {
    const text = norm(cellText(v ?? null));
    if (!text || /^sr\.? ?no\.?$/.test(text)) return;
    const col = COLUMNS.find((c) => c.match.test(text));
    if (!col) return;
    if (current[col.key] !== undefined) {
      // The same heading again: a new block starts here.
      groups.push(current);
      current = {};
    }
    current[col.key] = i;
  });
  groups.push(current);
  return groups.filter((g) => g.code !== undefined || g.serialNo !== undefined);
}

function readListSheet(sheet: ExcelJS.Worksheet, problems: string[]): ListRow[] {
  // Header: the first of the top ten rows that names an ID or serial column.
  let header = 0;
  let groups: Partial<Record<keyof ListRow, number>>[] = [];
  for (let r = 1; r <= Math.min(10, sheet.rowCount) && !header; r++) {
    const found = headerGroups(sheet.getRow(r).values as ExcelJS.CellValue[]);
    if (found.length) {
      header = r;
      groups = found;
    }
  }
  if (!header) {
    const guess = guessSerialColumn(sheet);
    if (!guess) {
      if (sheet.rowCount > 0) {
        problems.push(`Sheet “${sheet.name}”: no ID or serial number column found; skipped.`);
      }
      return [];
    }
    groups = [{ serialNo: guess.col }];
    header = guess.firstRow - 1;
    const letter = String.fromCharCode(64 + guess.col);
    problems.push(
      `Sheet “${sheet.name}” has no column headings: column ${letter} was read as serial numbers.`,
    );
  }
  const rows = groups.flatMap((at) => readBlock(sheet, header, at, problems));

  // "Id No" filled with the model name ("EBI 20-T1" on every row) is not an ID.
  const codes = rows.map((x) => x.code).filter(Boolean);
  if (codes.length >= 3 && new Set(codes.map((c) => c.toLowerCase())).size <= codes.length / 2) {
    for (const row of rows) {
      if (!row.model) row.model = row.code;
      row.code = "";
    }
    problems.push(
      `Sheet “${sheet.name}”: the ID column repeats “${codes[0]}”, so it was read as the model, not as QA Tech IDs.`,
    );
    return rows;
  }
  // Serial numbers pasted below a list land in its ID column: an all-digit "ID"
  // on a row with nothing else, in a list whose IDs have letters, is not one.
  const lettered = codes.filter((c) => /[a-z]/i.test(c)).length;
  if (lettered >= 3 && lettered >= codes.length / 2) {
    return rows.filter((row) => {
      if (!row.code || /[a-z]/i.test(row.code)) return true;
      const bare = !row.name && !row.make && !row.model && !row.calibratedOn && !row.certificateNo;
      problems.push(
        bare
          ? `${sheet.name} row ${row.row}: ID “${row.code}” looks like a serial number, not a QA Tech ID; skipped.`
          : `${sheet.name} row ${row.row}: ID “${row.code}” looks like a serial number; check it.`,
      );
      return !bare;
    });
  }
  return rows;
}

function readBlock(
  sheet: ExcelJS.Worksheet,
  header: number,
  at: Partial<Record<keyof ListRow, number>>,
  problems: string[],
): ListRow[] {
  const rows: ListRow[] = [];
  let lastCert = "";
  let lastDate: string | null = null;
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as ExcelJS.CellValue[];
    const get = (key: keyof ListRow) =>
      at[key] === undefined ? "" : cellText(values[at[key]!] ?? null);
    const row: ListRow = {
      sheet: sheet.name,
      row: r,
      name: get("name"),
      make: get("make"),
      model: get("model"),
      code: get("code"),
      serialNo: get("serialNo"),
      certificateNo: get("certificateNo"),
      rangeText: get("rangeText").replace(/\s+/g, " "),
      calibratedOn: isoOrNull(get("calibratedOn")),
      validUntil: isoOrNull(get("validUntil")),
      carried: false,
    };
    if (!row.code && !row.serialNo) continue; // blank or a note line
    // A header-less guess only takes real serials, not stray numbers below the list.
    if (at.code === undefined && !SERIAL.test(row.serialNo)) continue;
    const dueText = get("validUntil");
    if (dueText && !row.validUntil && !/^n\.?a\.?$/i.test(dueText)) {
      problems.push(`${sheet.name} row ${r}: due date “${dueText}” is not a date; left empty.`);
    }
    const calText = get("calibratedOn");
    if (calText && !row.calibratedOn) {
      problems.push(
        `${sheet.name} row ${r}: calibration date “${calText}” is not a date; no certificate recorded for this row.`,
      );
    }
    if (row.calibratedOn && row.validUntil && row.validUntil < row.calibratedOn) {
      problems.push(
        `${sheet.name} row ${r}: due date ${row.validUntil} is before the calibration date ${row.calibratedOn}; left empty.`,
      );
      row.validUntil = null;
    }
    if (row.certificateNo) {
      lastCert = row.certificateNo;
      lastDate = row.calibratedOn;
    } else if (lastCert && row.calibratedOn && row.calibratedOn === lastDate) {
      row.certificateNo = lastCert;
      row.carried = true;
    }
    rows.push(row);
  }
  return rows;
}

export async function readInstrumentList(bytes: Uint8Array): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return {
      rows: [],
      workbookCertificates: [],
      problems: ["This is not an Excel workbook (.xlsx). Save it as .xlsx and try again."],
    };
  }
  const rows: ListRow[] = [];
  const workbookCertificates: WorkbookCertificate[] = [];
  const problems: string[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state === "hidden" || sheet.state === "veryHidden") continue;
    if (isCertificateSheet(sheet, workbook)) {
      const read = readCertificateSheet(sheet, workbook);
      problems.push(...read.problems);
      if (read.certificate) workbookCertificates.push(read.certificate);
      continue;
    }
    if (isSingleCertificateSheet(sheet, workbook)) {
      const read = readSingleCertificateSheet(sheet, workbook);
      problems.push(...read.problems);
      if (read.certificate) workbookCertificates.push(read.certificate);
      continue;
    }
    rows.push(...readListSheet(sheet, problems));
  }
  for (const c of workbookCertificates) {
    if (c.validUntil && c.calibratedOn && c.validUntil <= c.calibratedOn) {
      problems.push(
        `${c.number}: due date ${c.validUntil.split("-").reverse().join(".")} is not after the calibration date ${c.calibratedOn.split("-").reverse().join(".")}; imported without a due date. Check the certificate.`,
      );
      c.validUntil = null;
    }
  }
  return { rows, workbookCertificates, problems };
}

// ---------------------------------------------------------------- plan

export type Snapshot = {
  models: { id: string; make: string; model: string }[];
  instruments: { id: string; code: string; serialNo: string; make: string; tier?: string }[];
  certificates: {
    id: string;
    number: string;
    labName: string;
    itemIds: string[];
    /** ISO date; absent in older snapshots. */
    calibratedOn?: string | null;
    /** "imported", "internal" or "external"; absent in older snapshots. */
    kind?: string;
  }[];
  sites: { id: string; code: string; name: string }[];
  labName: string;
  /**
   * Each recorded certificate's readings, one print per instrument
   * ("reference=reading;" per point in order), to spot a sheet copied from
   * another certificate.
   */
  readingPrints?: { number: string; prints: string[] }[];
};

/** One instrument's readings on a certificate, comparable across certificates. */
export const readingPrint = (pairs: { reference: string; reading: string }[]) =>
  pairs.map((p) => `${Number(p.reference)}=${Number(p.reading)}`).join(";");

export type ImportOptions = {
  defaultType: InstrumentType;
  /** Give serials without a QA Tech ID the next IDs of this prefix, as this model. */
  assign?: { prefix: string; modelId: string | null } | null;
  /** Model for new instruments from a list that names neither make nor model. */
  listModelId?: string | null;
  /**
   * ID prefixes that are a client's own equipment, not QA Tech's (e.g. "E ENG GEN TE-"
   * on Gennova's sensors): left out, and a certificate naming only those is skipped.
   */
  notOurs?: string[];
};

const squash = (code: string) => code.replace(/\s+/g, "").toLowerCase();

/** The read with every instrument whose ID starts with one of `prefixes` taken out. */
function withoutTheirs(read: ReadResult, prefixes: string[]): ReadResult {
  const keys = prefixes.map(squash).filter(Boolean);
  if (keys.length === 0) return read;
  const theirs = (code: string) => keys.some((k) => squash(code).startsWith(k));
  const problems = [...read.problems];
  const workbookCertificates = read.workbookCertificates.flatMap((c) => {
    const keep = c.instruments
      .map((i, index) => (theirs(i.code) ? -1 : index))
      .filter((i) => i >= 0);
    if (keep.length === c.instruments.length) return [c];
    if (keep.length === 0) {
      problems.push(`${c.number}: every instrument on it is the client's own equipment; skipped.`);
      return [];
    }
    problems.push(
      `${c.number}: ${c.instruments.length - keep.length} of its instruments are the client's own equipment; left out.`,
    );
    return [
      {
        ...c,
        instruments: keep.map((i) => c.instruments[i]!),
        readings: c.readings.map((row) => keep.map((i) => row[i] ?? "")),
      },
    ];
  });
  return {
    ...read,
    rows: read.rows.filter((r) => !theirs(r.code)),
    workbookCertificates,
    problems,
  };
}

export type PlannedModel = {
  key: string;
  type: InstrumentType;
  make: string;
  model: string;
  equipmentName: string;
  rangeText: string;
  quantities: Quantity[];
};
export type PlannedInstrument = {
  code: string;
  serialNo: string;
  make: string;
  model: string;
  type: InstrumentType;
  equipmentName: string;
  rangeText: string;
  modelKey: string | null;
  row: string;
  /** True when the ID was given by the import (the file had none). */
  generated: boolean;
};
export type PlannedCertificate = {
  number: string;
  /** True when the list had no number for these rows. */
  unnumbered: boolean;
  certificateKind: string;
  siteId: string | null;
  calibratedOn: string;
  validUntil: string | null;
  existingId: string | null;
  codes: string[];
};
/** A full FT-05 certificate from a workbook: header, masters, points and readings. */
export type PlannedFullCertificate = Omit<
  WorkbookCertificate,
  "sheet" | "instruments" | "readings" | "masters"
> & {
  sheets: string[];
  certificateKind: string;
  siteId: string | null;
  modelKey: string | null;
  codes: string[];
  /** readings[point][code index] */
  readings: string[][];
  masters: {
    label: string;
    certificateNo: string;
    serialNo: string;
    validUntil: string | null;
    instrumentId: string | null;
    certificateId: string | null;
  }[];
  /** Instruments printed on it that could not be imported (no QA Tech ID). */
  missing: number;
  /** Why it was imported under a number other than the one printed. */
  note?: string;
  /** Set when the certificate is already recorded: only these instruments are added to it. */
  existingId?: string;
};
export type ImportPlan = {
  models: PlannedModel[];
  instruments: PlannedInstrument[];
  certificates: PlannedCertificate[];
  fullCertificates: PlannedFullCertificate[];
  alreadyRecorded: string[];
  alreadyRegistered: number;
  /** Serials with no QA Tech ID, waiting for an ID prefix. */
  unassigned: { serialNo: string; make: string; model: string; row: string }[];
  skipped: { row: string; reason: string }[];
  problems: string[];
};

/** Make and model compared loosely: "EBRO"/"EBI - 20TH1" is ebro EBI 20-TH1. */
export const modelKey = (make: string, model: string) =>
  `${make.toLowerCase().replace(/[^a-z0-9]/g, "")}|${model.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

function quantitiesFrom(text: string, type: InstrumentType): Quantity[] {
  const t = text.toLowerCase();
  const q: Quantity[] = [];
  if (/°|deg|\bc\b|temp/.test(t) || type !== "humidity_indicator") q.push("temperature");
  if (/rh|humid/.test(t)) q.push("humidity");
  if (/bar|psi|pa\b|pressure/.test(t)) q.push("pressure");
  return q.length ? [...new Set(q)] : ["temperature"];
}

/** QATECH/BHIWANDI/08/25/PDL-23 → { kind: "PDL", site: "BHIWANDI" }. */
export function parseCertificateNumber(number: string): { kind: string; site: string } {
  const parts = number.split("/");
  const last = parts.at(-1) ?? "";
  const kind = /^([A-Za-z]+)[-\s]?\d+/.exec(last)?.[1]?.toUpperCase() ?? "";
  return { kind, site: parts.length >= 4 ? (parts[1] ?? "") : "" };
}

/** Joins sheets that carry the same certificate number (one certificate over several pages). */
function mergeWorkbookCertificates(list: WorkbookCertificate[], problems: string[]) {
  const merged = new Map<
    string,
    { base: WorkbookCertificate; sheets: string[]; cells: Map<string, string> }
  >();
  const pointKey = (p: WorkbookCertificate["points"][number]) =>
    `${p.quantity}|${p.reference}|${p.condition}`;
  const instKey = (i: WorkbookCertificate["instruments"][number]) =>
    i.serialNo || i.code.toLowerCase();
  for (const c of list) {
    const key = c.number.toLowerCase();
    let m = merged.get(key);
    if (!m) {
      m = {
        base: { ...c, points: [], instruments: [], readings: [] },
        sheets: [],
        cells: new Map(),
      };
      merged.set(key, m);
    } else if (m.base.calibratedOn !== c.calibratedOn) {
      problems.push(
        `${c.number}: sheet “${c.sheet}” has date ${c.calibratedOn}, sheet “${m.sheets[0]}” ${m.base.calibratedOn}. Joined under the first date.`,
      );
    }
    m.sheets.push(c.sheet);
    for (const p of c.points)
      if (!m.base.points.some((x) => pointKey(x) === pointKey(p))) m.base.points.push(p);
    for (const i of c.instruments)
      if (!m.base.instruments.some((x) => instKey(x) === instKey(i))) m.base.instruments.push(i);
    for (const master of c.masters) {
      if (!m.base.masters.some((x) => x.certificateNo === master.certificateNo))
        m.base.masters.push(master);
    }
    c.points.forEach((p, pi) =>
      c.instruments.forEach((inst, ii) => {
        const v = c.readings[pi]?.[ii] ?? "";
        if (v) m!.cells.set(`${pointKey(p)}#${instKey(inst)}`, v);
      }),
    );
  }
  return [...merged.values()].map(({ base, sheets, cells }) => ({
    ...base,
    sheets,
    readings: base.points.map((p) =>
      base.instruments.map((i) => cells.get(`${pointKey(p)}#${instKey(i)}`) ?? ""),
    ),
  }));
}

export function planInstrumentImport(
  read: ReadResult,
  snapshot: Snapshot,
  options: ImportOptions = { defaultType: "portable_logger" },
): ImportPlan {
  read = withoutTheirs(read, options.notOurs ?? []);
  const plan: ImportPlan = {
    models: [],
    instruments: [],
    certificates: [],
    fullCertificates: [],
    alreadyRecorded: [],
    alreadyRegistered: 0,
    unassigned: [],
    skipped: [],
    problems: [...read.problems],
  };
  const models = new Map(snapshot.models.map((m) => [modelKey(m.make, m.model), m]));
  const byCode = new Map(snapshot.instruments.map((i) => [i.code.toLowerCase(), i]));
  const bySerial = new Map<string, (typeof snapshot.instruments)[number][]>();
  for (const i of snapshot.instruments) {
    if (i.serialNo) bySerial.set(i.serialNo, [...(bySerial.get(i.serialNo) ?? []), i]);
  }
  const plannedByCode = new Map<string, PlannedInstrument>();
  const plannedBySerial = new Map<string, PlannedInstrument>();
  const counted = new Set<string>();
  const assignModel = options.assign?.modelId
    ? snapshot.models.find((m) => m.id === options.assign!.modelId)
    : undefined;
  let lastAssigned: string | null = null;
  const nextAssignedCode = () => {
    const prefix = options.assign!.prefix;
    const last =
      lastAssigned ??
      lastCodeIn([...snapshot.instruments.map((i) => i.code), ...plannedByCode.keys()], prefix);
    const [code] = last ? nextCodes(last, 1) : firstCodes(prefix, 1);
    lastAssigned = code!;
    return code!;
  };

  const ensureModel = (
    make: string,
    model: string,
    type: InstrumentType,
    name: string,
    rangeText: string,
  ) => {
    if (!make || !model) return null;
    const key = modelKey(make, model);
    if (!models.has(key) && !plan.models.some((m) => m.key === key)) {
      plan.models.push({
        key,
        type,
        make,
        model,
        equipmentName: name || INSTRUMENT_TYPE_INFO[type].label,
        rangeText,
        quantities: quantitiesFrom(rangeText, type),
      });
    }
    return key;
  };

  /** The QA Tech ID this occurrence imports under, or null when it can't be imported. */
  const resolveInstrument = (o: {
    code: string;
    serialNo: string;
    make: string;
    model: string;
    name: string;
    rangeText: string;
    where: string;
  }): string | null => {
    const type = instrumentTypeFromText(o.name) ?? options.defaultType;
    if (!o.code) {
      const known = bySerial.get(o.serialNo) ?? [];
      if (known.length === 1) {
        if (!counted.has(known[0]!.id)) plan.alreadyRegistered += 1;
        counted.add(known[0]!.id);
        return known[0]!.code;
      }
      if (known.length > 1) {
        plan.skipped.push({
          row: o.where,
          reason: `Serial ${o.serialNo} is registered more than once; add the ID to the file.`,
        });
        return null;
      }
      const planned = plannedBySerial.get(o.serialNo);
      if (planned) return planned.code;
      if (!options.assign) {
        if (!plan.unassigned.some((u) => u.serialNo === o.serialNo)) {
          plan.unassigned.push({
            serialNo: o.serialNo,
            make: o.make,
            model: o.model,
            row: o.where,
          });
        }
        return null;
      }
      const make = o.make || assignModel?.make || "";
      const model = o.model || assignModel?.model || "";
      const instrument: PlannedInstrument = {
        code: nextAssignedCode(),
        serialNo: o.serialNo,
        make,
        model,
        type,
        equipmentName: o.name,
        rangeText: o.rangeText,
        modelKey: ensureModel(make, model, type, o.name, o.rangeText),
        row: o.where,
        generated: true,
      };
      plannedByCode.set(instrument.code.toLowerCase(), instrument);
      plannedBySerial.set(o.serialNo, instrument);
      plan.instruments.push(instrument);
      return instrument.code;
    }

    if (!INSTRUMENT_CODE.test(o.code)) {
      plan.skipped.push({
        row: o.where,
        reason: `“${o.code}” isn't a QA Tech ID (letters, numbers, spaces and - _ . / ( ), starting with a letter or number).`,
      });
      return null;
    }
    const existing = byCode.get(o.code.toLowerCase());
    const sameSerial = o.serialNo
      ? (bySerial.get(o.serialNo) ?? []).find(
          (i) => !o.make || !i.make || norm(i.make) === norm(o.make),
        )
      : undefined;
    if (sameSerial && (!existing || existing.id !== sameSerial.id)) {
      // The serial is the physical logger: keep its history under the ID already registered.
      plan.problems.push(
        `${o.where}: serial ${o.serialNo} is registered as ${sameSerial.code}; this file calls it ${o.code}. Its records go to ${sameSerial.code}; the registered ID is kept.`,
      );
      if (!counted.has(sameSerial.id)) plan.alreadyRegistered += 1;
      counted.add(sameSerial.id);
      return sameSerial.code;
    }
    const planned = plannedByCode.get(o.code.toLowerCase());
    if (planned && o.serialNo && planned.serialNo && planned.serialNo !== o.serialNo) {
      plan.skipped.push({
        row: o.where,
        reason: `${o.code} appears twice with different serials (${planned.serialNo} at ${planned.row}, ${o.serialNo} here).`,
      });
      return null;
    }
    if (existing) {
      if (!counted.has(existing.id)) plan.alreadyRegistered += 1;
      counted.add(existing.id);
      return existing.code;
    }
    if (planned) return planned.code;
    const instrument: PlannedInstrument = {
      code: o.code,
      serialNo: o.serialNo,
      make: o.make,
      model: o.model,
      type,
      equipmentName: o.name,
      rangeText: o.rangeText,
      modelKey: ensureModel(o.make, o.model, type, o.name, o.rangeText),
      row: o.where,
      generated: false,
    };
    plannedByCode.set(o.code.toLowerCase(), instrument);
    if (o.serialNo) plannedBySerial.set(o.serialNo, instrument);
    plan.instruments.push(instrument);
    return instrument.code;
  };

  const siteFor = (number: string) => {
    const parsed = parseCertificateNumber(number);
    const site = parsed.site
      ? snapshot.sites.find(
          (s) =>
            s.name.toUpperCase().replace(/[^A-Z0-9]/g, "") ===
              parsed.site.toUpperCase().replace(/[^A-Z0-9]/g, "") ||
            norm(s.code) === norm(parsed.site),
        )
      : undefined;
    return { kind: parsed.kind, siteId: site?.id ?? null };
  };
  const existingCerts = new Map(
    snapshot.certificates
      .filter((c) => c.labName.toLowerCase() === snapshot.labName.toLowerCase())
      .map((c) => [c.number.toLowerCase(), c]),
  );

  // Lists.
  const certs = new Map<string, PlannedCertificate>();
  for (const row of read.rows) {
    const where = `${row.sheet} row ${row.row}`;
    const code = resolveInstrument({ ...row, where });
    if (!code || !row.calibratedOn) continue;
    const type = instrumentTypeFromText(row.name) ?? options.defaultType;
    const unnumbered = !row.certificateNo;
    const number =
      row.certificateNo ||
      `Number not recorded (${row.calibratedOn.split("-").reverse().join(".")})`;
    const key = number.toLowerCase();
    let cert = certs.get(key);
    if (!cert) {
      const { kind, siteId } = siteFor(row.certificateNo);
      cert = {
        number,
        unnumbered,
        certificateKind: kind || INSTRUMENT_TYPE_INFO[type].certificateKind,
        siteId,
        calibratedOn: row.calibratedOn,
        validUntil: row.validUntil,
        existingId: existingCerts.get(key)?.id ?? null,
        codes: [],
      };
      certs.set(key, cert);
      plan.certificates.push(cert);
    } else if (cert.calibratedOn !== row.calibratedOn && !unnumbered) {
      plan.problems.push(
        `${number}: ${where} has calibration date ${row.calibratedOn}, other rows ${cert.calibratedOn}. The first date is used.`,
      );
    }
    if (!cert.codes.some((c) => c.toLowerCase() === code.toLowerCase())) cert.codes.push(code);
  }

  // Certificate workbooks: one full certificate per number.
  const workbookNumbers = new Set<string>();
  for (const wc of mergeWorkbookCertificates(read.workbookCertificates, plan.problems)) {
    let key = wc.number.toLowerCase();
    let note: string | undefined;
    const earlier = existingCerts.get(key);
    if (earlier?.calibratedOn && wc.calibratedOn && earlier.calibratedOn !== wc.calibratedOn) {
      // The same number printed on a different calibration: keep both, so these
      // instruments don't lose their calibration, and say so.
      const dated = `${wc.number} (${wc.calibratedOn.split("-").reverse().join(".")})`;
      const first = wc.instruments[0]?.code || wc.instruments[0]?.serialNo || "";
      const last = wc.instruments.at(-1)?.code || wc.instruments.at(-1)?.serialNo || "";
      note = `QA Tech printed ${wc.number} on two calibrations: ${earlier.calibratedOn.split("-").reverse().join(".")} (already recorded) and ${wc.calibratedOn.split("-").reverse().join(".")} (this file). This one is recorded as ${dated}.`;
      plan.problems.push(
        `${wc.number} is already recorded for a calibration on ${earlier.calibratedOn.split("-").reverse().join(".")}; this file's is dated ${wc.calibratedOn.split("-").reverse().join(".")} (${first}${last && last !== first ? ` to ${last}` : ""}). It is imported as “${dated}” so these instruments keep their calibration. Check which number the lab meant.`,
      );
      wc.number = dated;
      key = dated.toLowerCase();
    }
    workbookNumbers.add(key);
    const recorded = existingCerts.get(key);
    if (recorded && recorded.kind !== "imported") {
      plan.alreadyRecorded.push(wc.number);
      // Still register any of its instruments that are new.
      for (const i of wc.instruments) {
        resolveInstrument({
          ...i,
          make: wc.make,
          model: wc.model,
          name: wc.equipmentName,
          rangeText: wc.rangeText,
          where: `${wc.number}`,
        });
      }
      continue;
    }
    const type = instrumentTypeFromText(wc.equipmentName) ?? options.defaultType;
    const codes: string[] = [];
    const columns: number[] = [];
    let alreadyOn = 0;
    wc.instruments.forEach((i, index) => {
      const code = resolveInstrument({
        code: i.code,
        serialNo: i.serialNo,
        make: wc.make,
        model: wc.model,
        name: wc.equipmentName,
        rangeText: wc.rangeText,
        where: `${wc.number} (${wc.sheets.join(", ")})`,
      });
      const onIt = recorded
        ? recorded.itemIds.includes(byCode.get(code?.toLowerCase() ?? "")?.id ?? "")
        : false;
      if (onIt) alreadyOn += 1;
      if (code && !codes.includes(code) && !onIt) {
        codes.push(code);
        columns.push(index);
      }
    });
    if (recorded && codes.length === 0) {
      plan.alreadyRecorded.push(wc.number);
      continue;
    }
    const { kind, siteId } = siteFor(wc.number);
    const masters = wc.masters.map((m) => {
      // Linked when that master's certificate is recorded (by number), else by serial.
      const cert = snapshot.certificates.find(
        (c) => c.number.toLowerCase() === m.certificateNo.toLowerCase(),
      );
      const named = (i: Snapshot["instruments"][number]) =>
        (i.serialNo.length >= 4 && m.serialNo.includes(i.serialNo)) ||
        // Sheets that name masters by QA Tech ID ("QATM/CAL/TL-02 B"): spacing ignored.
        (m.codes ?? []).some((c) => c.toLowerCase() === i.code.replace(/\s+/g, "").toLowerCase());
      // A lab certificate can cover a pair (sensor and indicator): prefer the one named.
      const onCert = snapshot.instruments.filter(
        (i) => cert?.itemIds.includes(i.id) && (i.tier ?? "master") === "master",
      );
      const master =
        onCert.find(named) ??
        onCert[0] ??
        snapshot.instruments.find((i) => i.tier === "master" && named(i));
      return {
        label: (m.serialNo
          ? `${m.name} (${m.make} ${m.model}, S/N ${m.serialNo})`
          : `${m.name} (${[m.make, ...(m.codes ?? [])].filter(Boolean).join(", ")})`
        ).replace(/\s+/g, " "),
        certificateNo: m.certificateNo,
        serialNo: m.serialNo,
        validUntil: m.validUntil,
        instrumentId: master?.id ?? null,
        certificateId: master && cert?.itemIds.includes(master.id) ? cert.id : null,
      };
    });
    plan.fullCertificates.push({
      ...wc,
      certificateKind: kind || INSTRUMENT_TYPE_INFO[type].certificateKind,
      siteId,
      modelKey: ensureModel(wc.make, wc.model, type, wc.equipmentName, wc.rangeText),
      codes,
      readings: wc.readings.map((row) => columns.map((c) => row[c] ?? "")),
      masters,
      missing: wc.instruments.length - codes.length - alreadyOn,
      ...(note ? { note } : {}),
      ...(recorded ? { existingId: recorded.id } : {}),
    });
  }

  // A list naming a certificate that a workbook in the same file brings in full: the full one wins.
  plan.certificates = plan.certificates.filter((c) => !workbookNumbers.has(c.number.toLowerCase()));
  // Certificates already recorded keep their items; only add what is new.
  for (const cert of plan.certificates) {
    if (!cert.existingId) continue;
    const have = new Set(existingCerts.get(cert.number.toLowerCase())?.itemIds ?? []);
    cert.codes = cert.codes.filter((code) => {
      const inst = byCode.get(code.toLowerCase());
      return !inst || !have.has(inst.id);
    });
  }
  plan.certificates = plan.certificates.filter((c) => !c.existingId || c.codes.length > 0);
  plan.fullCertificates = plan.fullCertificates.filter((c) => c.codes.length > 0);
  flagCopiedReadings(plan, snapshot.readingPrints ?? []);
  const listModel = options.listModelId
    ? snapshot.models.find((m) => m.id === options.listModelId)
    : undefined;
  if (listModel) {
    for (const i of plan.instruments) {
      if (i.make || i.model) continue;
      i.make = listModel.make;
      i.model = listModel.model;
      i.modelKey = modelKey(listModel.make, listModel.model);
    }
  }
  return plan;
}

/**
 * Warns when most of a certificate's instruments read exactly what another
 * certificate's instruments read, point for point: a sheet copied and
 * relabelled rather than measured. Data integrity (ALCOA+) asks for this to
 * be checked before it is recorded.
 */
function flagCopiedReadings(plan: ImportPlan, recorded: { number: string; prints: string[] }[]) {
  const printsOf = (c: PlannedFullCertificate) =>
    c.codes
      .map((_, ii) => {
        const pairs = c.points.map((p, pi) => ({
          reference: p.reference,
          reading: c.readings[pi]?.[ii] ?? "",
        }));
        return pairs.every((x) => x.reading !== "") ? readingPrint(pairs) : "";
      })
      .filter(Boolean);
  const others = [
    ...recorded.map((r) => ({ number: r.number, prints: new Set(r.prints) })),
    ...plan.fullCertificates.map((c) => ({ number: c.number, prints: new Set(printsOf(c)) })),
  ];
  for (const c of plan.fullCertificates) {
    const mine = printsOf(c);
    if (mine.length < 5) continue;
    for (const o of others) {
      if (o.number === c.number) continue;
      const same = mine.filter((p) => o.prints.has(p)).length;
      if (same >= 5 && same >= mine.length * 0.8) {
        plan.problems.push(
          `${c.number}: ${same} of its ${mine.length} instruments read exactly what ${o.number} reads, at every point. Check that these readings were measured, not copied from that sheet.`,
        );
        break;
      }
    }
  }
}

export function planSummary(plan: ImportPlan) {
  return {
    models: plan.models.length,
    instruments: plan.instruments.length,
    idsGiven: plan.instruments.filter((i) => i.generated).length,
    alreadyRegistered: plan.alreadyRegistered,
    certificates:
      plan.certificates.filter((c) => !c.existingId).length + plan.fullCertificates.length,
    certificatesWithReadings: plan.fullCertificates.length,
    readings: plan.fullCertificates.reduce(
      (n, c) => n + c.readings.flat().filter(Boolean).length,
      0,
    ),
    certificateLinks:
      plan.certificates.reduce((n, c) => n + c.codes.length, 0) +
      plan.fullCertificates.reduce((n, c) => n + c.codes.length, 0),
    unnumbered: plan.certificates.filter((c) => c.unnumbered).length,
    alreadyRecorded: plan.alreadyRecorded.length,
    unassigned: plan.unassigned.length,
    unlinkedMasters: plan.fullCertificates.reduce(
      (n, c) => n + c.masters.filter((m) => !m.certificateId).length,
      0,
    ),
    skipped: plan.skipped.length,
  };
}
