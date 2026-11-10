/**
 * How many waits on the database each page's loader needs (ADR 0017, 0018).
 * QA Tech's database is ~250 ms away, so every round of reads that waits for
 * the one before it costs a quarter of a second. Here every query is delayed
 * by DELAY ms and a loader's time, divided by DELAY, gives its rounds. A new
 * `await` in the middle of a loader shows up as one more round and fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, createPool, type Database } from "@/db/client-factory";
import { runAnalysis } from "@/domain/analysis/analysis-service";
import { deviationRegister } from "@/domain/analysis/capa-service";
import { getStudyAnalysis } from "@/domain/analysis/queries";
import type { SessionUser } from "@/domain/auth/session-service";
import { billingOverview } from "@/domain/billing/queries";
import { homeFor } from "@/domain/dashboard/home";
import { getStudyData } from "@/domain/data/queries";
import { getFieldStudy } from "@/domain/field/queries";
import { listInstruments, traceChain } from "@/domain/instruments/queries";
import { bookingChoices } from "@/domain/jobs/job-service";
import { findJob, jobDetail } from "@/domain/jobs/queries";
import { getStudyReport, listReports } from "@/domain/reports/queries";

import { seedBeWf02 } from "../support/be-wf-02";
import { requireTestDatabaseUrl } from "../support/test-db";

const DELAY = 60;
const pool = createPool(requireTestDatabaseUrl(), 30);
const plain: Database = createDatabase(pool);
// The same database, with every query held back DELAY ms, as if it were far away.
const slowPool = createPool(requireTestDatabaseUrl(), 30);
const query = slowPool.query.bind(slowPool) as (...args: unknown[]) => Promise<unknown>;
(slowPool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = async (
  ...args: unknown[]
) => {
  await new Promise((r) => setTimeout(r, DELAY));
  return query(...args);
};
const slow: Database = createDatabase(slowPool);
afterAll(async () => {
  await pool.end();
  await slowPool.end();
});

/** Rounds of waiting for the database while `load` runs (the best of two runs). */
async function rounds(load: () => Promise<unknown>): Promise<number> {
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const t = performance.now();
    await load();
    best = Math.min(best, performance.now() - t);
  }
  return Math.floor(best / DELAY);
}

let lead: SessionUser;
let manager: SessionUser;
let studyId: string;
let jobId: string;
let instrumentId: string;

beforeAll(async () => {
  const w = await seedBeWf02(plain, "round-trips-org");
  ({ lead, manager, studyId, jobId } = w);
  await runAnalysis(plain, lead, studyId, { ipAddress: "203.0.113.93" });
  const s = (await getFieldStudy(plain, lead, studyId))!;
  instrumentId = s.positions.find((p) => p.instrumentId)!.instrumentId!;
  // Open the slow pool's connections first: a new connection is its own cost, paid once.
  await Promise.all(Array.from({ length: 30 }, () => slowPool.query("select 1")));
}, 60_000);

describe("rounds of reads per page (each costs ~250 ms from Bhiwandi)", () => {
  it("home: one", async () => {
    expect(await rounds(() => homeFor(slow, manager))).toBeLessThanOrEqual(1);
  });

  it("job: the job, then everything else in one round", async () => {
    expect(
      await rounds(async () => {
        const row = (await findJob(slow, manager, jobId))!;
        await Promise.all([
          jobDetail(slow, manager, row),
          bookingChoices(slow, manager, jobId, { job: row.job }),
        ]);
      }),
    ).toBeLessThanOrEqual(2);
  });

  it("study tabs: the study, then the tab", async () => {
    expect(await rounds(() => getFieldStudy(slow, lead, studyId))).toBeLessThanOrEqual(2);
    expect(await rounds(() => getStudyData(slow, lead, studyId))).toBeLessThanOrEqual(2);
    expect(await rounds(() => getStudyAnalysis(slow, lead, studyId))).toBeLessThanOrEqual(2);
    expect(await rounds(() => getStudyReport(slow, lead, studyId))).toBeLessThanOrEqual(2);
  });

  it("lists: one", async () => {
    expect(await rounds(() => listInstruments(slow, manager))).toBeLessThanOrEqual(1);
    expect(await rounds(() => billingOverview(slow, manager))).toBeLessThanOrEqual(1);
    expect(await rounds(() => deviationRegister(slow, manager))).toBeLessThanOrEqual(1);
    expect(await rounds(() => listReports(slow, manager))).toBeLessThanOrEqual(1);
  });

  it("an instrument's traceability: one round per link of the chain", async () => {
    // Logger → its master → the master's outside lab: two links here.
    expect(
      await rounds(() => traceChain(slow, manager, instrumentId, "2026-01-01")),
    ).toBeLessThanOrEqual(3);
  });
});
