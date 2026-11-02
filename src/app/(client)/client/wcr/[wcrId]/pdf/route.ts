import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { validateSession } from "@/domain/auth/session-service";
import { wcrDownload } from "@/domain/billing/wcr-service";
import { readSessionCookie } from "@/lib/auth/session-cookie";
import { blobStore } from "@/lib/storage";

/** GET /client/wcr/:id/pdf — the client's own company's WCR, with its acceptance once accepted. */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/client/wcr/[wcrId]/pdf">,
): Promise<Response> {
  const session = await validateSession(db, await readSessionCookie());
  if (!session) return new Response("Sign in again.", { status: 401 });
  const { wcrId } = await params;
  const got = await wcrDownload(db, blobStore, session.user, wcrId, "copy");
  if (!got) return new Response("Not found.", { status: 404 });
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const ascii = got.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(got.bytes), {
    headers: {
      "Content-Type": got.mime,
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(got.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
