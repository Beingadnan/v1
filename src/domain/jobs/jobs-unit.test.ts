import { describe, expect, it } from "vitest";

import { parseCodes, pickInstruments, sparesFor, type Candidate } from "./booking";
import { jobValue } from "./pricing";
import {
  computeReadiness,
  datesShortfall,
  validThrough,
  type BookedInstrument,
  type ReadinessInput,
} from "./readiness";
import { defaultLoggerCount, defaultWorkType, seasonFor, uniqueReportNumber } from "./studies";
import { money } from "./schemas";
import { boardStatus, canTransition } from "./types";

const cert = (calibratedOn: string, validUntil: string | null, status = "issued") => ({
  id: `c-${calibratedOn}`,
  number: `N-${calibratedOn}`,
  status,
  calibratedOn,
  validUntil,
});

const logger = (
  code: string,
  validUntil: string | null,
  extra: Partial<BookedInstrument> = {},
) => ({
  code,
  type: "portable_logger",
  tier: "working",
  status: "active",
  certificates: [cert("2026-03-01", validUntil)],
  ...extra,
});

describe("validThrough", () => {
  it("needs the certificate to cover the whole study", () => {
    expect(validThrough(logger("A", "2027-02-28"), "2026-11-02", "2026-11-05").ok).toBe(true);
    expect(validThrough(logger("A", "2026-11-04"), "2026-11-02", "2026-11-05")).toEqual({
      ok: false,
      reason: "A is valid only until 04.11.2026",
    });
    expect(validThrough(logger("A", null), "2026-11-02", "2026-11-05").ok).toBe(true);
    expect(
      validThrough(logger("A", "2027-01-01", { status: "lost" }), "2026-11-02", "2026-11-05").ok,
    ).toBe(false);
    const draft = {
      ...logger("A", "2027-01-01"),
      certificates: [cert("2026-03-01", "2027-01-01", "draft")],
    };
    expect(validThrough(draft, "2026-11-02", "2026-11-05")).toEqual({
      ok: false,
      reason: "A has no valid certificate",
    });
  });
});

describe("computeReadiness", () => {
  const base: ReadinessInput = {
    poNumber: "",
    plannedStart: "2026-11-02",
    plannedEnd: "2026-11-05",
    studies: [
      { workType: "temperature_mapping", loggerCount: 2, postCalRequired: false },
      { workType: "temperature_mapping", loggerCount: 1, postCalRequired: false },
    ],
    booked: [],
    previousReports: [],
    manual: {},
  };
  const state = (r: ReturnType<typeof computeReadiness>, key: string) =>
    r.items.find((i) => i.key === key)!;

  it("works out the gate pass, and keeps an old tick from before the gate pass step", () => {
    expect(state(computeReadiness(base), "site_access")).toMatchObject({
      state: "pending",
      calculated: true,
    });
    expect(
      state(
        computeReadiness({ ...base, gatePass: { number: "GP-12", notNeeded: false } }),
        "site_access",
      ),
    ).toMatchObject({ state: "ready", detail: "Gate pass GP-12" });
    expect(
      state(
        computeReadiness({ ...base, gatePass: { number: "", notNeeded: true } }),
        "site_access",
      ),
    ).toMatchObject({ state: "na", detail: "No gate pass at this site." });
    const ticked = computeReadiness({
      ...base,
      manual: { site_access: { state: "ready", note: "" } },
    });
    expect(state(ticked, "site_access")).toMatchObject({ state: "ready", note: "" });
    expect(state(ticked, "site_access").detail).toBe("Ticked before the gate pass step.");
  });

  it("no longer lists the protocol or the days on site (QA Tech, Nov 2026)", () => {
    expect(computeReadiness(base).items.map((i) => i.key)).toEqual([
      "purchase_order",
      "site_access",
      "loggers_booked",
      "loggers_valid",
      "masters_valid",
      "previous_report",
    ]);
  });

  it("starts pending and becomes ready when everything is in place", () => {
    const first = computeReadiness(base);
    expect(first.ready).toBe(false);
    expect(state(first, "purchase_order").state).toBe("pending");
    expect(state(first, "loggers_booked").detail).toBe("0 of 3 booked: 3 more needed.");
    expect(state(first, "masters_valid").state).toBe("na");
    expect(state(first, "previous_report").state).toBe("na");

    const done = computeReadiness({
      ...base,
      poNumber: " 4500012345 ",
      booked: ["T1", "T2", "T3", "T4"].map((c) => logger(c, "2027-02-01")),
      manual: { site_access: { state: "na", note: "Own staff" } },
    });
    expect(done.items.filter((i) => i.state === "pending")).toEqual([]);
    expect(done.ready).toBe(true);
    expect(state(done, "loggers_booked").detail).toBe("4 booked for 3 needed (1 spare).");
    expect(state(done, "purchase_order").detail).toBe("PO 4500012345");
  });

  it("names the loggers that run out during the study", () => {
    const r = computeReadiness({
      ...base,
      booked: [logger("T1", "2027-01-01"), logger("T2", "2026-11-03"), logger("T3", "2026-10-01")],
    });
    expect(state(r, "loggers_valid").state).toBe("pending");
    expect(state(r, "loggers_valid").detail).toBe(
      "Not valid through the study: T2 is valid only until 03.11.2026; T3 is valid only until 01.10.2026.",
    );
  });

  it("asks for a valid master for thermal validation or a post-cal client", () => {
    const tv = {
      ...base,
      studies: [
        { workType: "thermal_validation" as const, loggerCount: 12, postCalRequired: false },
      ],
    };
    expect(state(computeReadiness(tv), "masters_valid").state).toBe("pending");
    const withMaster = computeReadiness({
      ...tv,
      booked: [logger("SSPRT-1", "2027-06-01", { tier: "master" })],
    });
    expect(state(withMaster, "masters_valid").state).toBe("ready");
    // Masters don't count towards the loggers.
    expect(state(withMaster, "loggers_booked").state).toBe("pending");
    const postCal = {
      ...base,
      studies: [
        { workType: "temperature_mapping" as const, loggerCount: 1, postCalRequired: true },
      ],
    };
    expect(state(computeReadiness(postCal), "masters_valid").state).toBe("pending");
  });

  it("finds the previous report in QTech, and asks only for one made before QTech", () => {
    const inQtech = computeReadiness({
      ...base,
      previousReports: [
        { label: "BE-WF-02", lastStudyOn: "2025-11-10", report: "W/11/25/BE-WF-02" },
      ],
      manual: { previous_report: { state: "pending", note: "" } },
    });
    // Found by itself; an old tick doesn't hide it.
    expect(state(inQtech, "previous_report")).toMatchObject({
      state: "ready",
      calculated: true,
      detail: "In QTech: BE-WF-02 W/11/25/BE-WF-02.",
    });
    const before = { label: "BE-WF-03", lastStudyOn: "2024-05-02", report: null };
    expect(
      state(computeReadiness({ ...base, previousReports: [before] }), "previous_report"),
    ).toMatchObject({
      state: "pending",
      calculated: false,
      detail: "Mapped before QTech, keep the last report to hand: BE-WF-03 (02.05.2024).",
    });
    const ticked = computeReadiness({
      ...base,
      previousReports: [before],
      manual: { previous_report: { state: "ready", note: "Report 05/24 on file" } },
    });
    expect(state(ticked, "previous_report")).toMatchObject({
      state: "ready",
      detail: "Report 05/24 on file",
    });
    // A person can't override a calculated item.
    const forced = computeReadiness({
      ...base,
      manual: { purchase_order: { state: "ready", note: "" } },
    });
    expect(state(forced, "purchase_order").state).toBe("pending");
  });
});

describe("pickInstruments", () => {
  const c = (code: string, over: Partial<Candidate> = {}): Candidate => ({
    id: code,
    code,
    type: "portable_logger",
    tier: "working",
    status: "active",
    modelId: "ebro",
    modelLabel: "ebro EBI 20",
    homeSiteId: "BHW",
    certificates: [cert("2026-03-01", "2027-02-28")],
    busyOn: [],
    ...over,
  });
  const run = (candidates: Candidate[], count: number) =>
    pickInstruments({
      candidates,
      count,
      type: "portable_logger",
      siteId: "BHW",
      start: "2026-11-02",
      end: "2026-11-05",
    });

  it("picks consecutive valid loggers and skips busy, expiring and retired ones", () => {
    const r = run(
      [
        c("T-10"),
        c("T-2"),
        c("T-1"),
        c("T-3", { busyOn: ["QT/J/2026/0007"] }),
        c("T-4", { certificates: [cert("2026-03-01", "2026-11-04")] }),
        c("T-5", { status: "retired" }),
        c("M-1", { tier: "master" }),
        c("TC-1", { type: "thermocouple" }),
      ],
      3,
    );
    expect(r.picked.map((p) => p.code)).toEqual(["T-1", "T-2", "T-10"]);
    expect(r.short).toBe(0);
    expect(r.skipped).toEqual([
      { reason: "on another job on these dates", count: 1 },
      { reason: "not calibrated through these dates", count: 1 },
      { reason: "not in use", count: 1 },
    ]);
  });

  it("prefers the job's site and one model that covers the whole set", () => {
    const r = run(
      [
        c("A-1", { homeSiteId: "BDD" }),
        c("A-2", { homeSiteId: "BDD" }),
        c("B-1", { modelId: "testo", modelLabel: "Testo" }),
        c("C-1"),
        c("C-2"),
      ],
      2,
    );
    expect(r.picked.map((p) => p.code)).toEqual(["C-1", "C-2"]);
  });

  it("mixes groups and reports the shortfall when nothing covers it", () => {
    const r = run([c("A-1", { homeSiteId: "BDD" }), c("C-1"), c("C-2")], 5);
    expect(r.picked.map((p) => p.code)).toEqual(["C-1", "C-2", "A-1"]);
    expect(r.short).toBe(2);
  });

  it("counts spares and reads pasted lists", () => {
    expect([0, 1, 9, 10, 11, 25].map(sparesFor)).toEqual([0, 1, 1, 1, 2, 3]);
    expect(parseCodes("T-TRH0101\nT-TRH0102, T-TRH0102\t84028451 ;")).toEqual([
      "T-TRH0101",
      "T-TRH0102",
      "84028451",
    ]);
  });

  it("expands a pasted range, as the booking box offers (Nov 2026)", () => {
    expect(parseCodes("T-TRH001 – T-TRH004")).toEqual([
      "T-TRH001",
      "T-TRH002",
      "T-TRH003",
      "T-TRH004",
    ]);
    expect(parseCodes("TRH-3615-TRH-3617, 84028479")).toEqual([
      "TRH-3615",
      "TRH-3616",
      "TRH-3617",
      "84028479",
    ]);
    // Space-separated serials, as typed or pasted from one Excel row.
    expect(parseCodes("83562089 84034958 84866839")).toHaveLength(3);
    // Backwards, or different prefixes: left as written.
    expect(parseCodes("T-TRH009 - T-TRH002")).toEqual(["T-TRH009", "T-TRH002"]);
  });
});

describe("job value", () => {
  it("comes from the PO; an old custom quote counts only without one", () => {
    expect(jobValue({ quotedValue: 50000, poValue: 45000 })).toEqual({
      expected: 45000,
      source: "po",
    });
    expect(jobValue({ quotedValue: 30000, poValue: null })).toEqual({
      expected: 30000,
      source: "quote",
    });
    expect(jobValue({ quotedValue: null, poValue: null })).toEqual({
      expected: null,
      source: "none",
    });
  });
});

describe("studies", () => {
  const eq = {
    type: "walk_in_freezer",
    lengthM: "3",
    widthM: "2",
    heightM: "2.5",
    rhMinPct: null,
    rhMaxPct: null,
    defaultChannels: null,
    seasonalMapping: false,
  };
  it("defaults the work and logger count from the equipment", () => {
    expect(defaultWorkType(eq)).toBe("temperature_mapping");
    expect(defaultWorkType({ ...eq, type: "autoclave" })).toBe("thermal_validation");
    expect(defaultWorkType({ ...eq, type: "warehouse", rhMaxPct: "65" })).toBe(
      "temperature_rh_mapping",
    );
    expect(defaultLoggerCount(eq)).toBe(15);
    expect(defaultLoggerCount({ ...eq, defaultChannels: 12 })).toBe(12);
    expect(defaultLoggerCount({ ...eq, lengthM: null })).toBe(0);
  });

  it("suggests the season only for seasonal spaces", () => {
    expect(seasonFor(false, "2026-05-01")).toBe("");
    expect(
      ["2026-04-10", "2026-07-01", "2026-11-02", "2027-02-28"].map((d) => seasonFor(true, d)),
    ).toEqual(["summer", "monsoon", "winter", "winter"]);
  });

  it("adds a suffix instead of repeating a report number", () => {
    const base = "Watson/Seawoods/11/26/Walk In Freezer/BE-WF-02";
    expect(uniqueReportNumber(base, new Set())).toBe(base);
    expect(uniqueReportNumber(base, new Set([base.toLowerCase()]))).toBe(`${base}-2`);
    expect(uniqueReportNumber(base, new Set([base.toLowerCase(), `${base}-2`.toLowerCase()]))).toBe(
      `${base}-3`,
    );
  });
});

describe("transitions", () => {
  it("starts field work only from Ready and never touches finished jobs", () => {
    expect(canTransition("ready", "start_field_work")).toBe(true);
    expect(canTransition("created", "start_field_work")).toBe(false);
    expect(canTransition("field_work", "hold")).toBe(true);
    expect(canTransition("on_hold", "hold")).toBe(false);
    expect(canTransition("closed", "cancel")).toBe(false);
    expect(canTransition("cancelled", "hold")).toBe(false);
    expect(canTransition("on_hold", "resume")).toBe(true);
  });

  it("keeps a held job on the board where it stopped", () => {
    expect(boardStatus("on_hold", "field_work")).toBe("field_work");
    expect(boardStatus("on_hold", null)).toBe("created");
    expect(boardStatus("ready", null)).toBe("ready");
  });
});

describe("money", () => {
  it("reads rupees the way people type them", () => {
    const m = money("PO value");
    expect(
      [
        "₹1,25,000",
        "Rs. 18,000/-",
        "INR 4500.50",
        " 650 ",
        "",
        "15k",
        "1.5 lakh",
        "2.25L",
        "1 cr",
        "rs 3 lacs",
      ].map((v) => m.parse(v)),
    ).toEqual([125000, 18000, 4500.5, 650, null, 15000, 150000, 225000, 10000000, 300000]);
    expect(() => m.parse("about 15000")).toThrow("PO value must be an amount in rupees");
    expect(() => m.parse("15 apples")).toThrow("PO value must be an amount in rupees");
    expect(() => m.parse("-5")).toThrow("must be an amount");
  });
});

describe("job dates", () => {
  it("refuses an end before the start and a year typed wrong", async () => {
    const { jobHeaderSchema } = await import("./schemas");
    const parse = (plannedStart: string, plannedEnd: string) =>
      jobHeaderSchema.safeParse({ plannedStart, plannedEnd }).error?.issues.map((i) => i.message);
    expect(parse("2026-11-02", "2026-11-05")).toBeUndefined();
    expect(parse("2026-11-05", "2026-11-02")).toEqual(["The end date is before the start."]);
    expect(parse("2026-11-02", "2027-11-05")).toEqual([
      "Plan at most 120 days per job. Check the year of the dates.",
    ]);
  });
});

describe("dates too short for the studies", () => {
  const input = (end: string): ReadinessInput => ({
    poNumber: "PO-1",
    plannedStart: "2026-11-04",
    plannedEnd: end,
    studies: [
      {
        workType: "temperature_mapping",
        loggerCount: 9,
        postCalRequired: false,
        durationHours: 24,
        label: "FZ-01",
      },
      {
        workType: "temperature_mapping",
        loggerCount: 9,
        postCalRequired: false,
        durationHours: 72,
        label: "CR-01",
      },
      {
        workType: "temperature_rh_mapping",
        loggerCount: 5,
        postCalRequired: false,
        durationHours: 168,
        label: "DSP-02",
      },
    ],
    booked: [],
    previousReports: [],
    manual: {},
  });
  const fit = (end: string) => datesShortfall(input(end));

  it("names the studies that don't fit and the last day that would", () => {
    expect(fit("2026-11-06")).toBe(
      "04.11.2026–06.11.2026 gives 48 h, but DSP-02 needs 168 h; CR-01 needs 72 h. Move the last day to 11.11.2026 or shorten the study.",
    );
  });

  it("says nothing when the last day leaves time for the longest study", () => {
    expect(fit("2026-11-11")).toBeNull();
  });
});

describe("dates: cycles run one after another", () => {
  it("counts every cycle of a study", () => {
    const r = datesShortfall({
      plannedStart: "2026-10-26",
      plannedEnd: "2026-11-02",
      studies: [
        {
          workType: "temperature_mapping",
          loggerCount: 9,
          postCalRequired: false,
          durationHours: 72,
          cycleCount: 4,
          label: "CR-01",
        },
      ],
    });
    expect(r).toBe(
      "26.10.2026–02.11.2026 gives 168 h, but CR-01 needs 288 h (4 cycles of 72 h). Move the last day to 07.11.2026 or shorten the study.",
    );
  });
});
