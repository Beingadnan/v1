import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { ft12Pdf } from "@/domain/field/queries";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

/** GET /studies/:id/ft12 — the sensor location sheet (FT-12), shown in the browser. */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/studies/[studyId]/ft12">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { studyId } = await params;
  const pdf = await ft12Pdf(db, blobStore, user, studyId);
  if (!pdf) return new Response("No such study.", { status: 404 });
  const ascii = pdf.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
