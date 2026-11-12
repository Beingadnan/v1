/**
 * Layouts met in QA Tech's 2026-27 files during the phase 12 import: the one
 * instrument per sheet FT-05 (Sikkim's Testo loggers), headings in a row with
 * the values under them, typed dates that don't exist, due dates before the
 * calibration, and "RTD sensor with data logger" read as an RTD.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { planInstrumentImport, readInstrumentList } from "./instrument-import";
import { instrumentTypeFromText } from "./types";

async function bytesOf(book: ExcelJS.Workbook) {
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** The single-instrument FT-05 as QA Tech prints it (column letters as in T-TRH0235.xls). */
function singleSheet(book: ExcelJS.Workbook, o: { code: string; due: Date | string }) {
  const s = book.addWorksheet(o.code);
  const put = (addr: string, v: ExcelJS.CellValue) => (s.getCell(addr).value = v);
  put("I2", "CALIBRATION CERTIFICATE");
  put("A5", `Calibration Certificate No. : QATECH/BHIWANDI/08/26/${o.code}`);
  put("N5", "Instrument Code No.");
  put("Q5", ":");
  put("R5", o.code);
  put("A6", "Customer Name & Address");
  put("H6", "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)");
  put("H7", "Gala No. 1 & 2, Angel Logistic Park, Bhiwandi");
  put("A8", "Instrument/Equipment Name");
  put("G8", ":");
  put("H8", "PORTABLE DATA LOGGER");
  put("N8", "Calibration Date");
  put("Q8", ":");
  put("R8", new Date(Date.UTC(2026, 7, 3)));
  put("A9", "Section");
  put("H9", "Process validation");
  put("N9", "Calibration Due Date");
  put("Q9", ":");
  put("R9", o.due);
  put("A10", "Location");
  put("H10", "Sikkim");
  put("A12", "Make & Model ");
  put("G12", ":");
  put("H12", "Testo & 174H");
  put("N12", "Range");
  put("R12", "-20 to 70 °C, 0 to 100 % RH");
  put("A14", "Serial No. ");
  put("G14", ":");
  put("H14", 84077667);
  put("N19", "Calibration SOP NO. : QATECH/CAL-026");
  put("A21", "Temperature : 25 ± 3 °C");
  put("B26", "Sr. No.");
  put("D26", "Input / \nCal. Point");
  put("H26", "Master \nReading");
  put("L26", "UUC \nReading");
  put("B28", "Sr. No."); // the merged heading repeats
  put("H28", "°C");
  put("L28", "°C");
  put("B29", 1);
  put("D29", -20);
  put("H29", -20.145);
  put("L29", -20.1);
  put("B30", 2);
  put("D30", 20);
  put("H30", 20.033);
  put("L30", 20.1);
  put("B35", "Sr. No.");
  put("H35", "Master \nReading");
  put("L35", "UUC \nReading");
  put("H37", "% RH");
  put("B38", 1);
  put("H38", 50.2);
  put("L38", 51.0);
  put("B42", "Name, Make & ID No.");
  put("J42", "Certificate No.");
  put("M42", "Calibration Valid Up To");
  put(
    "B43",
    "SEMI STANDARD PLATINUM RESISTANCE THERMOMETER, MAKE : ISOTECH, ID NO. QATM/CAL/TL-02 B (Sensor), QATM/CAL/TL-02A (Indicator)",
  );
  put("J43", "ARAI/CAL/2508/2924");
  put("M43", "22.08.2026");
}

describe("phase 12 certificate layouts", () => {
  it("reads a one-instrument certificate sheet: header, both tables and the masters by ID", async () => {
    const book = new ExcelJS.Workbook();
    singleSheet(book, { code: "T-TRH0235", due: new Date(Date.UTC(2027, 7, 2)) });
    const read = await readInstrumentList(await bytesOf(book));
    expect(read.workbookCertificates).toHaveLength(1);
    const c = read.workbookCertificates[0]!;
    expect(c).toMatchObject({
      number: "QATECH/BHIWANDI/08/26/T-TRH0235",
      calibratedOn: "2026-08-03",
      validUntil: "2027-08-02",
      make: "Testo",
      model: "174H",
      location: "Sikkim",
      sopNo: "QATECH/CAL-026",
      instruments: [{ code: "T-TRH0235", serialNo: "84077667" }],
    });
    expect(c.points).toEqual([
      { quantity: "temperature", reference: "-20.145", condition: "" },
      { quantity: "temperature", reference: "20.033", condition: "" },
      { quantity: "humidity", reference: "50.2", condition: "" },
    ]);
    expect(c.readings).toEqual([["-20.1"], ["20.1"], ["51"]]);
    expect(c.masters[0]).toMatchObject({
      make: "ISOTECH",
      certificateNo: "ARAI/CAL/2508/2924",
      validUntil: "2026-08-22",
      codes: ["QATM/CAL/TL-02B", "QATM/CAL/TL-02A"],
    });
  });

  it("refuses a typed date that doesn't exist, and a due date before the calibration", async () => {
    const typo = new ExcelJS.Workbook();
    singleSheet(typo, { code: "T-TRH0236", due: "30.02.2027" });
    const a = await readInstrumentList(await bytesOf(typo));
    expect(a.workbookCertificates[0]!.validUntil).toBeNull();

    const early = new ExcelJS.Workbook();
    singleSheet(early, { code: "T-TRH0237", due: new Date(Date.UTC(2026, 2, 11)) });
    const b = await readInstrumentList(await bytesOf(early));
    expect(b.workbookCertificates[0]!.validUntil).toBeNull();
    expect(b.problems.join(" ")).toContain("due date 11.03.2026 is not after the calibration date");
  });

  it("names the type from the sensor, not the data logger it is read through", () => {
    expect(instrumentTypeFromText("RTD Sensor with Data Logger")).toBe("rtd");
    expect(instrumentTypeFromText("TC Sensor with Data Logger")).toBe("thermocouple");
    expect(instrumentTypeFromText("Portable Datalogger")).toBe("portable_logger");
  });

  it("leaves out a client's own equipment, and a certificate naming only that", async () => {
    const book = new ExcelJS.Workbook();
    singleSheet(book, { code: "E ENG GEN TE-001", due: new Date(Date.UTC(2027, 7, 2)) });
    const ours = new ExcelJS.Workbook();
    singleSheet(ours, { code: "T-TRH0235", due: new Date(Date.UTC(2027, 7, 2)) });
    const empty = { models: [], instruments: [], certificates: [], sites: [], labName: "QA Tech" };
    const options = { defaultType: "portable_logger" as const, notOurs: ["E ENG GEN TE-"] };
    const theirs = planInstrumentImport(
      await readInstrumentList(await bytesOf(book)),
      empty,
      options,
    );
    expect(theirs.instruments).toHaveLength(0);
    expect(theirs.fullCertificates).toHaveLength(0);
    expect(theirs.problems.join(" ")).toContain("client's own equipment; skipped");
    const mine = planInstrumentImport(
      await readInstrumentList(await bytesOf(ours)),
      empty,
      options,
    );
    expect(mine.instruments.map((i) => i.code)).toEqual(["T-TRH0235"]);
  });
});
