import { describe, expect, it } from "vitest";

import { nextStep } from "./next-step";
import type { MyStudy } from "./queries";

const base: MyStudy = {
  id: "s",
  status: "planned",
  jobId: "j",
  jobNumber: "QT/11/2026/0001",
  jobStatus: "field_work",
  companyName: "Watson",
  siteName: "Seawoods",
  equipmentCode: "WF-01",
  equipmentName: "Walk-in Freezer",
  department: null,
  plannedStart: "2026-11-17",
  plannedEnd: "2026-11-17",
  positions: 0,
  placed: 0,
  loggerCount: 9,
  today: true,
  dataStatus: "none",
  request: null,
  postCalLeft: 0,
  toAnalyse: false,
};
const at = (change: Partial<MyStudy>) => nextStep({ ...base, ...change });

describe("nextStep", () => {
  it("walks a study through the site in the study page's order", () => {
    expect(at({})).toMatchObject({ stage: "site", label: "Lay out positions", tab: "layout" });
    expect(at({ positions: 9, placed: 4 })).toMatchObject({
      label: "Place loggers",
      tab: "loggers",
    });
    expect(at({ positions: 9, placed: 9 })).toMatchObject({
      label: "Record the start",
      tab: "times",
    });
    expect(at({ positions: 9, placed: 9, status: "in_progress" })).toMatchObject({
      label: "Record the end",
    });
  });

  it("then the data, post-calibration and analysis", () => {
    const ended = { status: "completed" as const, positions: 9, placed: 9 };
    expect(at(ended)).toMatchObject({ stage: "data", label: "Upload logger data" });
    expect(at({ ...ended, dataStatus: "issues" })).toMatchObject({
      label: "Fix the data",
      tone: "fail",
    });
    expect(at({ ...ended, dataStatus: "checked" })).toMatchObject({ label: "Confirm the data" });
    expect(at({ ...ended, dataStatus: "received", postCalLeft: 1 })).toMatchObject({
      stage: "postcal",
      label: "Post-calibrate 1 logger",
    });
    expect(at({ ...ended, dataStatus: "received", toAnalyse: true })).toMatchObject({
      stage: "analysis",
      label: "Analyse",
    });
    expect(at({ ...ended, dataStatus: "received" })).toMatchObject({ stage: "done" });
  });

  it("puts what the office asked for first", () => {
    expect(at({ positions: 9, placed: 2, request: "Pages 3-4 of the PDF" })).toMatchObject({
      stage: "data",
      detail: "Pages 3-4 of the PDF",
    });
  });
});
