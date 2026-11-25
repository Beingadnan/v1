import type { Database } from "@/db/client-factory";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { setStudyPeriod } from "@/domain/data/data-service";
import { getStudyData } from "@/domain/data/queries";

/** "2026-05-22T18:30" in India time. */
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);

/**
 * Chooses each cycle's report period as the times recorded on site, as a team
 * leader does on Start & end when they match the data. The demo data and the
 * tests use it: the period must be chosen before the data is confirmed.
 */
export async function choosePeriodsAsLogged(
  db: Database,
  actor: SessionUser,
  studyId: string,
  request?: RequestInfo,
): Promise<void> {
  const data = await getStudyData(db, actor, studyId);
  for (const p of data?.periods ?? []) {
    if (p.fromData || !p.start || !p.end) continue;
    await setStudyPeriod(
      db,
      actor,
      studyId,
      { cycle: p.cycle, start: ist(p.start), end: ist(p.end), reason: "" },
      request,
    );
  }
}
