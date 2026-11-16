"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  acceptIssue,
  addDataFile,
  closeRequest,
  markReceived,
  removeDataFile,
  requestData,
  setChannelMatch,
  setStudyPeriod,
  type AddResult,
  withdrawAcceptance,
} from "@/domain/data/data-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/** Server actions for the Data tab; plain objects in, like the field actions. */

function refresh(studyId: string) {
  revalidatePath(`/studies/${studyId}`);
  revalidatePath("/studies");
  revalidatePath("/jobs");
}

async function act<T>(studyId: string, fn: () => Promise<T>, done?: string) {
  const result = await runAction(fn, done);
  if (result.ok) refresh(studyId);
  return result;
}

export async function addDataAction(
  studyId: string,
  input: { fileId: string; fileName?: string; replaces?: string; reason?: string },
): Promise<ActionResult<AddResult>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  return act(studyId, async () =>
    addDataFile(db, blobStore, actor, studyId, input, await getRequestInfo()),
  );
}

export async function matchAction(
  studyId: string,
  channelId: string,
  input: { positionId: string | null; ignored: boolean },
) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () =>
    setChannelMatch(db, actor, studyId, channelId, input, await getRequestInfo()),
  );
}

export async function acceptAction(studyId: string, fingerprint: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () =>
    acceptIssue(db, actor, studyId, fingerprint, reason, await getRequestInfo()),
  );
}

export async function withdrawAction(studyId: string, acceptanceId: string) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () =>
    withdrawAcceptance(db, actor, studyId, acceptanceId, await getRequestInfo()),
  );
}

export async function requestDataAction(studyId: string, note: string) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () => requestData(db, actor, studyId, note, await getRequestInfo()));
}

export async function closeRequestAction(studyId: string, requestId: string, note: string) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () =>
    closeRequest(db, actor, studyId, requestId, note, await getRequestInfo()),
  );
}

export async function receivedAction(studyId: string) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () => markReceived(db, actor, studyId, await getRequestInfo()));
}

export async function removeFileAction(studyId: string, dataFileId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () =>
    removeDataFile(db, actor, studyId, dataFileId, reason, await getRequestInfo()),
  );
}

export async function studyPeriodAction(
  studyId: string,
  input: { cycle: string; start: string; end: string; reason: string },
) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  return act(studyId, async () =>
    setStudyPeriod(db, actor, studyId, input, await getRequestInfo()),
  );
}
