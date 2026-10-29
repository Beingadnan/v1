import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { exportDueList, listDueEquipment } from "@/domain/clients/export-service";
import { excelResponse, userForRoute } from "@/lib/auth/route-auth";

import { readDueWindow } from "../window";

/** GET /clients/due/export?days=60 — the requalification due list as Excel. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await userForRoute("clients.view");
  if (user instanceof Response) return user;
  const window = readDueWindow(Object.fromEntries(request.nextUrl.searchParams));
  const items = await listDueEquipment(db, user, window);
  const bytes = await exportDueList(
    items,
    `Equipment due for requalification within ${window.days} days`,
  );
  return excelResponse(bytes, `QTech requalification due ${window.days} days.xlsx`);
}
