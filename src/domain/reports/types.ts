/** Reports: the vocabulary shared by the database checks, the services and the screens. */

export const REPORT_STATUSES = ["draft", "frozen", "superseded"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "Draft",
  frozen: "Frozen",
  superseded: "Superseded",
};

/** "Rev 00", "Rev 01"… as on QA Tech's documents. */
export const revLabel = (rev: number) => `Rev ${String(rev).padStart(2, "0")}`;

export const FT09_FORM = "QATM/PVAL/FT-09";

/**
 * Characters the report's PDF font can't print (it covers Western European
 * text; − – — “ ” ‘ ’ … are mapped). Returned so the person can be told.
 */
export function unprintable(text: string): string[] {
  const mapped = text.replace(/[−–—“”‘’…]/g, "");
  return [...new Set([...mapped].filter((c) => !/[\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/.test(c)))];
}
