import "server-only";

import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Over HTTPS the cookie uses the __Host- prefix: the browser then only accepts
 * it if it is Secure, has Path=/ and no Domain, so a sub-domain can't plant or
 * read it. Plain http (local development) can't use the prefix.
 */
const SECURE = env.APP_URL.startsWith("https://");
export const SESSION_COOKIE = SECURE ? "__Host-qtech_session" : "qtech_session";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
