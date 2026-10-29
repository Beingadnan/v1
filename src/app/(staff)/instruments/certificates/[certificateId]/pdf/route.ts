import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { certificatePdf } from "@/domain/instruments/pdf-service";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

/** GET /instruments/certificates/:id/pdf — the certificate PDF, shown in the browser. */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/instruments/certificates/[certificateId]/pdf">,
): Promise<Response> {
  const user = await userForRoute("instruments.view");
  if (user instanceof Response) return user;
  const { certificateId } = await params;
  const pdf = await certificatePdf(db, blobStore, user, certificateId);
  if (!pdf) return new Response("No PDF for this certificate.", { status: 404 });
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
