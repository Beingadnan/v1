import { describe, expect, it } from "vitest";

import { cleanMonths, instrumentSchema, modelSchema } from "./schemas";

describe("blank form fields mean the default", () => {
  it("an instrument added without status or use is active and working", () => {
    const parsed = instrumentSchema.parse({
      modelId: "",
      type: "reference_thermometer",
      code: "QATM/CAL/SSPRT-01",
      tier: "",
      status: "",
      homeSiteId: "",
      ownerCompanyId: "",
      intervalMonths: "",
    });
    expect(parsed).toMatchObject({ tier: "working", status: "active", intervalMonths: null });
  });

  it("a model without an interval gets 12 months", () => {
    const parsed = modelSchema.parse({
      type: "portable_logger",
      make: "Testo",
      model: "174T",
      equipmentName: "Portable Datalogger",
      quantities: ["temperature"],
      accuracy: {},
      intervalMonths: "",
    });
    expect(parsed.intervalMonths).toBe(12);
  });
});

describe("calibration interval as people type it", () => {
  it("reads months and years, and says what is wrong otherwise", () => {
    expect(cleanMonths("12 months")).toBe(12);
    expect(cleanMonths("6 m")).toBe(6);
    expect(cleanMonths("1 year")).toBe(12);
    expect(cleanMonths("2 yrs")).toBe(24);
    expect(cleanMonths("12")).toBe(12);
    expect(cleanMonths("monthly")).toBe("monthly");
    const bad = instrumentSchema.safeParse({
      type: "humidity_indicator",
      code: "X-1",
      intervalMonths: "yearly",
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.message)).toContain(
      "Calibration interval must be a number of months, like 12.",
    );
    const ok = instrumentSchema.safeParse({
      type: "humidity_indicator",
      code: "X-1",
      intervalMonths: "12 months",
    });
    expect(ok.success && ok.data.intervalMonths).toBe(12);
  });
});
