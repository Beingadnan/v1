"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db/client";
import {
  applyImport,
  previewImport,
  type ImportPreview,
} from "@/domain/clients/import/import-service";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/dal";
import { getRequestInfo } from "@/lib/request-info";
import { blobStore } from "@/lib/storage";

/** Reads an uploaded workbook (already stored via /api/files) and reports what would change. */
export async function previewImportAction(fileId: string): Promise<ActionResult<ImportPreview>> {
  const actor = await requireUser();
  return runAction(() => previewImport(db, blobStore, actor, String(fileId)));
}

export async function applyImportAction(fileId: string): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () =>
    applyImport(db, blobStore, actor, String(fileId), await getRequestInfo()),
  );
  if (!result.ok) return result;
  revalidatePath("/clients");
  const c = result.data;
  return {
    ok: true,
    data: undefined,
    message: `Imported: ${c.companies.create} new clients, ${c.sites.create} new sites, ${c.departments.create} new departments, ${c.equipment.create} new and ${c.equipment.update} updated equipment.`,
  };
}
