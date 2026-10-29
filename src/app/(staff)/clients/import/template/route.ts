import { buildImportTemplate } from "@/domain/clients/import/workbook";
import { excelResponse, userForRoute } from "@/lib/auth/route-auth";

/** GET /clients/import/template — the Excel template for importing clients and equipment. */
export async function GET(): Promise<Response> {
  const user = await userForRoute("clients.manage");
  if (user instanceof Response) return user;
  return excelResponse(await buildImportTemplate(), "QTech clients and equipment import.xlsx");
}
