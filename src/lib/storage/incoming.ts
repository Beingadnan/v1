import "server-only";

import { BlobNotFoundError, del, get, head, list } from "@vercel/blob";

/**
 * Large uploads on Vercel (whose functions take at most 4.5 MB per request) go from
 * the browser straight into the Blob store under `incoming/<user id>/<random id>`,
 * private. The app then reads each one back, checks and stores it like any other
 * upload (content-addressed, ADR 0004) and deletes the incoming copy. Nothing is
 * trusted until that second step: an incoming blob is just bytes waiting to be checked.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function incomingPrefix(userId: string): string {
  return `incoming/${userId}/`;
}

/** Only a path this user was allowed to upload to: their own folder, one random name. */
export function isOwnIncoming(pathname: unknown, userId: string): pathname is string {
  return (
    typeof pathname === "string" &&
    new RegExp(`^incoming/${UUID}/${UUID}$`).test(pathname) &&
    pathname.startsWith(incomingPrefix(userId))
  );
}

/** The bytes of an incoming upload, then the incoming copy is deleted whatever happens. */
export async function takeIncoming(
  token: string,
  pathname: string,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "missing" | "too_large" }> {
  try {
    const meta = await head(pathname, { token });
    if (meta.size > maxBytes) return { ok: false, reason: "too_large" };
    const blob = await get(pathname, { access: "private", token });
    if (!blob || blob.statusCode !== 200) return { ok: false, reason: "missing" };
    return { ok: true, bytes: new Uint8Array(await new Response(blob.stream).arrayBuffer()) };
  } catch (error) {
    if (error instanceof BlobNotFoundError) return { ok: false, reason: "missing" };
    throw error;
  } finally {
    await del(pathname, { token }).catch((error: unknown) =>
      console.error(
        JSON.stringify({ level: "warn", msg: "incoming upload not deleted", error: String(error) }),
      ),
    );
  }
}

/** Removes incoming uploads nobody finished (browser closed mid-way); run daily. */
export async function sweepIncoming(token: string, olderThanMs = 24 * 3_600_000) {
  const cutoff = Date.now() - olderThanMs;
  let cursor: string | undefined;
  let removed = 0;
  do {
    const page = await list({ prefix: "incoming/", cursor, limit: 1000, token });
    const old = page.blobs.filter((b) => b.uploadedAt.getTime() < cutoff).map((b) => b.pathname);
    if (old.length) {
      await del(old, { token });
      removed += old.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return removed;
}
