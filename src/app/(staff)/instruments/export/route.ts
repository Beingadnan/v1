import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { todayInIndia } from "@/domain/clients/requalification";
import { listInstruments, type InstrumentFilter } from "@/domain/instruments/queries";
import { exportRegisterWorkbook } from "@/domain/instruments/register-export";
import { excelResponse, userForRoute } from "@/lib/auth/route-auth";

/** GET /instruments/export?view=attention&q=… — the register as on screen, as Excel. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await userForRoute("instruments.view");
  if (user instanceof Response) return user;
  const params = request.nextUrl.searchParams;
  const view = params.get("view") ?? "";
  const filter: InstrumentFilter = { q: (params.get("q") ?? "").slice(0, 100) };
  if (view === "master" || view === "working") filter.tier = view;
  if (view === "attention") filter.validity = "attention";
  const rows = await listInstruments(db, user, filter);
  const today = todayInIndia().split("-").reverse().join(".");
  const title =
    view === "attention"
      ? `Instruments to calibrate (expired or due within 30 days), ${today}`
      : `QA Tech instrument register, ${today}`;
  const bytes = await exportRegisterWorkbook(rows, title);
  return excelResponse(
    bytes,
    view === "attention" ? `Instruments due ${today}.xlsx` : `Instrument register ${today}.xlsx`,
  );
}
