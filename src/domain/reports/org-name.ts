/**
 * "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)" already starts
 * with the short name "QA Tech": print it once, not "QA Tech (QA Tech (…))".
 */
export function withShortName(short: string, legal: string): string {
  const s = short.trim();
  const l = legal.trim();
  if (!s) return l;
  if (!l) return s;
  return l.toLowerCase().startsWith(s.toLowerCase()) ? l : `${s} (${l})`;
}

/**
 * The legal name's rest, in brackets, for under the short name on the cover;
 * nothing when the legal name is just the short name.
 */
export function underShortName(short: string, legal: string): string {
  const s = short.trim();
  const l = legal.trim();
  const rest = s && l.toLowerCase().startsWith(s.toLowerCase()) ? l.slice(s.length).trim() : l;
  if (!rest) return "";
  return /^\(.*\)$/.test(rest) ? rest : `(${rest})`;
}
