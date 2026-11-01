"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  createReport,
  editReportText,
  freezeReport,
  newRevision,
} from "@/domain/reports/report-service";
import { runAction } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/** Server actions for the Report tab. */

async function act<T>(studyId: string, fn: Parameters<typeof runAction<T>>[0]) {
  const result = await runAction(fn);
  if (result.ok) {
    revalidatePath(`/studies/${studyId}`);
    revalidatePath("/reports");
    revalidatePath("/jobs");
  }
  return result;
}

const signedOut = { ok: false as const, error: SESSION_ENDED };

export async function createReportAction(studyId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () => createReport(db, actor, studyId, await getRequestInfo()));
}

export async function editReportTextAction(
  studyId: string,
  reportId: string,
  section: "observation" | "conclusion",
  text: string | null,
) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    editReportText(db, actor, reportId, { section, text }, await getRequestInfo()),
  );
}

export async function freezeReportAction(studyId: string, reportId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    freezeReport(db, blobStore, actor, reportId, await getRequestInfo()),
  );
}

export async function newRevisionAction(studyId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () => newRevision(db, actor, studyId, reason, await getRequestInfo()));
}
