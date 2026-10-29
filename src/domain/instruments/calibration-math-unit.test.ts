import { describe, expect, it } from "vitest";

import { cleanDecimal, deviation, judge, toleranceAt, type AccuracySpec } from "./calibration-math";

/** ebro EBI 20-TH1, as printed on QA Tech's FT-05. */
const ebi20th1: AccuracySpec = {
  temperature: { tolerance: 0.8, bands: [{ from: -20, to: 40, tolerance: 0.5 }] },
  humidity: { tolerance: 3 },
};

describe("PDL-17 (26.03.2026) deviations, exactly as on the paper certificate", () => {
  // Master and first logger (62363017 / E-TRH0524) readings from the FT-05 sheet.
  it.each([
    ["-25", "-25.084", "0.084"],
    ["-25.2", "-25.084", "-0.116"],
    ["15", "15.041", "-0.041"],
    ["15.2", "15.041", "0.159"],
    ["60.2", "60.023", "0.177"],
    ["59.9", "60.023", "-0.123"],
    ["21.1", "20.44", "0.66"],
    ["20.5", "20.44", "0.06"],
    ["50.6", "50.31", "0.29"],
    ["90.2", "90.27", "-0.07"],
  ])("%s − %s = %s", (reading, reference, expected) => {
    expect(deviation(reading, reference)).toBe(expected);
  });

  it("uses the narrower tolerance inside its band", () => {
    expect(toleranceAt(ebi20th1, "temperature", -25.084)).toBe(0.8);
    expect(toleranceAt(ebi20th1, "temperature", 15.041)).toBe(0.5);
    expect(toleranceAt(ebi20th1, "temperature", 60.023)).toBe(0.8);
    expect(toleranceAt(ebi20th1, "humidity", 90.27)).toBe(3);
    expect(toleranceAt(ebi20th1, "pressure", 1)).toBeNull();
  });

  it("passes on the limit and fails just outside it", () => {
    expect(judge("0.50", 0.5)).toBe("pass");
    expect(judge("-0.5", 0.5)).toBe("pass");
    expect(judge("0.501", 0.5)).toBe("fail");
    expect(judge("1.16", 3)).toBe("pass");
    expect(judge("1", null)).toBe("no_limit");
  });
});

describe("typed values", () => {
  it("accepts the usual ways people type decimals", () => {
    expect(cleanDecimal(" −25.084 ")).toBe("-25.084");
    expect(cleanDecimal("25,5")).toBe("25.5");
    // As pasted from QA Tech's sheets and logger software, with units.
    expect(cleanDecimal("-20.2 °C")).toBe("-20.2");
    expect(cleanDecimal("−20,3 °C")).toBe("-20.3");
    expect(cleanDecimal("-20.1°C")).toBe("-20.1");
    expect(cleanDecimal("50.6 %RH")).toBe("50.6");
    expect(cleanDecimal("50.6% RH")).toBe("50.6");
    expect(cleanDecimal("65.1 C")).toBe("65.1");
    expect(cleanDecimal("20 %")).toBe("20");
    expect(cleanDecimal("abc")).toBeNull();
    expect(cleanDecimal("12 kg")).toBeNull();
    expect(cleanDecimal("+.5")).toBe("0.5");
    expect(cleanDecimal(-24)).toBe("-24");
    expect(cleanDecimal("abc")).toBeNull();
    expect(cleanDecimal("")).toBeNull();
  });

  it("never prints -0", () => {
    expect(deviation("15.1", "15.1")).toBe("0.0");
    expect(deviation("-15.1", "-15.10")).toBe("0.00");
  });
});
