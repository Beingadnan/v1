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
