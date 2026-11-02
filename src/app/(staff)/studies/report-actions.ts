"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { ReportsError } from "@/domain/reports/errors";
import {
  createReport,
  editReportText,
  freezeReport,
  newRevision,
} from "@/domain/reports/report-service";
import {
  answerComment,
  checkReport,
  recordPaperSignoff,
  releaseReport,
  returnForRework,
} from "@/domain/reports/review-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { env } from "@/lib/env";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/** Server actions for the Report tab. */

function refresh(studyId: string) {
  revalidatePath(`/studies/${studyId}`);
  revalidatePath("/reports");
  revalidatePath("/jobs");
  revalidatePath("/client");
}

async function act<T>(studyId: string, fn: Parameters<typeof runAction<T>>[0]) {
  const result = await runAction(fn);
  if (result.ok) refresh(studyId);
  return result;
}

const signedOut = { ok: false as const, error: SESSION_ENDED };
const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

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

/**
 * QA Tech's two signatures, from the password dialog: Done By (freezes the
 * draft and sends it for checking) and Checked By.
 */
export async function signReportAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ text: string }>> {
  const actor = await userForAction();
  if (!actor) return signedOut;
  const studyId = field(formData, "studyId");
  const reportId = field(formData, "reportId");
  const step = field(formData, "step");
  const password = field(formData, "password");
  return act(studyId, async () => {
    const request = await getRequestInfo();
    if (step === "done_by") {
      const f = await freezeReport(db, blobStore, actor, reportId, { password }, request);
      if (!f.ok) throw new ReportsError(f.message);
      return {
        text: `Rev ${String(f.rev).padStart(2, "0")} frozen and signed Done By: ${f.pages} pages, SHA-256 ${f.sha256.slice(0, 12)}…. It's with the checker now.`,
      };
    }
    if (step === "checked_by") {
      const c = await checkReport(db, actor, reportId, { password }, request);
      if (!c.ok) throw new ReportsError(c.message);
      return { text: "Signed Checked By. It can be released to the client." };
    }
    throw new ReportsError("Unknown step.");
  });
}

export type CommentInput = { section: string; page: number | null; body: string };

export async function returnForReworkAction(
  studyId: string,
  reportId: string,
  comments: CommentInput[],
) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    returnForRework(db, actor, reportId, { comments }, await getRequestInfo()),
  );
}

export async function answerCommentAction(studyId: string, commentId: string, answer: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    answerComment(db, actor, commentId, answer, await getRequestInfo()),
  );
}

export async function releaseReportAction(studyId: string, reportId: string, to: string[]) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () =>
    releaseReport(db, actor, reportId, { to }, env.APP_URL, await getRequestInfo()),
  );
}

export async function paperSignoffAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<void>> {
  const actor = await userForAction();
  if (!actor) return signedOut;
  const studyId = field(formData, "studyId");
  const names = [
    "fileId",
    "reviewedByName",
    "reviewedOn",
    "approvedByName",
    "approvedByTitle",
    "approvedOn",
  ] as const;
  const input = Object.fromEntries(names.map((n) => [n, field(formData, n)]));
  const result = await runAction(
    async () =>
      recordPaperSignoff(db, actor, field(formData, "reportId"), input, await getRequestInfo()),
    "Paper sign-off recorded. The report is signed.",
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function newRevisionAction(studyId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(studyId, async () => newRevision(db, actor, studyId, reason, await getRequestInfo()));
}
