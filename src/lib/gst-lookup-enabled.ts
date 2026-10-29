import "server-only";

import { env } from "@/lib/env";

/** Whether forms should offer "fill from GSTIN" (both Cashfree keys are set). */
export function gstLookupEnabled(): boolean {
  return Boolean(env.CASHFREE_CLIENT_ID && env.CASHFREE_CLIENT_SECRET);
}
