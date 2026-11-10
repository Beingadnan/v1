/**
 * What a job is worth. QA Tech prices from the client's PO (or contract), not
 * from a rate card: the rate card was removed after the November 2026 demo.
 * Jobs made before then may still carry a custom quote; it counts only when
 * there is no PO value.
 */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const formatInr = (n: number) => `₹${inr.format(n)}`;

export function jobValue(input: { quotedValue: number | null; poValue: number | null }): {
  expected: number | null;
  source: "po" | "quote" | "none";
} {
  if (input.poValue !== null) return { expected: input.poValue, source: "po" };
  if (input.quotedValue !== null) return { expected: input.quotedValue, source: "quote" };
  return { expected: null, source: "none" };
}
