import type { NextRequest } from "next/server";

import { db } from "@/db/client";
import { todayInIndia } from "@/domain/clients/requalification";
import { exportCalibrationIndex } from "@/domain/instruments/index-export";
import { excelResponse, userForRoute } from "@/lib/auth/route-auth";

import { readIndexMonth } from "../month";

/** GET /instruments/index/export?year=2026[&month=3] — the Calibration Index workbook. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await userForRoute("instruments.view");
  if (user instanceof Response) return user;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const { year, month } = readIndexMonth(params, todayInIndia());
  const { bytes, fileName } = await exportCalibrationIndex(
    db,
    user,
    year,
    params.month ? month : undefined,
  );
  return excelResponse(bytes, fileName);
}
