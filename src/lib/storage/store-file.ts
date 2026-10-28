import "server-only";

import { and, eq } from "drizzle-orm";

import type { Database } from "@/db/client-factory";
import { storedFiles, type StoredFile } from "@/db/schema";
import { recordAudit, type AuditEvent } from "@/lib/audit";

import { sha256Hex, type BlobStore } from "./blob-store";
import { ALLOWED_FILE_TYPES, checkFileType } from "./file-type";

export type StoreFileInput = {
  organisationId: string;
  actor: AuditEvent["actor"];
  fileName: string;
  bytes: Uint8Array;
  maxBytes: number;
  request?: AuditEvent["request"];
};

export type StoreFileResult =
  | { ok: true; file: StoredFile; reused: boolean }
  | { ok: false; reason: "empty" | "too_large" | "bad_type" | "bad_name"; message: string };

const MAX_NAME_LENGTH = 255;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Keep the visible name readable but harmless: no paths, control characters or huge strings. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(CONTROL_CHARACTERS, "").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Validate, store and register a file, and audit it.
 *
 * Order matters: bytes are written to blob storage before the database row
 * commits, so a row never points at a missing file. If the database step
 * fails, the stored bytes are an unreferenced duplicate-safe blob, not a
 * broken record.
 */
export async function storeFile(
  db: Database,
  blobs: BlobStore,
  input: StoreFileInput,
): Promise<StoreFileResult> {
  const fileName = cleanFileName(input.fileName);
  if (!fileName) return { ok: false, reason: "bad_name", message: "The file has no name." };
  if (input.bytes.byteLength === 0) {
    return { ok: false, reason: "empty", message: `${fileName} is empty. Export it again.` };
  }
  if (input.bytes.byteLength > input.maxBytes) {
    const mb = Math.round(input.maxBytes / 1024 / 1024);
    return {
      ok: false,
      reason: "too_large",
      message: `${fileName} is larger than ${mb} MB.`,
    };
  }
  const typeCheck = checkFileType(fileName, input.bytes);
  if (!typeCheck.ok) return { ok: false, reason: "bad_type", message: typeCheck.message };

  const sha256 = sha256Hex(input.bytes);
  const { key } = await blobs.put(sha256, input.bytes);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(storedFiles)
      .values({
        organisationId: input.organisationId,
        sha256,
        sizeBytes: input.bytes.byteLength,
        fileType: typeCheck.type,
        mimeType: ALLOWED_FILE_TYPES[typeCheck.type].mime,
        storageKey: key,
        firstFileName: fileName,
        createdByUserId: input.actor.type === "user" ? input.actor.userId : null,
      })
      .onConflictDoNothing({ target: [storedFiles.organisationId, storedFiles.sha256] })
      .returning();

    const file =
      inserted ??
      (
        await tx
          .select()
          .from(storedFiles)
          .where(
            and(
              eq(storedFiles.organisationId, input.organisationId),
              eq(storedFiles.sha256, sha256),
            ),
          )
      )[0];
    if (!file) throw new Error("Stored file row missing after conflict");

    const reused = !inserted;
    await recordAudit(tx, {
      organisationId: input.organisationId,
      actor: input.actor,
      action: reused ? "file.reused" : "file.stored",
      entityType: "stored_file",
      entityId: file.id,
      summary: reused
        ? `Received ${fileName}; identical content already stored (SHA-256 ${sha256.slice(0, 12)}…)`
        : `Stored ${fileName} (${typeCheck.type.toUpperCase()}, ${input.bytes.byteLength} bytes)`,
      after: { fileName, sha256, sizeBytes: input.bytes.byteLength, fileType: typeCheck.type },
      request: input.request,
    });

    return { ok: true as const, file, reused };
  });
}
