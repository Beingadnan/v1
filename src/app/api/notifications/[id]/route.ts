import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import { validateSession } from "@/domain/auth/session-service";
import { markRead } from "@/domain/notifications/notify";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

/** GET /api/notifications/:id — marks the person's notification read and opens what it is about. */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/api/notifications/[id]">,
): Promise<NextResponse> {
  const session = await validateSession(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(new URL("/", request.url));
  const [n] = await db
    .select({ href: notifications.href })
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, session.user.id)));
  if (!n) return NextResponse.redirect(new URL("/", request.url));
  await markRead(db, session.user, id);
  // Only paths inside the app (checked by the database too): "//host" and "/\host"
  // would open another site.
  const target = new URL(INSIDE_APP.test(n.href) ? n.href : "/", request.url);
  return NextResponse.redirect(
    target.origin === request.nextUrl.origin ? target : new URL("/", request.url),
  );
}

const INSIDE_APP = /^\/([^/\\]|$)/;
