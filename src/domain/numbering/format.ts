/**
 * Turns a number format and a sequence value into a document number.
 *
 * Tokens:  {YYYY} 4-digit year · {YY} 2-digit year · {MM} month ·
 *          {SITE} site code (BHW) · {SITE_NAME} site name in capitals (BHIWANDI) ·
 *          {KIND} certificate series (PDL, RTD, TC…) ·
 *          {SEQ:n} sequence zero-padded to n digits (n = 1..8)
 *
 * Sequences restart every year, and every month when the format has {MM}.
 * With {SITE}/{SITE_NAME} each site counts separately; with {KIND} each kind does.
 *
 * Examples: "QT/J/{YYYY}/{SEQ:4}" → "QT/J/2026/0142"
 *           "QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}" → "QATECH/BHIWANDI/03/26/PDL-17"
 */
const TOKEN = /\{(YYYY|YY|MM|SITE_NAME|SITE|KIND|SEQ:(\d))\}/g;
const ALLOWED_LITERAL = /^[A-Za-z0-9/_\-. ]*$/;

export const DEFAULT_JOB_NUMBER_FORMAT = "QT/J/{YYYY}/{SEQ:4}";
/** As on QA Tech's certificates, e.g. QATECH/BHIWANDI/03/26/PDL-17. */
export const DEFAULT_CERTIFICATE_NUMBER_FORMAT = "QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}";

export type FormatCheck = { ok: true } | { ok: false; message: string };

export function checkNumberFormat(
  format: string,
  { needsSite, needsKind = false }: { needsSite: boolean; needsKind?: boolean },
): FormatCheck {
  if (format.length === 0 || format.length > 60) {
    return { ok: false, message: "Use between 1 and 60 characters." };
  }
  const seqTokens = format.match(/\{SEQ:(\d)\}/g) ?? [];
  if (seqTokens.length !== 1) {
    return { ok: false, message: "Include {SEQ:4} exactly once (the running number)." };
  }
  const digits = Number(seqTokens[0]?.slice(5, 6));
  if (digits < 1 || digits > 8) return { ok: false, message: "{SEQ:n} needs n between 1 and 8." };
  if (!format.includes("{YYYY}") && !format.includes("{YY}")) {
    return { ok: false, message: "Include {YYYY} or {YY}: numbers restart every year." };
  }
  if (needsSite && !format.includes("{SITE}") && !format.includes("{SITE_NAME}")) {
    return {
      ok: false,
      message: "Include {SITE} or {SITE_NAME}: each site has its own sequence.",
    };
  }
  if (needsKind && !format.includes("{KIND}")) {
    return {
      ok: false,
      message: "Include {KIND} (PDL, RTD, TC…): each kind of certificate has its own sequence.",
    };
  }
  const literal = format.replace(TOKEN, "");
  if (!ALLOWED_LITERAL.test(literal) || literal.includes("{") || literal.includes("}")) {
    return {
      ok: false,
      message:
        "Use letters, numbers, / - _ . and the tokens {YYYY} {YY} {MM} {SITE} {SITE_NAME} {KIND} {SEQ:n} only.",
    };
  }
  return { ok: true };
}

export type NumberValues = {
  year: number;
  sequence: number;
  /** 1–12; required when the format has {MM}. */
  month?: number;
  siteCode?: string;
  siteName?: string;
  kind?: string;
};

export function formatNumber(format: string, values: NumberValues): string {
  return format.replace(TOKEN, (token, name: string, digits?: string) => {
    if (name === "YYYY") return String(values.year);
    if (name === "YY") return String(values.year % 100).padStart(2, "0");
    if (name === "MM") {
      if (!values.month) throw new Error("This number format needs a month");
      return String(values.month).padStart(2, "0");
    }
    if (name === "SITE") {
      if (!values.siteCode) throw new Error("This number format needs a site code");
      return values.siteCode;
    }
    if (name === "SITE_NAME") {
      if (!values.siteName) throw new Error("This number format needs a site name");
      return values.siteName.toUpperCase().replace(/[^A-Z0-9]+/g, "");
    }
    if (name === "KIND") {
      if (!values.kind) throw new Error("This number format needs a certificate kind");
      return values.kind;
    }
    const width = Number(digits);
    const seq = String(values.sequence);
    if (seq.length > width) {
      throw new Error(`Sequence ${values.sequence} no longer fits ${token}; widen the format`);
    }
    return seq.padStart(width, "0");
  });
}

/** Which counter a number comes from: one per period (month or year) and kind. */
export function seriesScope(format: string, values: { month: number; kind?: string }) {
  return {
    period: format.includes("{MM}") ? values.month : 0,
    series: format.includes("{KIND}") ? (values.kind ?? "") : "",
  };
}

export type ParsedNumber = {
  year: number;
  month?: number;
  site?: string;
  kind?: string;
  sequence: number;
};

/**
 * Reads a number back with its format: "QATECH/BHIWANDI/09/26/PDL-01" →
 * { year: 2026, month: 9, site: "BHIWANDI", kind: "PDL", sequence: 1 }.
 * Used so that numbers issued before QTech (imported) are never handed out again.
 * The sequence may have more digits than the format pads to (TC-001).
 */
export function parseNumber(format: string, number: string): ParsedNumber | null {
  const names: string[] = [];
  let pattern = "^";
  let last = 0;
  for (const m of format.matchAll(TOKEN)) {
    pattern += format.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    last = m.index + m[0].length;
    const name = m[1]!.startsWith("SEQ") ? "SEQ" : m[1]!;
    names.push(name);
    pattern +=
      name === "YYYY"
        ? "(\\d{4})"
        : name === "YY" || name === "MM"
          ? "(\\d{2})"
          : name === "SEQ"
            ? "(\\d+)"
            : name === "KIND"
              ? "([A-Za-z]+)"
              : "([A-Za-z0-9]+)";
  }
  pattern += `${format.slice(last).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const match = new RegExp(pattern, "i").exec(number.trim());
  if (!match) return null;
  const out: ParsedNumber = { year: 0, sequence: 0 };
  names.forEach((name, i) => {
    const v = match[i + 1]!;
    if (name === "YYYY") out.year = Number(v);
    else if (name === "YY") out.year = 2000 + Number(v);
    else if (name === "MM") out.month = Number(v);
    else if (name === "SEQ") out.sequence = Number(v);
    else if (name === "KIND") out.kind = v.toUpperCase();
    else out.site = v.toUpperCase();
  });
  if (
    !out.year ||
    !out.sequence ||
    (out.month !== undefined && (out.month < 1 || out.month > 12))
  ) {
    return null;
  }
  return out;
}
