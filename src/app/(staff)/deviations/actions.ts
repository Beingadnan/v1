"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { completeCapa, createCapa, moveCapaDue, verifyCapa } from "@/domain/analysis/capa-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { flushEmails } from "@/lib/mail/flush";
import { getRequestInfo } from "@/lib/request-info";

const signedOut = { ok: false as const, error: SESSION_ENDED };
const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function act<T>(fn: () => Promise<T>, message?: string) {
  const result = await runAction(fn, message);
  if (result.ok) {
    revalidatePath("/deviations");
    revalidatePath("/");
    flushEmails();
  }
  return result;
}

export async function createCapaAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(
    async () =>
      createCapa(
        db,
        actor,
        field(formData, "deviationId"),
        {
          kind: field(formData, "kind"),
          rootCause: field(formData, "rootCause"),
          action: field(formData, "action"),
          ownerUserId: field(formData, "ownerUserId"),
          dueOn: field(formData, "dueOn"),
        },
        await getRequestInfo(),
      ),
    "CAPA raised. The owner has been told.",
  );
}

export async function completeCapaAction(capaId: string, note: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(async () => completeCapa(db, actor, capaId, note, await getRequestInfo()));
}

export async function verifyCapaAction(capaId: string, note: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(async () => verifyCapa(db, actor, capaId, note, await getRequestInfo()));
}

export async function moveCapaDueAction(capaId: string, dueOn: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(async () => moveCapaDue(db, actor, capaId, { dueOn, reason }, await getRequestInfo()));
}
