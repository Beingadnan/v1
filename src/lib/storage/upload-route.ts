import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { validateSession, type SessionUser } from "@/domain/auth/session-service";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { env } from "@/lib/env";
import { requestInfoFromHeaders } from "@/lib/request-info";

import { blobStore, uploadMaxBytes } from ".";
import { storeFile } from "./store-file";

/**
 * The checks every upload route makes, in order: same-origin request (CSRF), valid
 * session, files.upload permission. Returns the user, or the response to send.
 */
export async function uploader(request: NextRequest): Promise<SessionUser | NextResponse> {
  // Browsers always send Origin on cross-site POSTs; reject anything not from this app.
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(env.APP_URL).origin, request.nextUrl.origin]);
  if (request.method !== "GET" && (!origin || !allowed.has(origin))) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const session = await validateSession(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!can(session.user, "files.upload")) {
    return NextResponse.json({ error: "Your role doesn't allow uploads." }, { status: 403 });
  }
  return session.user;
}

/** Checks, stores and registers the bytes, and answers as POST /api/files always has. */
export async function storeAndRespond(
  request: NextRequest,
  user: SessionUser,
  fileName: string,
  bytes: Uint8Array,
): Promise<NextResponse> {
  const result = await storeFile(db, blobStore, {
    organisationId: user.organisationId,
    actor: { type: "user", userId: user.id },
    fileName,
    bytes,
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

export const tooLarge = () =>
  NextResponse.json({ error: `Files can be at most ${env.UPLOAD_MAX_MB} MB.` }, { status: 413 });
