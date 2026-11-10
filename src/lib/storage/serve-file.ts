import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { storedFiles } from "@/db/schema";

import { blobStore } from ".";

/**
 * A stored file as a download, shown in the browser where it can be (PDFs,
 * images). Only a file of the organisation; anything else is "Not found".
 */
export async function serveStoredFile(
  organisationId: string,
  fileId: string | null | undefined,
): Promise<Response> {
  if (!fileId) return new Response("Not found.", { status: 404 });
  const [row] = await db
    .select({
      key: storedFiles.storageKey,
      mime: storedFiles.mimeType,
      name: storedFiles.firstFileName,
      sha256: storedFiles.sha256,
    })
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.organisationId, organisationId)));
  if (!row) return new Response("Not found.", { status: 404 });
  const bytes = await blobStore.get(row.key);
  const safe = row.name.replace(/[^\w .()-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "X-Content-SHA256": row.sha256,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
