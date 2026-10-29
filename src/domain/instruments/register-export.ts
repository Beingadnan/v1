import "server-only";

import ExcelJS from "exceljs";

import { STATUS_LABELS, type InstrumentStatus } from "./types";
import { VALIDITY_LABELS } from "./validity";
import type { InstrumentRow } from "./queries";

const thin = { style: "thin" as const };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const dmy = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join(".") : "");

/**
 * The register as Excel, with the headings of QA Tech's own logger lists
 * (SR. No., Instrument Name, Make, Model, ID No., Serial No., Certificate No.,
 * Range, Calibration Date, Due Date), so it reads like the lists the team keeps
 * and can be imported back.
 */
export async function exportRegisterWorkbook(
  rows: InstrumentRow[],
  title: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QTech";
  const sheet = workbook.addWorksheet("Instruments", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  const headers = [
    "SR. No.",
    "Instrument Name",
    "Make",
    "Model",
    "ID No.",
    "Serial No.",
    "Certificate No.",
    "Range",
    "Calibration Date",
    "Due Date",
    "Calibration",
    "Use",
    "Home site",
    "Status",
  ];
  const t = sheet.addRow([title]);
  sheet.mergeCells(t.number, 1, t.number, headers.length);
  t.font = { bold: true, size: 12 };
  const h = sheet.addRow(headers);
  h.font = { bold: true };
  h.eachCell((c) => {
    c.border = box;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  rows.forEach((r, i) => {
    const row = sheet.addRow([
      i + 1,
      r.equipmentName,
      r.make,
      r.model,
      r.code,
      r.serialNo,
      r.latest?.number ?? "",
      r.rangeText,
      dmy(r.latest?.calibratedOn),
      dmy(r.latest?.validUntil),
      VALIDITY_LABELS[r.validity],
      r.tier === "master" ? "Master standard" : "Working",
      r.siteName ?? "",
      STATUS_LABELS[r.status as InstrumentStatus] ?? r.status,
    ]);
    row.eachCell({ includeEmpty: true }, (c) => (c.border = box));
    if (r.validity === "expired" || r.validity === "due_7") {
      row.getCell(11).font = { color: { argb: "FFC0392B" }, bold: true };
    }
  });
  [8, 28, 12, 14, 14, 14, 30, 26, 15, 15, 20, 15, 14, 14].forEach(
    (w, i) => (sheet.getColumn(i + 1).width = w),
  );
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
