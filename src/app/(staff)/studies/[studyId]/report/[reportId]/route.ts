import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { ReportsError } from "@/domain/reports/errors";
import { frozenReport, previewReport } from "@/domain/reports/report-service";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /studies/:id/report/:reportId — a frozen revision exactly as frozen (with
 * its SHA-256 in a header), or a draft rendered now and marked DRAFT.
 * `?download=1` saves it instead of showing it.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/studies/[studyId]/report/[reportId]">,
): Promise<Response> {
  const user = await userForRoute("jobs.view");
  if (user instanceof Response) return user;
  const { studyId, reportId } = await params;
  if (!UUID.test(studyId) || !UUID.test(reportId))
    return new Response("Not found.", { status: 404 });
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const headers = (name: string, extra: Record<string, string> = {}) => {
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    };
  };
  const frozen = await frozenReport(db, blobStore, user, reportId);
  if (frozen) {
    return new Response(new Uint8Array(frozen.bytes), {
      headers: headers(frozen.fileName, { "X-Content-SHA256": frozen.sha256 }),
    });
  }
  try {
    const draft = await previewReport(db, blobStore, user, reportId);
    if (!draft) return new Response("Not found.", { status: 404 });
    return new Response(new Uint8Array(draft.bytes), {
      headers: headers(
        `${draft.data.reportNumber} ${draft.data.revision} DRAFT.pdf`.replace(
          /[\\/:*?"<>|]+/g,
          "-",
        ),
      ),
    });
  } catch (error) {
    if (error instanceof ReportsError) return new Response(error.message, { status: 409 });
    throw error;
  }
}
