import { describe, expect, it } from "vitest";

import { dashDate, dateRange } from "./display";

describe("job dates on the board", () => {
  it("writes a date day-month-year with dashes", () => {
    expect(dashDate("2026-10-12")).toBe("12-10-2026");
  });

  it("writes a visit as its start and end date", () => {
    expect(dateRange("2026-10-12", "2026-10-19")).toBe("12-10-2026 to 19-10-2026");
    expect(dateRange("2026-12-28", "2027-01-02")).toBe("28-12-2026 to 02-01-2027");
    expect(dateRange("2026-11-10", "2026-11-10")).toBe("10-11-2026");
  });
});
