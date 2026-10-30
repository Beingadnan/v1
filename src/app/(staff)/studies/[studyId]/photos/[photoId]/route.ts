import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { storedFiles, studyPhotos } from "@/db/schema";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /studies/:id/photos/:photoId — one placement photo, for the signed-in team. */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/studies/[studyId]/photos/[photoId]">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { studyId, photoId } = await params;
  if (!UUID.test(studyId) || !UUID.test(photoId))
    return new Response("Not found.", { status: 404 });
  const [row] = await db
    .select({ key: storedFiles.storageKey, mime: storedFiles.mimeType })
    .from(studyPhotos)
    .innerJoin(storedFiles, eq(storedFiles.id, studyPhotos.fileId))
    .where(
      and(
        eq(studyPhotos.id, photoId),
        eq(studyPhotos.studyId, studyId),
        eq(studyPhotos.organisationId, user.organisationId),
      ),
    );
  if (!row) return new Response("Not found.", { status: 404 });
  const bytes = await blobStore.get(row.key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
