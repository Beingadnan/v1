import { describe, expect, it } from "vitest";

import { checkGstin, gstinCheckCharacter } from "./gstin";
import { companyNameKey } from "./names";
import { cyclesSchema, gstinSchema } from "./schemas";
import { BUILT_IN_TYPE_DEFAULTS, suggestLoggerCount } from "./study-defaults";

describe("GSTIN", () => {
  it("accepts real GSTINs and reads the state and PAN", () => {
    expect(checkGstin("27aaacq1042p1zb")).toEqual({
      ok: true,
      stateCode: "27",
      state: "Maharashtra",
      pan: "AAACQ1042P",
    });
    expect(checkGstin("29AAGCB7383J1Z4")).toMatchObject({ ok: true, state: "Karnataka" });
    expect(gstinCheckCharacter("27AAPFU0939F1Z")).toBe("V");
  });

  it("catches typing mistakes with a reason", () => {
    expect(checkGstin("27AAACQ1042P1ZC")).toMatchObject({
      ok: false,
      message: expect.stringContaining("typing mistake"),
    });
    expect(checkGstin("27AAACQ1042P1Z")).toMatchObject({
      ok: false,
      message: "A GSTIN has 15 characters; this has 14.",
    });
    expect(checkGstin("88AAACQ1042P1ZB")).toMatchObject({
      ok: false,
      message: "88 is not a GST state code.",
    });
    expect(gstinSchema.safeParse("").success).toBe(true);
  });
});

describe("study cycles", () => {
  it("reads checkbox values and spreadsheet text, in a fixed order", () => {
    expect(cyclesSchema.parse(["power_failure", "empty"])).toEqual(["empty", "power_failure"]);
    expect(cyclesSchema.parse("Door open, Loaded")).toEqual(["loaded", "door_open"]);
    expect(cyclesSchema.parse("")).toEqual([]);
    expect(cyclesSchema.safeParse("Defrost").success).toBe(false);
  });

  it("freezers include door-open and power-failure by default (QA Tech decision)", () => {
    expect(BUILT_IN_TYPE_DEFAULTS.freezer.cycles).toEqual([
      "empty",
      "loaded",
      "door_open",
      "power_failure",
    ]);
    expect(BUILT_IN_TYPE_DEFAULTS.warehouse).toMatchObject({
      studyDurationHours: 168,
      seasonalMapping: true,
    });
  });
});

describe("logger count suggestion", () => {
  it("follows chamber practice for small volumes", () => {
    expect(suggestLoggerCount({ lengthM: 0.8, widthM: 0.7, heightM: 1.8 })?.count).toBe(9);
    expect(suggestLoggerCount({ lengthM: 3, widthM: 2.5, heightM: 2.4 })?.count).toBe(15);
  });

  it("uses the WHO grid for rooms and warehouses", () => {
    // 20 × 10 m, 3 m high: 5 × 3 points every ~5 m, 3 heights.
    expect(suggestLoggerCount({ lengthM: 20, widthM: 10, heightM: 3 })).toMatchObject({
      count: 45,
    });
    // 6 m high store: 4 levels, as in WHO's example (0.3, 1.8, 3.6, 5.4 m).
    expect(suggestLoggerCount({ lengthM: 20, widthM: 10, heightM: 6 })?.count).toBe(60);
    // 1,000 m² floor: points every ~10 m → 5 × 4 at 4 heights.
    expect(suggestLoggerCount({ lengthM: 40, widthM: 25, heightM: 6 })?.count).toBe(80);
    expect(suggestLoggerCount({ lengthM: null, widthM: 2, heightM: 2 })).toBeNull();
  });
});

describe("duplicate client names", () => {
  it("ignores case, punctuation and legal suffixes", () => {
    expect(companyNameKey("M/s. Watson Pharma Pvt. Ltd.")).toBe(
      companyNameKey("WATSON PHARMA PRIVATE LIMITED"),
    );
    expect(companyNameKey("Watson Pharma")).not.toBe(companyNameKey("Watson Labs"));
  });
});

describe("numbers as people type them (found testing on 2 Nov 2026)", () => {
  it("drops units, converts mm and cm, and reads a decimal comma", async () => {
    const { cleanNumber } = await import("./schemas");
    expect(cleanNumber("3.5 m", "m")).toBe(3.5);
    expect(cleanNumber("3500 mm", "m")).toBe(3.5);
    expect(cleanNumber("240cm", "m")).toBe(2.4);
    expect(cleanNumber("2,5", "m")).toBe(2.5);
    expect(cleanNumber("-20 °C", "C")).toBe(-20);
    expect(cleanNumber("−18", "C")).toBe(-18);
    expect(cleanNumber("65 %RH", "%")).toBe(65);
    expect(cleanNumber("1,250", "m")).toBe(1250);
    expect(cleanNumber("abc", "m")).toBe("abc");
    expect(cleanNumber("", "C")).toBe("");
  });
});
