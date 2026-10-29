import { describe, expect, it } from "vitest";

import { instrumentSchema, modelSchema } from "./schemas";

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
