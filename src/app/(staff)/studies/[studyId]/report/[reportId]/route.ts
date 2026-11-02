import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { ReportsError } from "@/domain/reports/errors";
import { previewReport } from "@/domain/reports/report-service";
import { reportDownload } from "@/domain/reports/review-service";
import { userForRoute } from "@/lib/auth/route-auth";
import { blobStore } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /studies/:id/report/:reportId — a frozen revision with its signatures
 * stamped in (the issued copy once the client signed), or a draft rendered
 * now and marked DRAFT. `?copy=frozen` gives the frozen PDF byte for byte
 * (its SHA-256 in a header), `?copy=scan` the client's signed paper.
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
  const copy = request.nextUrl.searchParams.get("copy");
  const kind = copy === "frozen" || copy === "scan" ? copy : "signed";
  const got = await reportDownload(db, blobStore, user, reportId, kind);
  if (got) {
    return new Response(new Uint8Array(got.bytes), {
      headers: {
        ...headers(got.fileName, got.sha256 ? { "X-Content-SHA256": got.sha256 } : {}),
        "Content-Type": got.mime,
      },
    });
  }
  if (kind !== "signed") return new Response("Not found.", { status: 404 });
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
