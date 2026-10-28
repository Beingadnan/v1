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
  let ip: string | undefined;
  if (env.TRUST_PROXY) {
    // The proxy appends the real client address; the left-most entry is the original client.
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    ip = forwarded ?? h.get("x-real-ip")?.trim();
  }
  return {
    ipAddress: ip && isIP(ip) ? ip : undefined,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? undefined,
  };
}
