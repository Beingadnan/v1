import { db } from "@/db/client";
import { exportRegister } from "@/domain/clients/export-service";
import { excelResponse, userForRoute } from "@/lib/auth/route-auth";

/** GET /clients/:id/export — one client's sites and equipment, in the import layout. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/clients/[companyId]/export">,
): Promise<Response> {
  const user = await userForRoute("clients.view");
  if (user instanceof Response) return user;
  const { companyId } = await params;
  const file = await exportRegister(db, user, companyId);
  if (!file) return new Response("That client does not exist.", { status: 404 });
  return excelResponse(file.bytes, file.fileName);
}
