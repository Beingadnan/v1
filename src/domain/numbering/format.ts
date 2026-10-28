/**
 * Turns a number format and a sequence value into a document number.
 *
 * Tokens:  {YYYY} 4-digit year · {YY} 2-digit year · {SITE} site code ·
 *          {SEQ:n} sequence zero-padded to n digits (n = 1..8)
 * Example: "QT/J/{YYYY}/{SEQ:4}" + 2026, 142 → "QT/J/2026/0142"
 */
const TOKEN = /\{(YYYY|YY|SITE|SEQ:(\d))\}/g;
const ALLOWED_LITERAL = /^[A-Za-z0-9/_\-. ]*$/;

export type FormatCheck = { ok: true } | { ok: false; message: string };

export function checkNumberFormat(
  format: string,
  { needsSite }: { needsSite: boolean },
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
  if (needsSite && !format.includes("{SITE}")) {
    return { ok: false, message: "Include {SITE}: each site has its own sequence." };
  }
  const literal = format.replace(TOKEN, "");
  if (!ALLOWED_LITERAL.test(literal) || literal.includes("{") || literal.includes("}")) {
    return {
      ok: false,
      message: "Use letters, numbers, / - _ . and the tokens {YYYY} {YY} {SITE} {SEQ:n} only.",
    };
  }
  return { ok: true };
}

export function formatNumber(
  format: string,
  values: { year: number; sequence: number; siteCode?: string },
): string {
  return format.replace(TOKEN, (token, name: string, digits?: string) => {
    if (name === "YYYY") return String(values.year);
    if (name === "YY") return String(values.year % 100).padStart(2, "0");
    if (name === "SITE") {
      if (!values.siteCode) throw new Error("This number format needs a site code");
      return values.siteCode;
    }
    const width = Number(digits);
    const seq = String(values.sequence);
    if (seq.length > width) {
      throw new Error(`Sequence ${values.sequence} no longer fits ${token}; widen the format`);
    }
    return seq.padStart(width, "0");
  });
}
