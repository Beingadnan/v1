import { describe, expect, it } from "vitest";

import { parseTypedDate, parseTypedTime, toTypedParts } from "./typed-datetime";

describe("dates and times as typed", () => {
  it("reads the ways QA Tech writes a date", () => {
    expect(parseTypedDate("01-08-26")).toBe("2026-08-01");
    expect(parseTypedDate("01.08.2026")).toBe("2026-08-01");
    expect(parseTypedDate("1/8/2026")).toBe("2026-08-01");
    expect(parseTypedDate("30-02-2027")).toBeNull();
    expect(parseTypedDate("2026-08-01")).toBeNull();
  });

  it("reads 12- and 24-hour times", () => {
    expect(parseTypedTime("11:30 AM")).toBe("11:30");
    expect(parseTypedTime("11.30am")).toBe("11:30");
    expect(parseTypedTime("12:15 am")).toBe("00:15");
    expect(parseTypedTime("12:15 PM")).toBe("12:15");
    expect(parseTypedTime("1130")).toBe("11:30");
    expect(parseTypedTime("23:30")).toBe("23:30");
    expect(parseTypedTime("2 pm")).toBe("14:00");
    expect(parseTypedTime("13:00 pm")).toBeNull();
    expect(parseTypedTime("24:00")).toBeNull();
  });

  it("shows an instant the way it is typed, in India time", () => {
    expect(toTypedParts("2026-08-01T06:00:00Z")).toEqual(["01-08-2026", "11:30 AM"]);
    // Noon and midnight as people write them, on every ICU build.
    expect(toTypedParts("2026-11-12T06:30:00Z")).toEqual(["12-11-2026", "12:00 PM"]);
    expect(toTypedParts("2026-11-12T18:30:00Z")).toEqual(["13-11-2026", "12:00 AM"]);
    expect(toTypedParts("2026-11-12T19:35:00Z")).toEqual(["13-11-2026", "01:05 AM"]);
  });
});
