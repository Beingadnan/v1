import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";

/**
 * GET /api/health — for an uptime monitor. Says only whether the app can reach
 * its database, nothing else, and needs no sign-in.
 */
export async function GET(): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout after 5 s")), 5_000);
      }),
    ]);
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", msg: "health check failed", error: String(error) }),
    );
    return NextResponse.json({ ok: false }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
