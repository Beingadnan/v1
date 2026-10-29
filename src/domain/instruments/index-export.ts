import "server-only";

import ExcelJS from "exceljs";

import type { DbExecutor } from "@/db/client-factory";
import type { SessionUser } from "@/domain/auth/session-service";

import { dmy } from "./display";
import { calibrationIndex } from "./queries";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const HEADERS = [
  "Sr. No.",
  "Name of Customer",
  "Certificate No",
  "Cal. Date",
  "Cal. Due date",
  "Activity Done by",
  "Certificate Done by",
];
const WIDTHS = [8, 42, 34, 13, 14, 22, 22];
const thin = { style: "thin" as const };
const box = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * The Calibration Index as QA Tech keeps it: one sheet per month, a section per
 * kind (RTD Sensor, Portable Datalogger, TC Sensor…), rows in number order.
 * `month` limits it to one sheet; otherwise every month of the year up to now.
 */
export async function exportCalibrationIndex(
  db: DbExecutor,
  actor: SessionUser,
  year: number,
  month?: number,
): Promise<{ bytes: Buffer; fileName: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QTech";
  const months = month ? [month] : MONTH_NAMES.map((_, i) => i + 1);
  for (const m of months) {
    const sections = await calibrationIndex(db, actor, year, m);
    if (!month && sections.length === 0) continue;
    const sheet = workbook.addWorksheet(`${MONTH_NAMES[m - 1]} ${year}`, {
      pageSetup: {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.columns = WIDTHS.map((width) => ({ width }));
    const title = sheet.addRow([
      `CALIBRATION INDEX — ${MONTH_NAMES[m - 1]!.toUpperCase()} ${year}`,
    ]);
    sheet.mergeCells(title.number, 1, title.number, HEADERS.length);
    title.font = { bold: true, size: 13 };
    title.alignment = { horizontal: "center" };
    if (sections.length === 0) {
      sheet.addRow([]);
      sheet.addRow(["No certificates issued this month."]);
    }
    for (const section of sections) {
      sheet.addRow([]);
      const head = sheet.addRow([section.section]);
      sheet.mergeCells(head.number, 1, head.number, HEADERS.length);
      head.font = { bold: true };
      head.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
      head.getCell(1).border = box;
      const cols = sheet.addRow(HEADERS);
      cols.font = { bold: true };
      cols.eachCell((c) => {
        c.border = box;
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      section.rows.forEach((r, i) => {
        const row = sheet.addRow([
          i + 1,
          r.customerName,
          r.number,
          dmy(r.calibratedOn),
          dmy(r.validUntil),
          r.doneBy,
          r.certificateBy,
        ]);
        row.eachCell({ includeEmpty: true }, (c, col) => {
          c.border = box;
          c.alignment = {
            vertical: "middle",
            horizontal: col === 2 || col === 3 ? "left" : "center",
            wrapText: true,
          };
        });
      });
    }
  }
  if (workbook.worksheets.length === 0) {
    const sheet = workbook.addWorksheet(`${year}`);
    sheet.addRow([`No certificates issued in ${year}.`]);
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = month
    ? `Calibration Index ${MONTH_NAMES[month - 1]} ${year}.xlsx`
    : `Calibration Index-${year}.xlsx`;
  return { bytes, fileName };
}
