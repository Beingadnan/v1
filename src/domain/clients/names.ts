/**
 * Compares company names ignoring case, punctuation and legal suffixes, so
 * "Watson Pharma Pvt. Ltd." and "WATSON PHARMA PRIVATE LIMITED" match.
 */
export function companyNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(m s|ms|the|pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|india)\b/g,
      " ",
    )
    .replace(/\s+/g, "");
}
