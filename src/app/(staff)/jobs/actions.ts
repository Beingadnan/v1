"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  addStudies,
  autoBook,
  bookByCodes,
  changeStatus,
  createJob,
  releaseInstruments,
  recordGatePass,
  recordOrder,
  removeStudy,
  setReadiness,
  setTeam,
  updateJob,
  updateStudy,
  type AutoBookResult,
  type ManualBookResult,
} from "@/domain/jobs/job-service";
import { saveContract } from "@/domain/jobs/contract-service";
import { siteEquipment, type SiteEquipment } from "@/domain/jobs/queries";
import type { Transition } from "@/domain/jobs/types";
import { runAction, type ActionResult } from "@/lib/action-result";
import { SESSION_ENDED, userForAction } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";

/**
 * Server actions for the Jobs screens. Each re-checks the session (and says
 * so plainly when it has ended) and hands raw strings to a domain service,
 * which validates them and checks the person's permission.
 */

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const all = (formData: FormData, name: string) =>
  formData.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");

const HEADER_FIELDS = [
  "siteId",
  "title",
  "orderType",
  "contractId",
  "poNumber",
  "poDate",
  "poValue",
  "plannedStart",
  "plannedEnd",
  "notes",
] as const;
const header = (formData: FormData) =>
  Object.fromEntries(
    HEADER_FIELDS.filter((n) => formData.has(n)).map((n) => [n, field(formData, n)]),
  );

/** Team pickers send `team` = userId and `role-<userId>` = role. */
function team(formData: FormData) {
  return all(formData, "team").map((userId) => ({
    userId,
    role: field(formData, `role-${userId}`) || "field_engineer",
  }));
}

function refresh(jobId?: string) {
  revalidatePath("/jobs");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function createJobAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string; number: string }>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const result = await runAction(async () =>
    createJob(
      db,
      actor,
      {
        companyId: field(formData, "companyId"),
        clientSiteId: field(formData, "clientSiteId"),
        ...header(formData),
        team: team(formData),
        items: all(formData, "equipment").map((equipmentId) =>
          // The pre/post-cal choice, when the form showed it; else the client's SOP decides.
          formData.has(`cal-${equipmentId}`)
            ? {
                equipmentId,
                preCal: formData.get(`precal-${equipmentId}`) === "on",
                postCal: formData.get(`postcal-${equipmentId}`) === "on",
              }
            : { equipmentId },
        ),
      },
      await getRequestInfo(),
    ),
  );
  if (result.ok) {
    refresh();
    return { ...result, message: `Job ${result.data.number} created.` };
  }
  return result;
}

export async function siteEquipmentAction(
  clientSiteId: string,
): Promise<ActionResult<SiteEquipment[]>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  return runAction(() => siteEquipment(db, actor, clientSiteId));
}

export async function updateJobAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () => updateJob(db, actor, jobId, header(formData), await getRequestInfo()),
    "Job saved.",
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function changeStatusAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(async () => {
    await changeStatus(
      db,
      actor,
      jobId,
      field(formData, "transition") as Transition,
      field(formData, "reason"),
      await getRequestInfo(),
    );
  }, "Status changed.");
  refresh(jobId);
  return result;
}

export async function setReadinessAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(async () =>
    setReadiness(
      db,
      actor,
      jobId,
      {
        key: field(formData, "key"),
        state: field(formData, "state"),
        note: field(formData, "note"),
      },
      await getRequestInfo(),
    ),
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function setTeamAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () => setTeam(db, actor, jobId, team(formData), await getRequestInfo()),
    "Team saved.",
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function addStudiesAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () => addStudies(db, actor, jobId, all(formData, "equipment"), await getRequestInfo()),
    "Added.",
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function updateStudyAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () =>
      updateStudy(
        db,
        actor,
        field(formData, "studyId"),
        {
          workType: field(formData, "workType"),
          loggerCount: field(formData, "loggerCount"),
          cycles: all(formData, "cycles"),
          season: field(formData, "season"),
          durationHours: field(formData, "durationHours"),
          intervalMinutes: field(formData, "intervalMinutes"),
          preCalRequired: field(formData, "preCalRequired"),
          postCalRequired: field(formData, "postCalRequired"),
        },
        await getRequestInfo(),
      ),
    "Study saved.",
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function removeStudyAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () => removeStudy(db, actor, field(formData, "studyId"), await getRequestInfo()),
    "Removed.",
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function autoBookAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<AutoBookResult>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(async () => autoBook(db, actor, jobId, await getRequestInfo()));
  if (result.ok) refresh(jobId);
  return result;
}

export async function bookByCodesAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ManualBookResult>> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(async () =>
    bookByCodes(
      db,
      actor,
      jobId,
      field(formData, "codes"),
      await getRequestInfo(),
      field(formData, "model") || undefined,
    ),
  );
  if (result.ok) refresh(jobId);
  return result;
}

export async function releaseAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(async () => {
    await releaseInstruments(
      db,
      actor,
      jobId,
      all(formData, "instrumentId"),
      await getRequestInfo(),
    );
  }, "Released.");
  if (result.ok) refresh(jobId);
  return result;
}

/** The client's order, recorded when it comes (number, value, copy, or the contract). */
export async function recordOrderAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () =>
      recordOrder(
        db,
        actor,
        jobId,
        {
          orderType: field(formData, "orderType"),
          contractId: field(formData, "contractId"),
          poNumber: field(formData, "poNumber"),
          poDate: field(formData, "poDate"),
          poValue: field(formData, "poValue"),
          fileId: field(formData, "fileId"),
        },
        await getRequestInfo(),
      ),
    "Order recorded.",
  );
  if (result.ok) refresh(jobId);
  return result;
}

/** A client's ARC or AMC, added or changed. */
export async function saveContractAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const companyId = field(formData, "companyId");
  const result = await runAction(async () => {
    await saveContract(
      db,
      actor,
      companyId,
      {
        kind: field(formData, "kind"),
        number: field(formData, "number"),
        validFrom: field(formData, "validFrom"),
        validTo: field(formData, "validTo"),
        value: field(formData, "value"),
        fileId: field(formData, "fileId"),
        notes: field(formData, "notes"),
      },
      field(formData, "contractId") || null,
      await getRequestInfo(),
    );
  }, "Contract saved.");
  if (result.ok) {
    revalidatePath(`/clients/${companyId}`);
    revalidatePath("/jobs/new");
  }
  return result;
}

/** The client's gate pass: its number and scan, or not needed at this site. */
export async function recordGatePassAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await userForAction();
  if (!actor) return { ok: false, error: SESSION_ENDED };
  const jobId = field(formData, "jobId");
  const result = await runAction(
    async () =>
      recordGatePass(
        db,
        actor,
        jobId,
        {
          number: field(formData, "number"),
          notNeeded: field(formData, "notNeeded"),
          fileId: field(formData, "fileId"),
        },
        await getRequestInfo(),
      ),
    "Gate pass saved.",
  );
  if (result.ok) refresh(jobId);
  return result;
}
