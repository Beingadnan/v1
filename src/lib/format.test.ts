import { describe, expect, it } from "vitest";

import { formatDate, formatDecimal, formatLimits } from "./format";

describe("display formats", () => {
  it("shows calendar dates without shifting the day", () => {
    expect(formatDate("2027-05-22")).toBe("22 May 2027");
    expect(formatDate(null)).toBe("—");
  });

  it("shows limits the way reports do", () => {
    expect(formatDecimal("-30.00")).toBe("−30");
    expect(formatDecimal("2.50")).toBe("2.5");
    expect(formatLimits("-30.00", "-15.00", "°C")).toBe("−30 to −15 °C");
    expect(formatLimits(null, "25.00", "°C")).toBe("≤ 25 °C");
    expect(formatLimits("2", null, "°C")).toBe("≥ 2 °C");
    expect(formatLimits(null, null, "%RH")).toBe("—");
  });
});
