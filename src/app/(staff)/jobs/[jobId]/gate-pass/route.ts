import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { gatePassList } from "@/domain/jobs/queries";
import { userForRoute } from "@/lib/auth/route-auth";

/** GET /jobs/:id/gate-pass — the PDF list of booked instruments for the client's security. */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/jobs/[jobId]/gate-pass">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { jobId } = await params;
  const out = await gatePassList(db, user, jobId);
  if (!out) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(out.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${out.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
