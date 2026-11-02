/** Billing (phase 10): the vocabulary shared by the database checks, the services and the screens. */

export const WCR_STATUSES = ["issued", "signed", "void"] as const;
export type WcrStatus = (typeof WCR_STATUSES)[number];

export const INVOICE_STATUSES = ["open", "cleared", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_MODES = ["neft", "rtgs", "imps", "upi", "cheque", "cash", "other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  neft: "NEFT",
  rtgs: "RTGS",
  imps: "IMPS",
  upi: "UPI",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

/** GST on testing and calibration services; a suggestion, the Tally invoice decides. */
export const DEFAULT_GST_PCT = 18;
/** TDS on fees for technical services (s.194J); a suggestion, the client deducts. */
export const DEFAULT_TDS_PCT = 2;
/** Default payment terms; the MSMED Act's longest term for micro and small suppliers. */
export const DEFAULT_PAYMENT_DAYS = 45;
/** CGST Rule 47: a services invoice within 30 days of the supply. */
export const INVOICE_WITHIN_DAYS = 30;

/** Rule 46: up to 16 characters, letters, digits, "-" and "/". */
export const INVOICE_NUMBER = /^[A-Za-z0-9/-]{1,16}$/;

/** The Indian financial year (April to March) of an ISO date, e.g. "2026-27". */
export function financialYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Rupees to paise and back, so sums never drift. */
export const paise = (rupees: number | string) => Math.round(Number(rupees) * 100);
export const rupees = (p: number) => p / 100;

/** The next number after the last one: the trailing digits go up by one, keeping their width. */
export function nextInvoiceNumber(last: string | null): string {
  if (!last) return "";
  const m = last.match(/^(.*?)(\d+)$/);
  if (!m) return "";
  const n = String(Number(m[2]) + 1).padStart(m[2]!.length, "0");
  const next = `${m[1]}${n}`;
  return next.length <= 16 ? next : "";
}

/** Whole days from one ISO date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** What is left on an invoice, in paise, after payments, TDS and any write-off. */
export function balanceOf(
  totalPaise: number,
  payments: { receivedPaise: number; tdsPaise: number; writtenOffPaise: number }[],
): number {
  return payments.reduce(
    (b, p) => b - p.receivedPaise - p.tdsPaise - p.writtenOffPaise,
    totalPaise,
  );
}
