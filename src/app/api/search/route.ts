import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { isClientRole } from "@/domain/auth/roles";
import { validateSession } from "@/domain/auth/session-service";
import { searchAll } from "@/domain/search/search";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

/** GET /api/search?q= — the Ctrl+K search (staff only); at most five hits of each kind. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await validateSession(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (isClientRole(session.user.role)) return NextResponse.json({ hits: [] });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const hits = await searchAll(db, session.user, q);
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
}
