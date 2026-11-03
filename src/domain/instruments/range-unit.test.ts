import { describe, expect, it } from "vitest";

import { expandRange } from "./queries";

describe("instrument ranges as people type them (found testing on 2 Nov 2026)", () => {
  it("expands a range of codes", () => {
    expect(expandRange("TEST-TRH0001 - TEST-TRH0003")).toEqual([
      "TEST-TRH0001",
      "TEST-TRH0002",
      "TEST-TRH0003",
    ]);
    expect(expandRange("E-TRH0533 to 0535")).toEqual(["E-TRH0533", "E-TRH0534", "E-TRH0535"]);
    expect(expandRange("E-TRH0533-0534")).toEqual(["E-TRH0533", "E-TRH0534"]);
  });
  it("leaves single codes, serials and odd ranges alone", () => {
    expect(expandRange("TEST-TRH0001")).toEqual(["TEST-TRH0001"]);
    expect(expandRange("62283645")).toEqual(["62283645"]);
    expect(expandRange("A-0005 - B-0007")).toEqual(["A-0005 - B-0007"]);
    expect(expandRange("X-0009 - X-0002")).toEqual(["X-0009 - X-0002"]);
  });
});
