import "server-only";

import { isIP } from "node:net";

import { headers } from "next/headers";

import type { RequestInfo } from "@/domain/auth/policy";
import { env } from "@/lib/env";

/** Client IP and user agent for audit and throttling. Never trusts forged headers. */
export async function getRequestInfo(): Promise<RequestInfo> {
  const h = await headers();
  return requestInfoFromHeaders(h);
}

export function requestInfoFromHeaders(h: Headers): RequestInfo {
  return clientInfo(h, { onVercel: process.env.VERCEL === "1", trustProxy: env.TRUST_PROXY });
}

/**
 * Which address to believe:
 * - On Vercel, its edge overwrites X-Forwarded-For and X-Real-IP with the address it
 *   saw, so whatever a client sent is gone and either header is the real client.
 * - Behind another reverse proxy (TRUST_PROXY=true), that proxy appends the address it
 *   saw, so only the right-most entry is trustworthy; anything to its left was sent by
 *   the client and could be forged to dodge sign-in throttling.
 * - Otherwise forwarded headers are ignored.
 */
export function clientInfo(
  h: Headers,
  options: { onVercel: boolean; trustProxy: boolean },
): RequestInfo {
  let ip: string | undefined;
  if (options.onVercel) {
    ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim();
  } else if (options.trustProxy) {
    ip = h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || h.get("x-real-ip")?.trim();
  }
  return {
    ipAddress: ip && isIP(ip) ? ip : undefined,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? undefined,
  };
}
