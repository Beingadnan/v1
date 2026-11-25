import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { uploadMaxBytes } from "@/lib/storage";
import { incomingPrefix, isOwnIncoming } from "@/lib/storage/incoming";
import { uploader } from "@/lib/storage/upload-route";

/**
 * Large uploads, browser straight to Vercel Blob (src/lib/storage/incoming.ts).
 *
 * GET  — whether direct uploads are on, and the folder this person may upload to.
 * POST — Vercel Blob's client-token request (from `upload()` in @vercel/blob/client):
 *        a short-lived token for one private file in that folder, no larger than the
 *        upload limit. Completion callbacks are not used; /api/files/register takes
 *        the file instead.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await uploader(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(
    { enabled: Boolean(env.BLOB_READ_WRITE_TOKEN), prefix: incomingPrefix(user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await uploader(request);
  if (user instanceof NextResponse) return user;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "Direct uploads are off." }, { status: 404 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (body?.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    const result = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        if (!isOwnIncoming(pathname, user.id)) throw new Error("Upload path refused.");
        return {
          // upload-client.ts always sends this; what the file really is gets checked on register.
          allowedContentTypes: ["application/octet-stream"],
          maximumSizeInBytes: uploadMaxBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 10 * 60_000,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload refused." },
      { status: 400 },
    );
  }
}
