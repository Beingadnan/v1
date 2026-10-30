/**
 * Pre-calibration on site (FT-01): a logger read against a master at one
 * point. Exact decimal arithmetic, and the same simple-acceptance rule as the
 * lab's FT-05 certificates.
 */
import {
  cleanDecimal,
  deviation,
  judge,
  toleranceAt,
  type AccuracySpec,
} from "@/domain/instruments/calibration-math";

/** Without a stated accuracy on the logger or its model, QA Tech's usual ±0.5 °C / ±3 %RH. */
export const DEFAULT_TOLERANCE = { temperature: 0.5, humidity: 3 } as const;

export function evaluatePrecal(input: {
  reference: unknown;
  reading: unknown;
  quantity: "temperature" | "humidity";
  accuracy: AccuracySpec | null;
}):
  | {
      ok: true;
      reference: string;
      reading: string;
      deviation: string;
      tolerance: number;
      result: "pass" | "fail";
    }
  | { ok: false; message: string } {
  const reference = cleanDecimal(input.reference);
  const reading = cleanDecimal(input.reading);
  if (reference === null) return { ok: false, message: "Enter the master's reading." };
  if (reading === null) return { ok: false, message: "Enter the logger's reading." };
  const dev = deviation(reading, reference);
  const tolerance =
    (input.accuracy ? toleranceAt(input.accuracy, input.quantity, Number(reference)) : null) ??
    DEFAULT_TOLERANCE[input.quantity];
  // Far beyond any logger's accuracy: a slip of the finger, not a reading.
  if (Math.abs(Number(dev)) > Math.max(10, 10 * tolerance)) {
    return {
      ok: false,
      message: `The logger reads ${dev} away from the master. Check the numbers (a decimal point or a minus sign may be missing).`,
    };
  }
  const verdict = judge(dev, tolerance);
  return {
    ok: true,
    reference,
    reading,
    deviation: dev,
    tolerance,
    result: verdict === "fail" ? "fail" : "pass",
  };
}
