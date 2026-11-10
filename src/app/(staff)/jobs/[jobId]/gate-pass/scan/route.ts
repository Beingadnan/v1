import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { userForRoute } from "@/lib/auth/route-auth";
import { serveStoredFile } from "@/lib/storage/serve-file";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /jobs/:id/gate-pass/scan — the scan of the client's gate pass. */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/jobs/[jobId]/gate-pass/scan">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { jobId } = await params;
  if (!UUID.test(jobId)) return new Response("Not found.", { status: 404 });
  const [row] = await db
    .select({ fileId: jobs.gatePassFileId })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organisationId, user.organisationId)));
  return serveStoredFile(user.organisationId, row?.fileId);
}
