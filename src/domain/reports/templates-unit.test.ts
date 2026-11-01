import { describe, expect, it } from "vitest";

import type { CycleResult, Excursion } from "@/domain/analysis/engine";

import { conclusionText, criteriaText, observationText, type TemplateInput } from "./templates";

const cycle = (over: Partial<CycleResult> = {}): CycleResult => ({
  cycle: "routine",
  label: "Study",
  start: 0,
  end: 1,
  positions: [],
  hot: { positionId: "p5", label: "L-05", avg: -16.67 },
  cold: { positionId: "p4", label: "L-04", avg: -21.94 },
  highest: null,
  lowest: null,
  excursions: [],
  pass: true,
  door: [],
  power: [],
  hold: null,
  ...over,
});
const base: TemplateInput = {
  equipmentName: "Walk In Freezer",
  equipmentCode: "BE-WF-02",
  studyName: "Temperature Mapping Study",
  limits: { tempMin: -30, tempMax: -15 },
  cycles: [cycle()],
  serialOf: (id) => ({ p4: "62220170", p5: "62283645", p8: "62283553" })[id] ?? "",
  reviewOf: () => null,
  deviations: [],
};
const excursion: Excursion = {
  positionId: "p8",
  label: "L-08",
  quantity: "temp",
  side: "high",
  limit: -15,
  start: 0,
  end: 0,
  minutes: 20,
  readings: 2,
  peak: -14.6,
};

describe("report text, as on BE-WF-02 page 6", () => {
  it("names the cold point (yellow) and hot point (red) with serial and average", () => {
    expect(observationText(base)).toBe(
      "The Datalogger location No L-04 (62220170) shown in yellow colour in the sensor location diagram recorded the average minimum temperature (-21.9°C); this location is the cold point of the equipment.\n" +
        "The Datalogger location No L-05 (62283645) shown in red colour in the sensor location diagram recorded the average maximum temperature (-16.7°C); this location is the hot point of the equipment.",
    );
  });

  it("concludes compliance with the criteria written upper limit first", () => {
    expect(criteriaText(base.limits)).toBe("-15°C To -30°C");
    expect(conclusionText(base)).toBe(
      "The above mentioned equipment Walk In Freezer (BE-WF-02) is monitored for Temperature Mapping Study & result found as per the acceptance criteria, so this equipment is in compliance with the defined criteria (-15°C To -30°C) & qualified for its further use.",
    );
  });

  it("names an accepted excursion and still qualifies", () => {
    const t = conclusionText({
      ...base,
      cycles: [cycle({ pass: false, excursions: [excursion] })],
      reviewOf: () => ({
        decision: "accepted",
        reason: "Door opened for loading.",
        deviation: null,
      }),
    });
    expect(t).toContain(
      "L-08 went above -15°C for 20 min (peak -14.6°C), accepted: Door opened for loading.",
    );
    expect(t).toMatch(/qualified for its further use\.$/);
  });

  it("does not qualify while an excursion is unreviewed", () => {
    const t = conclusionText({
      ...base,
      cycles: [cycle({ pass: false, excursions: [excursion] })],
    });
    expect(t).toMatch(/is not in compliance with the defined criteria \(-15°C To -30°C\)\.$/);
  });

  it("prefixes each line with the cycle when there are several", () => {
    const t = observationText({
      ...base,
      cycles: [cycle({ label: "Empty" }), cycle({ cycle: "loaded", label: "Loaded" })],
    });
    expect(t.split("\n").map((l) => l.split(":")[0])).toEqual([
      "Empty",
      "Empty",
      "Loaded",
      "Loaded",
    ]);
  });
});

describe("what the PDF can print", () => {
  it("allows typed punctuation and °, and names what it can't print", async () => {
    const { unprintable } = await import("./types");
    expect(unprintable("L-05 “hot” point — 30 min above −15 °C … µ")).toEqual([]);
    expect(unprintable("ok 👍 नमूना")).toEqual(["👍", "न", "म", "ू", "ा"]);
  });
});
