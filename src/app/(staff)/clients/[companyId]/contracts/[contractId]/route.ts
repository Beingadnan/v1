import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { clientContracts } from "@/db/schema";
import { userForRoute } from "@/lib/auth/route-auth";
import { serveStoredFile } from "@/lib/storage/serve-file";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /clients/:id/contracts/:contractId — the copy of the client's ARC or AMC. */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/clients/[companyId]/contracts/[contractId]">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { companyId, contractId } = await params;
  if (!UUID.test(companyId) || !UUID.test(contractId))
    return new Response("Not found.", { status: 404 });
  const [row] = await db
    .select({ fileId: clientContracts.fileId })
    .from(clientContracts)
    .where(
      and(
        eq(clientContracts.id, contractId),
        eq(clientContracts.companyId, companyId),
        eq(clientContracts.organisationId, user.organisationId),
      ),
    );
  return serveStoredFile(user.organisationId, row?.fileId);
}
