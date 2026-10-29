/**
 * Client report numbers. Each client has its own pattern; Watson's is
 * "Watson/Seawoods/05/26/Cold Storage (Walk In Freezer)/BE-WF-02".
 *
 * Tokens: {CLIENT} company code · {SITE} site code · {DEPT} department ·
 *         {MM} month · {YY} 2-digit year · {YYYY} year ·
 *         {EQUIPMENT} equipment name · {EQUIPMENT_ID} equipment ID
 *
 * The number is reserved when a job is created (phase 4) and stored as text,
 * so later changes to a pattern, a name or a code never change an issued number.
 */
export const REPORT_TOKENS = [
  "CLIENT",
  "SITE",
  "DEPT",
  "MM",
  "YY",
  "YYYY",
  "EQUIPMENT",
  "EQUIPMENT_ID",
] as const;
type ReportToken = (typeof REPORT_TOKENS)[number];

export const DEFAULT_REPORT_NUMBER_FORMAT = "{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}";

const TOKEN = /\{([A-Z_]+)\}/g;

export type ReportNumberValues = {
  clientCode: string;
  siteCode: string;
  department: string;
  equipmentName: string;
  equipmentCode: string;
  /** Month of the study (1–12) and its year. */
  month: number;
  year: number;
};

export function checkReportNumberFormat(
  format: string,
): { ok: true } | { ok: false; message: string } {
  if (format.trim().length === 0 || format.length > 120) {
    return { ok: false, message: "Use between 1 and 120 characters." };
  }
  for (const match of format.matchAll(TOKEN)) {
    if (!(REPORT_TOKENS as readonly string[]).includes(match[1]!)) {
      return {
        ok: false,
        message: `{${match[1]}} is not a known part. Use ${REPORT_TOKENS.map((t) => `{${t}}`).join(" ")}.`,
      };
    }
  }
  if (format.replace(TOKEN, "").match(/[{}]/)) {
    return { ok: false, message: "Every { needs a matching }." };
  }
  if (!format.includes("{EQUIPMENT_ID}")) {
    return {
      ok: false,
      message: "Include {EQUIPMENT_ID} so each report number is unique to its equipment.",
    };
  }
  return { ok: true };
}

export function formatReportNumber(format: string, values: ReportNumberValues): string {
  const parts: Record<ReportToken, string> = {
    CLIENT: values.clientCode,
    SITE: values.siteCode,
    DEPT: values.department,
    MM: String(values.month).padStart(2, "0"),
    YY: String(values.year % 100).padStart(2, "0"),
    YYYY: String(values.year),
    EQUIPMENT: values.equipmentName,
    EQUIPMENT_ID: values.equipmentCode,
  };
  return format.replace(TOKEN, (whole, name: string) =>
    name in parts ? parts[name as ReportToken] : whole,
  );
}
