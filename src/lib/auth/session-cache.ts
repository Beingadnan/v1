import "server-only";

import { createHash } from "node:crypto";

/**
 * A validated session is remembered for a few seconds in this server process
 * (ADR 0018). Every page and action checks the session first, and the
 * database is a quarter of a second away from Bhiwandi, so without this each
 * click waited for that check before anything else could start.
 *
 * Only valid sessions are remembered, and only for page loads: server actions
 * (every change of data) always check the database (src/lib/auth/dal.ts).
 * Signing out, a role change, deactivating a user and a password change forget
 * them all at once, so in this process they take effect on the next click;
 * another server process (if any) still shows pages for up to TTL_MS. The session's idle limit is minutes, so a few seconds of
 * memory never keeps a timed-out session alive in practice.
 */
export const TTL_MS = 15_000;
const MAX = 5_000;

type Entry<T> = { at: number; value: T };
const store = globalThis as unknown as { qtechSessions?: Map<string, Entry<unknown>> };
const sessions = (store.qtechSessions ??= new Map());

const keyOf = (token: string) => createHash("sha256").update(token).digest("base64url");

export async function rememberedSession<T>(
  token: string | undefined,
  load: () => Promise<T | null>,
  now = Date.now(),
): Promise<T | null> {
  if (!token) return load();
  const key = keyOf(token);
  const hit = sessions.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = await load();
  if (value === null) {
    sessions.delete(key);
    return null;
  }
  if (sessions.size >= MAX) sessions.clear();
  sessions.set(key, { at: now, value });
  return value;
}

/** After a sign-out, a role or status change or a new password: check every session again. */
export function forgetSessions(): void {
  sessions.clear();
}
