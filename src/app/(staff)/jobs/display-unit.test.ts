import { describe, expect, it } from "vitest";

import { dashDate, dataOverdue, dateRange } from "./display";

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

describe("data due by the job's last day", () => {
  it("is overdue only once the day has passed and the data isn't in", () => {
    expect(dataOverdue("field_work", "2026-11-24", "2026-11-25")).toBe(true);
    expect(dataOverdue("data_issue", "2026-11-24", "2026-11-25")).toBe(true);
    expect(dataOverdue("field_work", "2026-11-25", "2026-11-25")).toBe(false);
    expect(dataOverdue("data_received", "2026-11-24", "2026-11-25")).toBe(false);
    expect(dataOverdue("report_draft", "2026-11-01", "2026-11-25")).toBe(false);
  });
});
