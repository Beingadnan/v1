/**
 * Reading scanned calibration certificates (ADR 0024): what the model is asked
 * for, how its answer is checked, what a file name tells on its own, and how a
 * read certificate is matched to the register.
 *
 * QA Tech's certificates arrive as scans: an outside lab's certificate for a
 * master ("TL-38 27.01.2027.pdf", Sansel, NABL), QA Tech's own FT-05 batch
 * certificate for loggers signed on paper, or a scanner's file name
 * ("20260916144933.pdf"). Each names its number, the lab, the calibration and
 * due dates and the instruments by ID or serial.
 */
import { z } from "zod";

export const CERTIFICATE_PROMPT = `You read scanned calibration certificates for QA Tech, an Indian
temperature-mapping company. The file can hold one certificate or several (one per page or
a few pages each). For every certificate, record:

- page: the page it starts on (1 for the first).
- number: the certificate number exactly as printed ("SAN/26/128/TH/1",
  "QATECH/BHIWANDI/05/26/TRHS-02", "QATM - 26031344"). Not the ULR number, not the SRF number.
- ulrNo: the NABL ULR number if printed ("CC287926000000394F"), else "".
- labName: the laboratory that issued it, short ("Sansel Calibration Laboratories LLP",
  "QA Tech", "Tempsens Calibration Centre"). QA Tech's own certificates (letterhead "QA tech",
  "GMP Technical Solutions") are "QA Tech".
- calibratedOn: the date of calibration as YYYY-MM-DD. When a range is printed
  ("28.01.2026 to 30.01.2026") use the first day. Indian dates are day.month.year.
- validUntil: the due date / recommended date of next calibration as YYYY-MM-DD, or "".
- instruments: every instrument calibrated on it, each with id (the owner's ID No., e.g.
  "QATM/CAL/TL-38", "TRHS-031", "RTD-02") and serial (the serial number). A batch certificate
  lists many in a table: give each. Use "" for what is not printed.
- notes: anything unclear, in a short sentence, or "".

Never guess: leave a field "" when it is not readable. Do not list the reference standards
(the "standards used" table) as instruments.`;

const text = (max: number) => ({ type: "string", maxLength: max });

/** The answer's JSON schema (strict: every field present). */
export const CERTIFICATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["certificates"],
  properties: {
    certificates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "page",
          "number",
          "ulrNo",
          "labName",
          "calibratedOn",
          "validUntil",
          "instruments",
          "notes",
        ],
        properties: {
          page: { type: "integer" },
          number: text(80),
          ulrNo: text(40),
          labName: text(120),
          calibratedOn: text(10),
          validUntil: text(10),
          instruments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "serial"],
              properties: { id: text(60), serial: text(60) },
            },
          },
          notes: text(300),
        },
      },
    },
  },
} as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD, or "". */
export function cleanIsoDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!ISO.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : "";
}

const cut = (max: number) =>
  z
    .unknown()
    .transform((v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : ""));

const readCertificateSchema = z.object({
  page: z
    .unknown()
    .transform((v) => (typeof v === "number" && v >= 1 ? Math.min(Math.floor(v), 999) : 1)),
  number: cut(80),
  ulrNo: cut(40).transform((v) => v.replace(/\s/g, "").toUpperCase()),
  labName: cut(120),
  calibratedOn: z.unknown().transform(cleanIsoDate),
  validUntil: z.unknown().transform(cleanIsoDate),
  instruments: z
    .unknown()
    .transform((v) => (Array.isArray(v) ? v.slice(0, 200) : []))
    .pipe(z.array(z.object({ id: cut(60), serial: cut(60) }).catch({ id: "", serial: "" })))
    .transform((list) => list.filter((i) => i.id || i.serial)),
  notes: cut(300),
});

export type ReadCertificate = z.output<typeof readCertificateSchema>;

/**
 * The model's answer, checked but forgiving: a bad date becomes "", a long
 * text is cut, a broken entry is dropped, so one unclear field never loses
 * the rest of the reading.
 */
export function parseCertificateReading(raw: unknown): ReadCertificate[] {
  const list =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { certificates?: unknown }).certificates)
      ? ((raw as { certificates: unknown[] }).certificates as unknown[])
      : [];
  return list
    .slice(0, 50)
    .map((c) => readCertificateSchema.safeParse(c))
    .filter((r) => r.success)
    .map((r) => r.data)
    .filter((c) => c.number || c.instruments.length > 0);
}

/**
 * What a file name says on its own: QA Tech names a master's scan by its IDs
 * and due date ("TL-02B, 02A 22.08.2026.pdf", "DL-17 (08.06.2027).pdf") and an
 * own certificate by its date and sequence ("01.04.2026 Qatech Calibration
 * Certificate RTD-02 (Johnson and Johnson).pdf"). A scanner's name
 * ("20260916144933.pdf") says nothing.
 */
export function fileNameHints(fileName: string): { codes: string[]; dates: string[] } {
  const base = baseName(fileName);
  const dates: string[] = [];
  for (const m of base.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) {
    const iso = cleanIsoDate(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
    if (iso) dates.push(iso);
  }
  const codes: string[] = [];
  // "TRHS-031 to TRHS-050": every ID in the range, zero-padded as written.
  for (const m of base.matchAll(/\b([A-Z]{1,6})-(\d{1,4})\s+to\s+(?:\1-)?(\d{1,4})\b/gi)) {
    const [from, to] = [Number(m[2]), Number(m[3])];
    if (to > from && to - from < 200) {
      for (let n = from; n <= to; n++) {
        codes.push(`${m[1]!.toUpperCase()}-${String(n).padStart(m[2]!.length, "0")}`);
      }
    }
  }
  // "TL-02B, 02A" and "DTS-27, 27A, 27B": later numbers share the first prefix.
  for (const m of base.matchAll(
    /\b([A-Z]{1,6})\s?-\s?(\d{1,6}[A-Z]?)((?:\s*,\s*\d{1,4}[A-Z]?\b)*)/gi,
  )) {
    const prefix = m[1]!.toUpperCase();
    if (/^(PDF|NO|SR)$/.test(prefix)) continue;
    codes.push(`${prefix}-${m[2]!.toUpperCase()}`);
    for (const more of (m[3] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)) {
      codes.push(`${prefix}-${more.toUpperCase()}`);
    }
  }
  const seen = new Set<string>();
  const unique = codes.filter((c) => {
    const key = normaliseCode(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { codes: unique, dates: [...new Set(dates)] };
}

/** The name without its extension and a copy's "_1". */
const baseName = (fileName: string) =>
  fileName.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_\d+$/, "");

/** Compares IDs and numbers as written: case, spaces and leading zeros after a dash ignored. */
export function normaliseCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-0+(\d)/g, "-$1");
}

/**
 * The register's instrument for an ID or serial read off a certificate: the
 * same ID, the same last part ("TL-38" for "QATM/CAL/TL-38", either way round),
 * or the same serial. Null when none or more than one fits.
 */
export function findInstrument<T extends { id: string; code: string; serialNo: string | null }>(
  register: T[],
  read: { id: string; serial: string },
): T | null {
  const one = (list: T[]) => (list.length === 1 ? list[0]! : null);
  const id = read.id ? normaliseCode(read.id) : "";
  if (id) {
    const exact = register.filter((i) => normaliseCode(i.code) === id);
    if (exact.length) return one(exact);
    const tail = (c: string) => c.split("/").at(-1)!;
    const byTail = register.filter((i) => {
      const code = normaliseCode(i.code);
      return code.endsWith(`/${id}`) || id.endsWith(`/${code}`) || tail(code) === tail(id);
    });
    if (byTail.length) return one(byTail);
  }
  const serial = read.serial.replace(/\s/g, "").toUpperCase();
  if (serial.length >= 3) {
    return one(
      register.filter((i) => (i.serialNo ?? "").replace(/\s/g, "").toUpperCase() === serial),
    );
  }
  return null;
}

/**
 * A certificate from the file name alone, when no reader is set up: its IDs
 * and its date. QA Tech names a master's scan "ID due-date" and its own
 * certificates "date … ID", so a date after the IDs is the due date and one
 * before them the calibration date. The number and lab are left for the person.
 */
export function fromFileName(fileName: string): ReadCertificate | null {
  const { codes, dates } = fileNameHints(fileName);
  if (codes.length === 0) return null;
  const base = baseName(fileName);
  const dateAt = base.search(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/);
  const codeAt = base.search(/\b[A-Z]{1,6}\s?-\s?\d/i);
  const due = dateAt > codeAt;
  return {
    page: 1,
    number: "",
    ulrNo: "",
    labName: "",
    calibratedOn: due ? "" : (dates[0] ?? ""),
    validUntil: due ? (dates[0] ?? "") : "",
    instruments: codes.map((id) => ({ id, serial: "" })),
    notes: "",
  };
}
