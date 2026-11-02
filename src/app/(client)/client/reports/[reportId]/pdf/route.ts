import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { validateSession } from "@/domain/auth/session-service";
import { reportDownload } from "@/domain/reports/review-service";
import { readSessionCookie } from "@/lib/auth/session-cookie";
import { blobStore } from "@/lib/storage";

/**
 * GET /client/reports/:id/pdf — a released revision for the client: the
 * issued copy once signed, otherwise the frozen PDF with the signatures so
 * far stamped in. `?copy=frozen` gives the frozen PDF byte for byte.
 * Only the client's own company's released revisions are served.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/client/reports/[reportId]/pdf">,
): Promise<Response> {
  const session = await validateSession(db, await readSessionCookie());
  if (!session) return new Response("Sign in again.", { status: 401 });
  const { reportId } = await params;
  const copy = request.nextUrl.searchParams.get("copy") === "frozen" ? "frozen" : "signed";
  const got = await reportDownload(db, blobStore, session.user, reportId, copy);
  if (!got) return new Response("Not found.", { status: 404 });
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const ascii = got.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(got.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(got.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(got.sha256 ? { "X-Content-SHA256": got.sha256 } : {}),
    },
  });
}
