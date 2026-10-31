"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  approveAnalysis,
  assessDeviation,
  decideDeviation,
  openDeviation,
  recalculateImpact,
  reviewExcursion,
  runAnalysis,
  withdrawApproval,
  withdrawExcursionReview,
} from "@/domain/analysis/analysis-service";
import { runAction } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";

/** Server actions for the Analysis tab; plain objects in, like the data actions. */

async function act<T>(studyId: string, fn: Parameters<typeof runAction<T>>[0]) {
  const result = await runAction(fn);
  if (result.ok) {
    revalidatePath(`/studies/${studyId}`);
    revalidatePath("/jobs");
  }
  return result;
}

const signedOut = { ok: false as const, error: SESSION_ENDED };

export async function runAnalysisAction(studyId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () => runAnalysis(db, actor, studyId, await getRequestInfo()));
}

export async function reviewExcursionAction(
  studyId: string,
  input: { fingerprint: string; decision: "accepted" | "deviation"; reason: string },
) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    reviewExcursion(db, actor, studyId, input, await getRequestInfo()),
  );
}

export async function withdrawExcursionAction(studyId: string, fingerprint: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    withdrawExcursionReview(db, actor, studyId, fingerprint, await getRequestInfo()),
  );
}

export async function openDeviationAction(
  studyId: string,
  input: { title: string; description: string; positionId: string },
) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () => openDeviation(db, actor, studyId, input, await getRequestInfo()));
}

export async function assessDeviationAction(
  studyId: string,
  deviationId: string,
  assessment: string,
) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    assessDeviation(db, actor, deviationId, { assessment }, await getRequestInfo()),
  );
}

export async function decideDeviationAction(
  studyId: string,
  deviationId: string,
  input: {
    decision: string;
    decidedByName: string;
    decidedByTitle: string;
    decidedOn: string;
    note: string;
    fileId: string;
  },
) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    decideDeviation(db, actor, deviationId, input, await getRequestInfo()),
  );
}

export async function recalculateImpactAction(studyId: string, deviationId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    recalculateImpact(db, actor, deviationId, await getRequestInfo()),
  );
}

export async function approveAnalysisAction(studyId: string, runId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    approveAnalysis(db, actor, studyId, runId, await getRequestInfo()),
  );
}

export async function withdrawApprovalAction(studyId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    withdrawApproval(db, actor, studyId, reason, await getRequestInfo()),
  );
}
