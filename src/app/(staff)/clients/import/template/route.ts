import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { validateSession } from "@/domain/auth/session-service";
import { buildImportTemplate } from "@/domain/clients/import/workbook";
import { readSessionCookie } from "@/lib/auth/session-cookie";

/** GET /clients/import/template — the Excel template for importing clients and equipment. */
export async function GET(): Promise<Response> {
  const session = await validateSession(db, await readSessionCookie());
  if (!session) return new Response("Sign in again.", { status: 401 });
  if (!can(session.user, "clients.manage")) {
    return new Response("Your role doesn't allow imports.", { status: 403 });
  }
  const bytes = await buildImportTemplate();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="QTech clients and equipment import.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
