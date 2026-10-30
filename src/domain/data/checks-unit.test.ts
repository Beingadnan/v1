import { describe, expect, it } from "vitest";

import {
  checkData,
  intervalOf,
  matchChannels,
  type ChannelInfo,
  type PositionInfo,
} from "./checks";

const ist = (s: string) => new Date(`2026-05-22T${s}:00+05:30`).getTime();
const MIN = 60_000;

/** Nine positions like BE-WF-02, with the serials of the loggers placed. */
const SERIALS = [
  "62281257",
  "62230434",
  "62283621",
  "62220170",
  "62283645",
  "62273014",
  "62219287",
  "62283553",
  "62283563",
];
const positions: PositionInfo[] = SERIALS.map((s, i) => ({
  id: `p${i + 1}`,
  label: `L-0${i + 1}`,
  ambient: false,
  logger: { code: `E-TRH000${i + 1}`, serialNo: s },
}));
const times = Array.from({ length: 13 }, (_, i) => ist("22:30") + i * 10 * MIN); // 22:30–00:30
const channel = (serial: string, over: Partial<ChannelInfo> = {}): ChannelInfo => ({
  id: `c-${serial}-${over.quantity ?? "temp"}`,
  fileId: "f1",
  fileName: "BE-WF-02.xlsx",
  header: `${serial} °C`,
  serial,
  quantity: "temp",
  manual: null,
  values: times.map((_, i) => -22 + (i % 3) * 0.1),
  unreadable: [],
  ...over,
});
const base = {
  positions,
  files: [{ id: "f1", name: "BE-WF-02.xlsx", times, badTimeRows: [] }],
  windows: [
    {
      cycle: "routine",
      label: "Study",
      start: ist("22:30"),
      end: ist("24:30".replace("24", "00")) + 24 * 60 * MIN,
    },
  ],
  intervalMinutes: 10,
  needsRh: false,
};

describe("matching channels to positions", () => {
  it("matches by serial (leading zeros and SN- prefixes ignored), then logger ID, then label", () => {
    const m = matchChannels(
      [
        { id: "a", serial: "062281257", manual: null },
        { id: "b", serial: "E-TRH0002", manual: null },
        { id: "c", serial: "L-03", manual: null },
        { id: "d", serial: "99999999", manual: null },
        { id: "e", serial: "99999999", manual: { positionId: "p4", ignored: false } },
        { id: "f", serial: "62283645", manual: { positionId: null, ignored: true } },
      ],
      positions,
    );
    expect([...m.values()].map((x) => `${x.positionId}:${x.how}`)).toEqual([
      "p1:serial",
      "p2:code",
      "p3:label",
      "null:none",
      "p4:manual",
      "null:ignored",
    ]);
  });
});

describe("checks", () => {
  it("passes complete data with no issues", () => {
    const r = checkData({ ...base, channels: SERIALS.map((s) => channel(s)) });
    expect(r.issues).toEqual([]);
  });

  it("blocks a 30-minute gap and warns on one missing reading", () => {
    const gap = channel(SERIALS[2]!, {
      values: times.map((_, i) => (i >= 4 && i <= 5 ? null : -22 + (i % 2) * 0.1)),
    });
    const one = channel(SERIALS[3]!, {
      values: times.map((_, i) => (i === 8 ? null : -22 + (i % 2) * 0.1)),
    });
    const r = checkData({
      ...base,
      channels: [
        ...SERIALS.filter((s) => s !== SERIALS[2] && s !== SERIALS[3]).map((s) => channel(s)),
        gap,
        one,
      ],
    });
    expect(r.issues.map((i) => [i.kind, i.severity, i.message])).toEqual(
      [
        [
          "gap",
          "blocker",
          "L-03 (E-TRH0003, 62283621) °C: 2 readings missing between 23:00 and 23:30 (a 30-min gap).",
        ],
        [
          "single_missing",
          "warning",
          "L-04 (E-TRH0004, 62220170) °C: one reading missing at 23:50.",
        ],
      ].map(([k, s, m]) => [k, s, m!.replace(/(\d\d:\d\d)/g, (t) => `22 May, ${t}`)]),
    );
  });

  it("blocks a missing logger, a wrong interval, data that stops early and impossible values", () => {
    const short = channel(SERIALS[0]!, {
      values: times.map((_, i) => (i > 9 ? null : -22 + (i % 2) * 0.1)),
    });
    const hot = channel(SERIALS[1]!, {
      values: times.map((_, i) => (i === 3 ? 999 : -22 + (i % 2) * 0.1)),
    });
    const r = checkData({
      ...base,
      intervalMinutes: 5,
      channels: [short, hot, ...SERIALS.slice(2, 8).map((s) => channel(s))],
    });
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toContain("interval");
    expect(kinds).toContain("missing_logger");
    expect(kinds).toContain("not_covered");
    expect(kinds).toContain("impossible");
    expect(r.issues.every((i) => i.severity === "blocker")).toBe(true);
    expect(r.issues.find((i) => i.kind === "missing_logger")!.message).toBe(
      "L-09 (E-TRH0009, 62283563) is not in the data. Upload its file, or match its column by hand.",
    );
  });

  it("asks for RH on an RH study, spots swapped columns and a stuck sensor, and lists stray loggers", () => {
    const swapped = channel(SERIALS[0]!, {
      id: "rh1",
      quantity: "rh",
      values: times.map(() => -22),
    });
    const stuck = channel(SERIALS[1]!, { values: times.map(() => -22) });
    const stray = channel("12345678", { id: "stray" });
    const r = checkData({
      ...base,
      needsRh: true,
      channels: [
        channel(SERIALS[0]!),
        swapped,
        stuck,
        stray,
        ...SERIALS.slice(2).map((s) => channel(s)),
      ],
    });
    expect(r.issues.filter((i) => i.kind === "missing_rh")).toHaveLength(8);
    expect(r.issues.find((i) => i.kind === "impossible")!.message).toMatch(/swapped/);
    expect(r.issues.find((i) => i.kind === "stuck")!.severity).toBe("warning");
    expect(r.issues.find((i) => i.kind === "unmatched_channel")!.message).toMatch(/12345678/);
  });

  it("uses the file's span when no times were recorded on site, and says so", () => {
    const r = checkData({
      ...base,
      windows: [{ cycle: "routine", label: "Study", start: null, end: null }],
      channels: SERIALS.map((s) => channel(s)),
    });
    expect(r.issues.map((i) => i.kind)).toEqual(["no_times"]);
    expect(r.windows[0]).toMatchObject({ start: times[0], end: times.at(-1) });
  });

  it("blocks a file from another period (the wrong study's file)", () => {
    const later = times.map((t) => t + 120 * 86_400_000);
    const r = checkData({
      ...base,
      files: [{ id: "f1", name: "Fridge.xlsx", times: later, badTimeRows: [] }],
      channels: SERIALS.map((s) => channel(s)),
    });
    expect(r.issues[0]).toMatchObject({ kind: "wrong_period", severity: "blocker" });
    expect(r.issues[0]!.message).toMatch(
      /^Fridge\.xlsx has readings from .+ but the study ran .+ Is it the right file\?/,
    );
  });

  it("reads the interval as the usual gap", () => {
    expect(intervalOf([0, 10, 20, 40, 50].map((m) => m * MIN))).toBe(10);
  });
});
