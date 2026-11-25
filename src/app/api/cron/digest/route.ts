import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { dailyDigest } from "@/domain/notifications/digest";
import { env } from "@/lib/env";
import { emailSender } from "@/lib/mail";
import { sweepIncoming } from "@/lib/storage/incoming";

/**
 * POST (or GET, as Vercel Cron calls it) /api/cron/digest — sends waiting alert
 * emails and the daily digest. Called once a day by the host's scheduler with
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
  // Large uploads someone started but never finished (src/lib/storage/incoming.ts).
  const incomingRemoved = env.BLOB_READ_WRITE_TOKEN
    ? await sweepIncoming(env.BLOB_READ_WRITE_TOKEN).catch((error: unknown) => {
        console.error(
          JSON.stringify({ level: "error", msg: "incoming sweep failed", error: String(error) }),
        );
        return null;
      })
    : 0;
  return NextResponse.json({ ...result, incomingRemoved });
}

/** Vercel Cron calls with GET and the same bearer secret (vercel.json). */
export const GET = POST;
