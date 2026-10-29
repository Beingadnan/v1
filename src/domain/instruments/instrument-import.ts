/**
 * Reading QA Tech's existing instrument lists ("All site portable datalogger
 * list", site logger lists) and planning what an import would add. Pure: no
 * database, so it is unit-tested against the real layouts.
 *
 * The lists differ from sheet to sheet, so columns are found by their header
 * names wherever they are. A certificate number written only on a batch's
 * first row is carried down to the rows below with the same calibration date.
 */
import ExcelJS from "exceljs";

import { cellText, dateText } from "@/domain/clients/import/workbook";

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
  { key: "code", match: /^(id|i\.d\.?) ?(no|number)|^instrument id|^id$/ },
  { key: "serialNo", match: /^serial|^s\/?n\b|^sr\.? ?no\.? of instrument/ },
  { key: "certificateNo", match: /^cert(ificate)? ?(no|number)/ },
  { key: "rangeText", match: /^range/ },
  { key: "calibratedOn", match: /^cal(ibration|\.)? ?date|^date of cal/ },
  { key: "validUntil", match: /^(cal(ibration|\.)? )?due ?date|^due/ },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function isoOrNull(text: string): string | null {
  const t = dateText(text.trim());
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? t : null;
}

export type ReadResult = { rows: ListRow[]; problems: string[] };

export async function readInstrumentList(bytes: Uint8Array): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return {
      rows: [],
      problems: ["This is not an Excel workbook (.xlsx). Save it as .xlsx and try again."],
    };
  }
  const rows: ListRow[] = [];
  const problems: string[] = [];
  for (const sheet of workbook.worksheets) {
    // Header: the first of the top ten rows that names an ID or serial column.
    let header = 0;
    const at: Partial<Record<keyof ListRow, number>> = {};
    for (let r = 1; r <= Math.min(10, sheet.rowCount) && !header; r++) {
      const values = sheet.getRow(r).values as ExcelJS.CellValue[];
      const found: Partial<Record<keyof ListRow, number>> = {};
      values.forEach((v, i) => {
        const text = norm(cellText(v ?? null));
        const col = COLUMNS.find((c) => c.match.test(text) && found[c.key] === undefined);
        if (col) found[col.key] = i;
      });
      if (found.code !== undefined || found.serialNo !== undefined) {
        header = r;
        Object.assign(at, found);
      }
    }
    if (!header) {
      if (sheet.rowCount > 0)
        problems.push(`Sheet “${sheet.name}”: no “ID No.” or “Serial No.” column found; skipped.`);
      continue;
    }
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
      if (row.certificateNo) {
        lastCert = row.certificateNo;
        lastDate = row.calibratedOn;
      } else if (lastCert && row.calibratedOn && row.calibratedOn === lastDate) {
        row.certificateNo = lastCert;
        row.carried = true;
      }
      rows.push(row);
    }
  }
  return { rows, problems };
}

export type Snapshot = {
  models: { id: string; make: string; model: string }[];
  instruments: { id: string; code: string; serialNo: string; make: string }[];
  certificates: { id: string; number: string; labName: string; itemIds: string[] }[];
  sites: { id: string; code: string; name: string }[];
  labName: string;
};

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
export type ImportPlan = {
  models: PlannedModel[];
  instruments: PlannedInstrument[];
  certificates: PlannedCertificate[];
  alreadyRegistered: number;
  skipped: { row: string; reason: string }[];
  problems: string[];
};

const modelKey = (make: string, model: string) => `${norm(make)}|${norm(model)}`;

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

/** `defaultType`: used when a row doesn't name the instrument (some lists only have serials and IDs). */
export function planInstrumentImport(
  read: ReadResult,
  snapshot: Snapshot,
  options: { defaultType: InstrumentType } = { defaultType: "portable_logger" },
): ImportPlan {
  const plan: ImportPlan = {
    models: [],
    instruments: [],
    certificates: [],
    alreadyRegistered: 0,
    skipped: [],
    problems: [...read.problems],
  };
  const models = new Map(snapshot.models.map((m) => [modelKey(m.make, m.model), m.id]));
  const byCode = new Map(snapshot.instruments.map((i) => [i.code.toLowerCase(), i]));
  const bySerial = new Map(
    snapshot.instruments.filter((i) => i.serialNo).map((i) => [`${norm(i.make)}|${i.serialNo}`, i]),
  );
  const newCodes = new Map<string, PlannedInstrument>();
  const certs = new Map<string, PlannedCertificate>();
  const existingCerts = new Map(
    snapshot.certificates
      .filter((c) => c.labName.toLowerCase() === snapshot.labName.toLowerCase())
      .map((c) => [c.number.toLowerCase(), c]),
  );

  for (const row of read.rows) {
    const where = `${row.sheet} row ${row.row}`;
    if (!row.code) {
      plan.skipped.push({
        row: where,
        reason: `Serial ${row.serialNo} has no ID No.; add QA Tech's ID and import again.`,
      });
      continue;
    }
    const type = instrumentTypeFromText(row.name) ?? options.defaultType;
    const existing = byCode.get(row.code.toLowerCase());
    const sameSerial = row.serialNo ? bySerial.get(`${norm(row.make)}|${row.serialNo}`) : undefined;
    if (sameSerial && (!existing || existing.id !== sameSerial.id)) {
      plan.skipped.push({
        row: where,
        reason: `Serial ${row.serialNo} is already registered as ${sameSerial.code}, not ${row.code}.`,
      });
      continue;
    }
    const planned = newCodes.get(row.code.toLowerCase());
    if (planned && planned.serialNo !== row.serialNo) {
      plan.skipped.push({
        row: where,
        reason: `${row.code} appears twice with different serials (${planned.serialNo} at ${planned.row}, ${row.serialNo} here).`,
      });
      continue;
    }
    if (existing) plan.alreadyRegistered += 1;
    else if (!planned) {
      let key: string | null = null;
      if (row.make && row.model) {
        key = modelKey(row.make, row.model);
        if (!models.has(key) && !plan.models.some((m) => m.key === key)) {
          plan.models.push({
            key,
            type,
            make: row.make,
            model: row.model,
            equipmentName: row.name || INSTRUMENT_TYPE_INFO[type].label,
            rangeText: row.rangeText,
            quantities: quantitiesFrom(row.rangeText, type),
          });
        }
      }
      const instrument: PlannedInstrument = {
        code: row.code,
        serialNo: row.serialNo,
        make: row.make,
        model: row.model,
        type,
        equipmentName: row.name,
        rangeText: row.rangeText,
        modelKey: key,
        row: where,
      };
      newCodes.set(row.code.toLowerCase(), instrument);
      plan.instruments.push(instrument);
    }

    if (!row.calibratedOn) continue;
    const unnumbered = !row.certificateNo;
    const number =
      row.certificateNo ||
      `Number not recorded (${row.calibratedOn.split("-").reverse().join(".")})`;
    const key = number.toLowerCase();
    let cert = certs.get(key);
    if (!cert) {
      const parsed = parseCertificateNumber(row.certificateNo);
      const site = parsed.site
        ? snapshot.sites.find(
            (s) => norm(s.name) === norm(parsed.site) || norm(s.code) === norm(parsed.site),
          )
        : undefined;
      cert = {
        number,
        unnumbered,
        certificateKind: parsed.kind || INSTRUMENT_TYPE_INFO[type].certificateKind,
        siteId: site?.id ?? null,
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
    if (!cert.codes.some((c) => c.toLowerCase() === row.code.toLowerCase()))
      cert.codes.push(row.code);
  }
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
  return plan;
}

export function planSummary(plan: ImportPlan) {
  return {
    models: plan.models.length,
    instruments: plan.instruments.length,
    alreadyRegistered: plan.alreadyRegistered,
    certificates: plan.certificates.filter((c) => !c.existingId).length,
    certificateLinks: plan.certificates.reduce((n, c) => n + c.codes.length, 0),
    unnumbered: plan.certificates.filter((c) => c.unnumbered).length,
    skipped: plan.skipped.length,
  };
}
