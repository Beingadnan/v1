import "server-only";

import { db } from "@/db/client";
import { can, type Action } from "@/domain/auth/permissions";
import { validateSession, type SessionUser } from "@/domain/auth/session-service";

import { readSessionCookie } from "./session-cookie";
import { streamBytes } from "@/lib/storage/stream";

/**
 * For route handlers (file downloads): the signed-in user if they may do
 * `action`, otherwise a plain-text Response to return as is.
 */
export async function userForRoute(action: Action): Promise<SessionUser | Response> {
  const session = await validateSession(db, await readSessionCookie());
  if (!session) return new Response("Sign in again.", { status: 401 });
  if (!can(session.user, action)) {
    return new Response("Your role doesn't allow this.", { status: 403 });
  }
  return session.user;
}

/** An Excel download that browsers save under `fileName` and never cache. */
export function excelResponse(bytes: Uint8Array, fileName: string): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(streamBytes(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
