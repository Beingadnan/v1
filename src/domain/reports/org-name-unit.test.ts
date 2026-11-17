import { describe, expect, it } from "vitest";

import { underShortName, withShortName } from "./org-name";

const LEGAL = "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)";

describe("the company's name on the report", () => {
  it("prints a legal name that starts with the short name once", () => {
    expect(withShortName("QA Tech", LEGAL)).toBe(LEGAL);
    expect(withShortName("qa tech", LEGAL)).toBe(LEGAL);
    expect(underShortName("QA Tech", LEGAL)).toBe(
      "(A Division of GMP Technical Solutions Pvt. Ltd.)",
    );
  });

  it("puts a different legal name in brackets after the short name", () => {
    expect(withShortName("QA Tech", "GMP Technical Solutions Pvt. Ltd.")).toBe(
      "QA Tech (GMP Technical Solutions Pvt. Ltd.)",
    );
    expect(underShortName("QA Tech", "GMP Technical Solutions Pvt. Ltd.")).toBe(
      "(GMP Technical Solutions Pvt. Ltd.)",
    );
  });

  it("prints no empty brackets when one of the names is missing or they are the same", () => {
    expect(withShortName("QA Tech", "QA Tech")).toBe("QA Tech");
    expect(underShortName("QA Tech", "QA Tech")).toBe("");
    expect(withShortName("", LEGAL)).toBe(LEGAL);
    expect(withShortName("QA Tech", "")).toBe("QA Tech");
    expect(underShortName("QA Tech", "")).toBe("");
  });
});
