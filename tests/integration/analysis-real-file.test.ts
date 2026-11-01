/**
 * Phase 7 exit test on QA Tech's own data: BE-WF-02's logger export
 * (fixtures/client, git-ignored; skipped without it) uploaded to a study
 * with the report's nine loggers, confirmed and analysed, gives page 5 of
 * the issued report: every minimum, maximum and average, L-05 the hot spot
 * (−16.7) and L-04 the cold spot (−21.9).
 */
import { existsSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAnalysis } from "@/domain/analysis/analysis-service";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import type { SessionUser } from "@/domain/auth/session-service";

import { BE_WF_02_FILE, seedBeWf02 } from "../support/be-wf-02";
import { openTestDatabase } from "../support/test-db";

// Page 5 of the issued report: position, min, max, average (°C).
const PAGE5: [string, number, number, number][] = [
  ["L-01", -22.9, -17.9, -21.0],
  ["L-02", -23.4, -18.7, -21.8],
  ["L-03", -22.8, -18.5, -21.7],
  ["L-04", -23.0, -20.0, -21.9],
  ["L-05", -17.6, -15.0, -16.7],
  ["L-06", -21.9, -19.0, -21.1],
  ["L-07", -23.0, -17.8, -21.1],
  ["L-08", -23.3, -15.0, -19.7],
  ["L-09", -22.9, -18.7, -21.3],
];
const r1 = (v: number) => Math.round(v * 10) / 10;

const { db, close } = openTestDatabase();
const req = { ipAddress: "203.0.113.92" };
let lead: SessionUser;
let studyId: string;

describe.skipIf(!existsSync(BE_WF_02_FILE))("BE-WF-02, QA Tech's own export, end to end", () => {
  beforeAll(async () => {
    ({ lead, studyId } = await seedBeWf02(db, "real-file-org"));
  });

  afterAll(close);

  it("matches every number on page 5, with L-05 hot and L-04 cold", async () => {
    await runAnalysis(db, lead, studyId, req);
    const a = (await getStudyAnalysis(db, lead, studyId))!;
    const c = a.run!.result.cycles[0]!;
    expect(c.positions.map((p) => p.temp!.count)).toEqual(Array(9).fill(145));
    expect(
      c.positions.map((p) => [p.label, r1(p.temp!.min), r1(p.temp!.max), r1(p.temp!.avg)]),
    ).toEqual(PAGE5);
    expect(c.hot).toMatchObject({ label: "L-05" });
    expect(r1(c.hot!.avg)).toBe(-16.7);
    expect(c.cold).toMatchObject({ label: "L-04" });
    expect(r1(c.cold!.avg)).toBe(-21.9);
    // −15.0 at L-05 and L-08 is on the limit, not over it: within limits, no excursion.
    expect(c.excursions).toEqual([]);
    expect(c.pass).toBe(true);
  });
});
