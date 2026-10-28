import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { validateSession } from "@/domain/auth/session-service";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { env } from "@/lib/env";
import { requestInfoFromHeaders } from "@/lib/request-info";
import { blobStore, uploadMaxBytes } from "@/lib/storage";
import { storeFile } from "@/lib/storage/store-file";

/**
 * POST /api/files — upload one file (multipart field "file").
 * Returns the stored file's id and SHA-256. Used by upload screens from phase 3.
 *
 * Checks, in order: same-origin request (CSRF), valid session, files.upload
 * permission, size, then content type (inside storeFile).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Browsers always send Origin on cross-site POSTs; reject anything not from this app.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(env.APP_URL).origin) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  const session = await validateSession(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!can(session.user, "files.upload")) {
    return NextResponse.json({ error: "Your role doesn't allow uploads." }, { status: 403 });
  }

  // Refuse oversized bodies before reading them into memory.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > uploadMaxBytes + 64 * 1024) {
    return NextResponse.json(
      { error: `Files can be at most ${env.UPLOAD_MAX_MB} MB.` },
      { status: 413 },
    );
  }

  // Count bytes as they arrive, so a body without Content-Length still can't exceed the limit.
  const body = await readBodyWithLimit(request, uploadMaxBytes + 64 * 1024);
  if (body === "too_large") {
    return NextResponse.json(
      { error: `Files can be at most ${env.UPLOAD_MAX_MB} MB.` },
      { status: 413 },
    );
  }

  let file: FormDataEntryValue | null;
  try {
    const parsed = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body,
    });
    file = (await parsed.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Attach the file in a field named "file".' },
      { status: 400 },
    );
  }

  const result = await storeFile(db, blobStore, {
    organisationId: session.user.organisationId,
    actor: { type: "user", userId: session.user.id },
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    maxBytes: uploadMaxBytes,
    request: requestInfoFromHeaders(request.headers),
  });

  if (!result.ok) {
    const status = result.reason === "too_large" ? 413 : 422;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json(
    {
      id: result.file.id,
      sha256: result.file.sha256,
      fileType: result.file.fileType,
      sizeBytes: result.file.sizeBytes,
      reused: result.reused,
    },
    { status: result.reused ? 200 : 201 },
  );
}

async function readBodyWithLimit(request: NextRequest, limit: number): Promise<Blob | "too_large"> {
  if (!request.body) return new Blob([]);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]);
}
