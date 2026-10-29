/** Formatting shared by screens, PDFs and Excel exports (no server-only imports). */
import { decimalPlaces } from "./calibration-math";

/** dd.mm.yyyy, as on QA Tech's paper certificates. */
export const dmy = (iso: string | null | undefined) =>
  iso ? iso.split("-").reverse().join(".") : "NA";

/** Pads a decimal string to `places` decimals ("1.1", 2 → "1.10"); never removes digits. */
export function toPlaces(value: string, places: number): string {
  const have = decimalPlaces(value);
  if (have >= places) return value;
  return `${value}${have === 0 ? "." : ""}${"0".repeat(places - have)}`;
}
