"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import { clientDecideDeviation } from "@/domain/analysis/analysis-service";
import { acceptWcr } from "@/domain/billing/wcr-service";
import { ReportsError } from "@/domain/reports/errors";
import { clientApprove, clientReturn } from "@/domain/reports/review-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { flushEmails } from "@/lib/mail/flush";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/** Server actions for the client's review of a released report (phase 9). */

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function refresh(reportId: string) {
  flushEmails();
  revalidatePath("/client");
  revalidatePath(`/client/reports/${reportId}`);
  revalidatePath("/reports");
}

/** The client's one signature (its authorised signatory), from the password dialog. */
export async function clientSignAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ text: string }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const reportId = field(formData, "reportId");
  const step = field(formData, "step");
  const password = field(formData, "password");
  const result = await runAction(async () => {
    const request = await getRequestInfo();
    if (step === "approved_by") {
      const r = await clientApprove(db, blobStore, actor, reportId, { password }, request);
      if (!r.ok) throw new ReportsError(r.message);
      return { text: "Signed. The report is issued and kept in your archive." };
    }
    throw new ReportsError("Unknown step.");
  });
  if (result.ok) refresh(reportId);
  return result;
}

export async function clientReturnAction(
  reportId: string,
  comments: { section: string; page: number | null; body: string }[],
) {
  const actor = await userForAction();
  if (!actor) return { ok: false as const, error: SESSION_ENDED };
  const result = await runAction(async () =>
    clientReturn(db, actor, reportId, { comments }, await getRequestInfo()),
  );
  if (result.ok) refresh(reportId);
  return result;
}

/** The client QA head's signed decision on a deviation. */
export async function clientDecideAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ text: string }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const id = field(formData, "deviationId");
  const result = await runAction(async () => {
    const r = await clientDecideDeviation(
      db,
      actor,
      id,
      { decision: field(formData, "decision"), note: field(formData, "note") },
      field(formData, "password"),
      await getRequestInfo(),
    );
    if (!r.ok) throw new ReportsError(r.message);
    return { text: "Decision signed. The deviation is closed and QA Tech can finish the report." };
  });
  if (result.ok) {
    revalidatePath("/client");
    revalidatePath(`/client/deviations/${id}`);
  }
  return result;
}

/** The client QA head accepts a work completion report (phase 10). */
export async function clientAcceptWcrAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ text: string }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const id = field(formData, "wcrId");
  const result = await runAction(async () => {
    const r = await acceptWcr(db, actor, id, field(formData, "password"), await getRequestInfo());
    if (!r.ok) throw new ReportsError(r.message);
    return { text: "Accepted. QA Tech has been told the work is complete." };
  });
  if (result.ok) {
    revalidatePath("/client");
    revalidatePath(`/client/wcr/${id}`);
    revalidatePath("/billing");
  }
  return result;
}
