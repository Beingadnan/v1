import { db } from "@/db/client";
import { exportRegister } from "@/domain/clients/export-service";
import { excelResponse, userForRoute } from "@/lib/auth/route-auth";

/** GET /clients/export — every client's sites and equipment, in the import layout. */
export async function GET(): Promise<Response> {
  const user = await userForRoute("clients.view");
  if (user instanceof Response) return user;
  const file = await exportRegister(db, user);
  if (!file) return new Response("Not found.", { status: 404 });
  return excelResponse(file.bytes, file.fileName);
}
