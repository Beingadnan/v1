import "server-only";

import { desc, eq } from "drizzle-orm";

import type { Transaction } from "@/db/client-factory";
import { studies, studyReports, type Job } from "@/db/schema";
import type { RequestInfo } from "@/domain/auth/policy";
import type { SessionUser } from "@/domain/auth/session-service";
import { setStatus } from "@/domain/jobs/job-service";
import type { JobStatus } from "@/domain/jobs/types";

import { REPORT_RANK, type ReportStatus } from "./types";

/** Job statuses that follow the reports (phase 9). */
const FOLLOWS: readonly JobStatus[] = [
  "report_draft",
  "rework",
  "checked",
  "sent_to_client",
  "client_signed",
];
const BY_RANK: Record<number, JobStatus> = {
  2: "checked",
  3: "sent_to_client",
  4: "client_signed",
};

/**
 * Moves the job to match its least advanced study: Checked when every study's
 * report is checked, Sent to client when every one is released, Client signed
 * when every one is signed. A report going back (a return, a new revision)
 * puts a job that had moved on into Rework.
 */
export async function syncJobToReports(
  tx: Transaction,
  actor: SessionUser,
  job: Job,
  reason: string,
  request?: RequestInfo,
  opts: { rework?: boolean } = {},
) {
  const from = job.status as JobStatus;
  if (!FOLLOWS.includes(from)) return;
  const rows = await tx
    .select({ studyId: studies.id, status: studyReports.status, rev: studyReports.rev })
    .from(studies)
    .leftJoin(studyReports, eq(studyReports.studyId, studies.id))
    .where(eq(studies.jobId, job.id))
    .orderBy(desc(studyReports.rev));
  const latest = new Map<string, ReportStatus | null>();
  for (const r of rows) {
    if (!latest.has(r.studyId)) latest.set(r.studyId, (r.status as ReportStatus | null) ?? null);
  }
  const ranks = [...latest.values()].map((s) => (s ? REPORT_RANK[s] : 0));
  const min = ranks.length ? Math.min(...ranks) : 0;
  let to: JobStatus = from;
  if (min >= 2) to = BY_RANK[min]!;
  else if (opts.rework || ["checked", "sent_to_client", "client_signed"].includes(from))
    to = "rework";
  if (to !== from) await setStatus(tx, actor, job, to, reason, request);
}
