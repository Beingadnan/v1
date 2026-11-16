import { machine } from "@/lib/state-machine";

/** Reports: the vocabulary shared by the database checks, the services and the screens. */

/**
 * A revision's life (phases 8–9):
 *
 * - draft: being written;
 * - checking: frozen and signed Done By, with QA Tech's checker;
 * - checked: signed Checked By;
 * - released: sent to the client;
 * - reviewed: the client's QA signed Reviewed By;
 * - signed: approved by the client, in the app or on paper (the issued report);
 * - returned: the client sent it back, and the next revision answers it;
 * - superseded: a later revision replaced it.
 *
 * A checker's return sends a checking revision back to draft, without a new number.
 */
export const REPORT_STATUSES = [
  "draft",
  "checking",
  "checked",
  "released",
  "reviewed",
  "signed",
  "returned",
  "superseded",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * A report revision's moves (ADR 0022). Draft is frozen for checking; the
 * checker returns it to draft or checks it; checked is released to the client
 * or signed on paper; the client signs or returns it; a new frozen revision
 * supersedes the one before. "Reviewed" is from the four-signature flow (Fix
 * 5.1 dropped it): nothing leads to it now, but older revisions may be in it.
 */
export const REPORT_FLOW = machine<ReportStatus>("report", REPORT_STATUSES, {
  draft: ["checking"],
  checking: ["draft", "checked", "superseded"],
  checked: ["released", "signed", "superseded"],
  released: ["signed", "returned", "superseded"],
  reviewed: ["signed", "returned", "superseded"],
  signed: ["superseded"],
  returned: ["superseded"],
  superseded: [],
});
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "Draft",
  checking: "With the checker",
  checked: "Checked",
  released: "With the client",
  reviewed: "Reviewed by the client",
  signed: "Signed",
  returned: "Returned by the client",
  superseded: "Superseded",
};

/** Statuses that have a frozen PDF. */
export const FROZEN_STATUSES: readonly ReportStatus[] = REPORT_STATUSES.filter(
  (s) => s !== "draft",
);

/** How far a revision has gone, for the job's status (the least advanced study wins). */
export const REPORT_RANK: Record<ReportStatus, number> = {
  draft: 1,
  checking: 1,
  returned: 1,
  checked: 2,
  released: 3,
  reviewed: 3,
  signed: 4,
  superseded: 0,
};

export const SIGNED_VIA = ["app", "paper"] as const;
export type SignedVia = (typeof SIGNED_VIA)[number];

/** Where in the report a comment is pinned. Pages come from the frozen PDF. */
export const REPORT_SECTIONS = [
  "general",
  "cover",
  "details",
  "diagram",
  "graphs",
  "conclusion",
  "raw",
  "postcal",
  "deviations",
  "certificates",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
  general: "The whole report",
  cover: "Cover and index",
  details: "Equipment & mapping details",
  diagram: "Sensor diagram",
  graphs: "Graphs and summary",
  conclusion: "Observation, conclusion and signatures",
  raw: "Raw data",
  postcal: "Post-calibration",
  deviations: "Deviations",
  certificates: "Calibration certificates",
};

export const COMMENT_SIDES = ["qa_tech", "client"] as const;
export type CommentSide = (typeof COMMENT_SIDES)[number];

/** A box of the signature block on the frozen PDF, in PDF points from the bottom left. */
export type SignBox = { page: number; x: number; y: number; w: number; h: number };
export type ReportLayout = {
  /** First page (1-based) of each section in the frozen PDF. */
  sections: Partial<Record<ReportSection, number>>;
  /**
   * Where each signature is stamped: QA Tech's and the client's columns (two
   * signatures since Nov 2026; older reports have all four meanings). `role`
   * and `footer` boxes are on the two-column layout only: the signer's role,
   * and a small "verified / reviewed" line at the foot of each raw data page.
   */
  signBoxes: Partial<
    Record<
      "done_by" | "checked_by" | "reviewed_by" | "approved_by",
      { signature: SignBox; name: SignBox; role?: SignBox; footer?: SignBox[] }
    >
  > | null;
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
  return [...new Set([...mapped].filter((c) => !/[\x09\x0a\x0d\x20-\x7e -ÿ]/.test(c)))];
}
