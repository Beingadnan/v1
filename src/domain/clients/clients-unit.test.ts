import { describe, expect, it } from "vitest";

import { equipmentTypeFromText } from "./equipment-types";
import {
  checkReportNumberFormat,
  DEFAULT_REPORT_NUMBER_FORMAT,
  formatReportNumber,
} from "./report-number";
import { dueStatus, nextDueDate, todayInIndia } from "./requalification";
import { equipmentSchema } from "./schemas";

describe("report numbers", () => {
  it("rebuilds the BE-WF-02 report number with the default pattern", () => {
    expect(
      formatReportNumber(DEFAULT_REPORT_NUMBER_FORMAT, {
        clientCode: "Watson",
        siteCode: "Seawoods",
        department: "BA",
        equipmentName: "Cold Storage (Walk In Freezer)",
        equipmentCode: "BE-WF-02",
        month: 5,
        year: 2026,
      }),
    ).toBe("Watson/Seawoods/05/26/Cold Storage (Walk In Freezer)/BE-WF-02");
  });

  it("explains a bad pattern", () => {
    expect(checkReportNumberFormat(DEFAULT_REPORT_NUMBER_FORMAT)).toEqual({ ok: true });
    expect(checkReportNumberFormat("{CLIENT}/{SITE}")).toMatchObject({ ok: false });
    expect(checkReportNumberFormat("{CLIENT}/{FOO}/{EQUIPMENT_ID}")).toMatchObject({
      ok: false,
      message: expect.stringContaining("{FOO}"),
    });
    expect(checkReportNumberFormat("{CLIENT/{EQUIPMENT_ID}")).toMatchObject({ ok: false });
  });
});

describe("next due date", () => {
  it("is the anniversary minus one day, as on QA Tech reports", () => {
    expect(nextDueDate("2026-05-23", 12)).toBe("2027-05-22");
    expect(nextDueDate("2025-08-11", 12)).toBe("2026-08-10");
    expect(nextDueDate("2026-01-01", 6)).toBe("2026-06-30");
  });

  it("handles month ends and leap years", () => {
    expect(nextDueDate("2026-01-31", 1)).toBe("2026-02-27");
    expect(nextDueDate("2027-02-28", 12)).toBe("2028-02-27");
    expect(nextDueDate("2028-02-29", 12)).toBe("2029-02-27");
  });

  it("flags overdue and due within 30 days", () => {
    expect(dueStatus(null, "2026-10-29")).toBe("none");
    expect(dueStatus("2026-10-28", "2026-10-29")).toBe("overdue");
    expect(dueStatus("2026-11-20", "2026-10-29")).toBe("due_soon");
    expect(dueStatus("2027-05-22", "2026-10-29")).toBe("ok");
  });

  it("uses the Indian calendar day", () => {
    // 20:00 UTC on 28 Oct is already 29 Oct in India.
    expect(todayInIndia(new Date("2026-10-28T20:00:00Z"))).toBe("2026-10-29");
  });
});

describe("equipment types from spreadsheet text", () => {
  it.each([
    ["Walk In Freezer", "walk_in_freezer"],
    ["walk_in_freezer", "walk_in_freezer"],
    ["Fridge", "refrigerator"],
    ["Cold Room", "cold_room"],
    ["DHS", "dry_heat_oven"],
    ["Stability chamber", "stability_chamber"],
    ["Warehouse / store", "warehouse"],
  ])("%s → %s", (text, type) => {
    expect(equipmentTypeFromText(text)).toBe(type);
  });

  it("returns null when unsure", () => {
    expect(equipmentTypeFromText("Spaceship")).toBeNull();
    expect(equipmentTypeFromText("")).toBeNull();
  });
});

describe("equipment validation", () => {
  const base = {
    siteId: "00000000-0000-4000-8000-000000000001",
    departmentId: "",
    code: "BE-WF-02",
    name: "Cold Storage",
    type: "walk_in_freezer",
    location: "",
    make: "",
    model: "",
    serialNo: "",
    lengthM: "",
    widthM: "",
    heightM: "",
    setPointC: "-24",
    tempMinC: "-30",
    tempMaxC: "-15",
    rhMinPct: "",
    rhMaxPct: "",
    defaultChannels: "9",
    readingIntervalMinutes: "10",
    studyDurationHours: "24",
    requalificationMonths: "",
    lastStudyOn: "",
    notes: "",
  };

  it("turns form text into numbers and blanks into null", () => {
    const v = equipmentSchema.parse(base);
    expect(v).toMatchObject({ setPointC: -24, tempMinC: -30, lengthM: null, departmentId: null });
  });

  it("says what to fix", () => {
    const issues = (input: object) =>
      equipmentSchema.safeParse({ ...base, ...input }).error?.issues.map((i) => i.message);
    expect(issues({ defaultChannels: "9.5" })).toContain(
      "Number of loggers must be a whole number.",
    );
    expect(issues({ setPointC: "-10" })).toContain(
      "The set point is outside the acceptance limits.",
    );
    expect(issues({ tempMinC: "abc" })).toContain("Lowest temperature must be a number.");
    expect(issues({ lastStudyOn: "2999-01-01" })).toContain(
      "The last study can't be in the future.",
    );
    expect(issues({ type: "spaceship" })).toContain("Choose the equipment type.");
  });
});
