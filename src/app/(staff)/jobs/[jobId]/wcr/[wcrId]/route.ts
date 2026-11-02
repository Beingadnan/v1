import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { wcrDownload } from "@/domain/billing/wcr-service";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

/**
 * GET /jobs/:id/wcr/:wcrId — the job's WCR: with the client's acceptance
 * stamped in once accepted in the app, otherwise as issued. `?copy=frozen`
 * gives the issued PDF byte for byte, `?copy=scan` the signed paper.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/jobs/[jobId]/wcr/[wcrId]">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { wcrId } = await params;
  const copy = request.nextUrl.searchParams.get("copy");
  const kind = copy === "frozen" || copy === "scan" ? copy : "copy";
  const got = await wcrDownload(db, blobStore, user, wcrId, kind);
  if (!got) return new Response("Not found.", { status: 404 });
  return pdfResponse(got, request.nextUrl.searchParams.get("download") ? "attachment" : "inline");
}

function pdfResponse(
  got: { bytes: Uint8Array; sha256: string | null; mime: string; fileName: string },
  disposition: string,
) {
  const ascii = got.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(got.bytes), {
    headers: {
      "Content-Type": got.mime,
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(got.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(got.sha256 ? { "X-Content-SHA256": got.sha256 } : {}),
    },
  });
}
