import { describe, expect, it } from "vitest";

import { EQUIPMENT_COLUMNS, matchHeaders, normaliseHeader } from "./columns";
import { cellText, dateText } from "./workbook";

describe("import headers", () => {
  it("ignores case, stars and units", () => {
    expect(normaliseHeader("Set point (°C) *")).toBe("set point");
    expect(normaliseHeader("  Equipment_ID: ")).toBe("equipment id");
  });

  it("accepts the words used in QA Tech reports", () => {
    const { indexes, missing } = matchHeaders(
      [
        "Client",
        "Site",
        "Equipment ID",
        "Equipment Name",
        "Type",
        "No. of Channels",
        "Mapping Duration",
        "Frequency of Reading",
      ],
      EQUIPMENT_COLUMNS,
    );
    expect(missing).toEqual([]);
    expect(indexes).toMatchObject({
      defaultChannels: 5,
      studyDurationHours: 6,
      readingIntervalMinutes: 7,
    });
  });

  it("names the missing required columns", () => {
    expect(matchHeaders(["Client", "Site"], EQUIPMENT_COLUMNS).missing).toEqual([
      "Equipment ID",
      "Equipment name",
      "Type",
    ]);
  });
});

describe("cell values", () => {
  it("reads Indian day-first dates", () => {
    expect(dateText("23.05.2026")).toBe("2026-05-23");
    expect(dateText("1/8/2025")).toBe("2025-08-01");
    expect(dateText("2026-05-23")).toBe("2026-05-23");
  });

  it("turns Excel values into text without float noise", () => {
    expect(cellText(0.1 + 0.2)).toBe("0.3");
    expect(cellText(-24)).toBe("-24");
    expect(cellText(new Date(Date.UTC(2026, 4, 23)))).toBe("2026-05-23");
    expect(cellText({ richText: [{ text: "BE-" }, { text: "WF-02" }] })).toBe("BE-WF-02");
    expect(cellText({ formula: "A1", result: 9 } as never)).toBe("9");
    expect(cellText(null)).toBe("");
  });
});
