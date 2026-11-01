import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { organisationSettings, storedFiles } from "@/db/schema";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

/** GET /settings/letterhead — the letterhead image, for the Settings page. */
export async function GET(): Promise<Response> {
  const user = await userForRoute("settings.view");
  if (user instanceof Response) return user;
  const [row] = await db
    .select({ key: storedFiles.storageKey, mime: storedFiles.mimeType })
    .from(organisationSettings)
    .innerJoin(storedFiles, eq(storedFiles.id, organisationSettings.letterheadFileId))
    .where(
      and(
        eq(organisationSettings.organisationId, user.organisationId),
        eq(storedFiles.organisationId, user.organisationId),
      ),
    );
  if (!row) return new Response("No letterhead.", { status: 404 });
  const bytes = await blobStore.get(row.key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
