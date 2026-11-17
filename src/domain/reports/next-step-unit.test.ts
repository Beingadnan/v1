import { describe, expect, it } from "vitest";

import { reportStep } from "./next-step";

describe("reportStep", () => {
  it("names QA Tech's next job on a report, then the client's", () => {
    expect(reportStep(null)).toMatchObject({ stage: "todo", label: "Start the report" });
    expect(reportStep("draft")).toMatchObject({ stage: "todo", label: "Finish the draft" });
    expect(reportStep("checking")).toMatchObject({ stage: "todo", label: "Check it" });
    expect(reportStep("checked")).toMatchObject({ stage: "todo", label: "Release to the client" });
    expect(reportStep("returned")).toMatchObject({ stage: "todo", tone: "fail" });
    expect(reportStep("released")).toMatchObject({ stage: "client", label: "Record sign-off" });
    expect(reportStep("reviewed")).toMatchObject({ stage: "client" });
    expect(reportStep("signed")).toMatchObject({ stage: "signed", label: "Open" });
  });
});
