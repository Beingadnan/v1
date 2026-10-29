/**
 * Calibration arithmetic, exact to the digits people typed.
 *
 * Readings are decimals entered by hand (−25.084, 21.1). Binary floating point
 * turns 21.1 − 20.44 into 0.6600000000000001 (as QA Tech's Excel sheets show);
 * here values are scaled to integers first, so the deviation is exactly 0.66
 * and is printed with as many decimals as its inputs had.
 */
import type { Quantity } from "./types";

const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

/** Normalises "−25,084" / " -25.084 " / "+.5" to a plain decimal string, or null. */
export function cleanDecimal(input: unknown): string | null {
  if (typeof input === "number") return Number.isFinite(input) ? String(input) : null;
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (/^[+-]?\.\d+$/.test(s)) s = s.replace(".", "0.");
  return DECIMAL.test(s) ? s.replace(/^\+/, "") : null;
}

export function decimalPlaces(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : value.length - dot - 1;
}

function toScaled(value: string, places: number): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const digits = whole + fraction.padEnd(places, "0");
  const n = BigInt(digits);
  return negative ? -n : n;
}

function fromScaled(n: bigint, places: number): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(places + 1, "0");
  const whole = places === 0 ? digits : digits.slice(0, -places);
  const fraction = places === 0 ? "" : `.${digits.slice(-places)}`;
  const text = `${whole}${fraction}`;
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/**
 * reading − reference, exactly, with max(decimals) places:
 * deviation("-25", "-25.084") = "0.084"; deviation("21.1", "20.44") = "0.66".
 */
export function deviation(reading: string, reference: string): string {
  const places = Math.max(decimalPlaces(reading), decimalPlaces(reference));
  return fromScaled(toScaled(reading, places) - toScaled(reference, places), places);
}

/** Accuracy of a model: a tolerance per quantity, narrower in some bands. */
export type AccuracySpec = Partial<
  Record<Quantity, { tolerance: number; bands?: { from: number; to: number; tolerance: number }[] }>
>;

/**
 * The ± tolerance that applies at a reference value: the first band that
 * contains the value, otherwise the quantity's general tolerance.
 * EBI 20-TH1: ±0.5 °C from −20 to 40 °C, ±0.8 °C elsewhere → −25 °C → 0.8.
 */
export function toleranceAt(spec: AccuracySpec, quantity: Quantity, value: number): number | null {
  const q = spec[quantity];
  if (!q) return null;
  const band = q.bands?.find((b) => value >= b.from && value <= b.to);
  return band ? band.tolerance : q.tolerance;
}

export type Judgement = "pass" | "fail" | "no_limit";

/**
 * Simple acceptance (ILAC G8 / ISO/IEC 17025 7.8.6): within ± tolerance passes.
 * Compared exactly as decimals, so 0.50 against ±0.5 passes.
 */
export function judge(deviationValue: string, tolerance: number | null): Judgement {
  if (tolerance === null) return "no_limit";
  const tol = cleanDecimal(String(tolerance)) ?? "0";
  const places = Math.max(decimalPlaces(deviationValue), decimalPlaces(tol));
  const dev = toScaled(deviationValue.replace("-", ""), places);
  return dev <= toScaled(tol, places) ? "pass" : "fail";
}

export const DECISION_RULE_TEXT =
  "Decision rule: simple acceptance — a reading passes when its deviation from the reference is within the stated accuracy. Measurement uncertainty is not included in the pass/fail decision.";
