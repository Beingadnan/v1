import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { storedFiles, studyDataFiles } from "@/db/schema";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /studies/:id/data/:fileId — the logger file exactly as uploaded (replaced ones too). */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/studies/[studyId]/data/[dataFileId]">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { studyId, dataFileId } = await params;
  if (!UUID.test(studyId) || !UUID.test(dataFileId))
    return new Response("Not found.", { status: 404 });
  const [row] = await db
    .select({
      key: storedFiles.storageKey,
      mime: storedFiles.mimeType,
      name: studyDataFiles.fileName,
      sha256: storedFiles.sha256,
    })
    .from(studyDataFiles)
    .innerJoin(storedFiles, eq(storedFiles.id, studyDataFiles.fileId))
    .where(
      and(
        eq(studyDataFiles.id, dataFileId),
        eq(studyDataFiles.studyId, studyId),
        eq(studyDataFiles.organisationId, user.organisationId),
      ),
    );
  if (!row) return new Response("Not found.", { status: 404 });
  const bytes = await blobStore.get(row.key);
  const safe = row.name.replace(/[^\w .()-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "X-Content-SHA256": row.sha256,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
