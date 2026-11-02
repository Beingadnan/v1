import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { dailyDigest } from "@/domain/notifications/digest";
import { env } from "@/lib/env";
import { emailSender } from "@/lib/mail";

/**
 * POST /api/cron/digest — sends waiting alert emails and the daily digest.
 * Called once a day by the host's scheduler with
 * "Authorization: Bearer <CRON_SECRET>"; off while CRON_SECRET is unset.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!env.CRON_SECRET) return NextResponse.json({ error: "Not set up." }, { status: 404 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const result = await dailyDigest(db, emailSender, env.APP_URL);
  return NextResponse.json(result);
}
