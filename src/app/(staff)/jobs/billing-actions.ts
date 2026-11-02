"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  cancelInvoice,
  closeJob,
  recordInvoice,
  recordPayment,
  reopenJob,
  reversePayment,
} from "@/domain/billing/billing-service";
import { issueWcr, recordWcrPaper, voidWcr } from "@/domain/billing/wcr-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/** Server actions for the job's "Close and money" panel (phase 10). */

const signedOut = { ok: false as const, error: SESSION_ENDED };
const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/billing");
  revalidatePath("/client");
}

async function act<T>(jobId: string, fn: () => Promise<T>, message?: string) {
  const result = await runAction(fn, message);
  if (result.ok) refresh(jobId);
  return result;
}

export async function issueWcrAction(jobId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(jobId, async () => issueWcr(db, blobStore, actor, jobId, await getRequestInfo()));
}

export async function voidWcrAction(jobId: string, wcrId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(jobId, async () => voidWcr(db, actor, wcrId, reason, await getRequestInfo()));
}

export async function wcrPaperAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<void>> {
  const actor = await userForAction();
  if (!actor) return signedOut;
  const jobId = field(formData, "jobId");
  return act(
    jobId,
    async () =>
      recordWcrPaper(
        db,
        actor,
        field(formData, "wcrId"),
        {
          fileId: field(formData, "fileId"),
          signedByName: field(formData, "signedByName"),
          signedOn: field(formData, "signedOn"),
        },
        await getRequestInfo(),
      ),
    "WCR recorded as signed on paper.",
  );
}

export async function recordInvoiceAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await userForAction();
  if (!actor) return signedOut;
  const jobId = field(formData, "jobId");
  return act(
    jobId,
    async () =>
      recordInvoice(
        db,
        actor,
        jobId,
        {
          number: field(formData, "number"),
          invoiceDate: field(formData, "invoiceDate"),
          taxable: field(formData, "taxable"),
          gst: field(formData, "gst"),
          note: field(formData, "note"),
        },
        await getRequestInfo(),
      ),
    "Invoice recorded.",
  );
}

export async function cancelInvoiceAction(jobId: string, invoiceId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(jobId, async () =>
    cancelInvoice(db, actor, invoiceId, reason, await getRequestInfo()),
  );
}

export async function recordPaymentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; left: number }>> {
  const actor = await userForAction();
  if (!actor) return signedOut;
  const jobId = field(formData, "jobId");
  const num = (n: string) => field(formData, n) || "0";
  return act(jobId, async () =>
    recordPayment(
      db,
      actor,
      field(formData, "invoiceId"),
      {
        paidOn: field(formData, "paidOn"),
        received: num("received"),
        tds: num("tds"),
        writtenOff: num("writtenOff"),
        mode: field(formData, "mode"),
        reference: field(formData, "reference"),
        note: field(formData, "note"),
      },
      await getRequestInfo(),
    ),
  );
}

export async function reversePaymentAction(jobId: string, paymentId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(jobId, async () =>
    reversePayment(db, actor, paymentId, reason, await getRequestInfo()),
  );
}

export async function closeJobAction(jobId: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(jobId, async () => closeJob(db, actor, jobId, await getRequestInfo()));
}

export async function reopenJobAction(jobId: string, reason: string) {
  const actor = await userForAction();
  if (!actor) return signedOut;
  return act(jobId, async () => reopenJob(db, actor, jobId, reason, await getRequestInfo()));
}
