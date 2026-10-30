"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  attachPhoto,
  layoutTemplate,
  placeLogger,
  recordEvent,
  recordPrecal,
  removeLogger,
  saveLayout,
  setRoomSize,
  voidEvent,
  type PlaceResult,
} from "@/domain/field/field-service";
import type { LayoutPoint } from "@/domain/field/layout";
import type { StudyStatus } from "@/domain/field/types";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";

/**
 * Server actions for field work. They take plain objects (not forms) because
 * the phone screens also replay them from the offline outbox.
 */

function refresh(studyId: string) {
  revalidatePath(`/studies/${studyId}`);
  revalidatePath("/studies");
}

export async function templateAction(studyId: string): Promise<ActionResult<LayoutPoint[]>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  return runAction(() => layoutTemplate(db, actor, studyId));
}

export async function saveLayoutAction(
  studyId: string,
  points: unknown,
): Promise<ActionResult<{ count: number }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(
    async () => saveLayout(db, actor, studyId, points, await getRequestInfo()),
    "Layout saved.",
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function roomSizeAction(
  studyId: string,
  text: string,
): Promise<ActionResult<{ lengthM: number; widthM: number; heightM: number }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(
    async () => setRoomSize(db, actor, studyId, text, await getRequestInfo()),
    "Size saved.",
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function placeAction(
  studyId: string,
  input: { code: string; positionId?: string },
): Promise<ActionResult<PlaceResult>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    placeLogger(db, actor, studyId, input, await getRequestInfo()),
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function removeLoggerAction(
  studyId: string,
  positionId: string,
): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    removeLogger(db, actor, positionId, await getRequestInfo()),
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function eventAction(
  studyId: string,
  input: { id: string; cycle: string; kind: string; at: string; note?: string },
): Promise<ActionResult<{ status: StudyStatus; duplicate: boolean }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    recordEvent(db, actor, studyId, input, await getRequestInfo()),
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function voidEventAction(
  studyId: string,
  eventId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    voidEvent(db, actor, eventId, reason, await getRequestInfo()),
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function precalAction(
  studyId: string,
  input: {
    id: string;
    code: string;
    masterId: string;
    quantity: string;
    reference: string;
    reading: string;
  },
): Promise<
  ActionResult<{ code: string; result: "pass" | "fail"; deviation: string; tolerance: number }>
> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    recordPrecal(db, actor, studyId, input, await getRequestInfo()),
  );
  if (result.ok) refresh(studyId);
  return result;
}

export async function attachPhotoAction(
  studyId: string,
  input: { id: string; fileId: string; positionLabel?: string; caption?: string },
): Promise<ActionResult<{ id: string }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    attachPhoto(db, actor, studyId, input, await getRequestInfo()),
  );
  if (result.ok) refresh(studyId);
  return result;
}
