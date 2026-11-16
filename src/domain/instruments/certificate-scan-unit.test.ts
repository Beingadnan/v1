import { describe, expect, it } from "vitest";

import {
  cleanIsoDate,
  fileNameHints,
  findInstrument,
  fromFileName,
  normaliseCode,
  parseCertificateReading,
} from "./certificate-scan";

describe("fileNameHints", () => {
  it("reads QA Tech's scan names as they are", () => {
    expect(fileNameHints("TL-38 27.01.2027.pdf")).toEqual({
      codes: ["TL-38"],
      dates: ["2027-01-27"],
    });
    expect(fromFileName("TL-38 27.01.2027_2.pdf")).toMatchObject({ validUntil: "2027-01-27" });
    expect(fileNameHints("TL-02B, 02A 22.08.2026.pdf").codes).toEqual(["TL-02B", "TL-02A"]);
    expect(fileNameHints("DTS-27, 27A, 27B 03.07.2026.pdf").codes).toEqual([
      "DTS-27",
      "DTS-27A",
      "DTS-27B",
    ]);
    expect(fileNameHints("ET-01, 01A  04.06.2027.pdf").codes).toEqual(["ET-01", "ET-01A"]);
    expect(fileNameHints("DL-17  (08.06.2027).pdf")).toEqual({
      codes: ["DL-17"],
      dates: ["2027-06-08"],
    });
    expect(fileNameHints("DL-32(24.02.2027).pdf").codes).toEqual(["DL-32"]);
  });

  it("expands a range of IDs", () => {
    const { codes } = fileNameHints("Rotronic Sensors TRHS-031 to TRHS-050.pdf");
    expect(codes).toHaveLength(20);
    expect(codes[0]).toBe("TRHS-031");
    expect(codes.at(-1)).toBe("TRHS-050");
  });

  it("finds nothing in a scanner's name", () => {
    expect(fileNameHints("20260916144933.pdf")).toEqual({ codes: [], dates: [] });
    expect(fromFileName("4222_001.pdf")).toBeNull();
  });
});

describe("fromFileName", () => {
  it("takes a date after the IDs as the due date, one before them as the calibration date", () => {
    expect(fromFileName("TL-02B, 02A 22.08.2026.pdf")).toMatchObject({
      calibratedOn: "",
      validUntil: "2026-08-22",
      instruments: [
        { id: "TL-02B", serial: "" },
        { id: "TL-02A", serial: "" },
      ],
    });
    expect(fromFileName("01.04.2026 Qatech Calibration Certificate RTD-02.pdf")).toMatchObject({
      calibratedOn: "2026-04-01",
      validUntil: "",
    });
  });

  it("lists an ID once however it is written", () => {
    expect(
      fromFileName("Rotronic Sensors TRHS-031 to TRHS-50.pdf")!.instruments.map((i) => i.id),
    ).toHaveLength(20);
  });
});

describe("parseCertificateReading", () => {
  it("keeps what is readable and drops what is not", () => {
    const read = parseCertificateReading({
      certificates: [
        {
          page: 1,
          number: "  SAN/26/128/TH/1 ",
          ulrNo: "cc 287926000000394f",
          labName: "Sansel Calibration Laboratories LLP",
          calibratedOn: "2026-01-28",
          validUntil: "2027-02-30",
          instruments: [{ id: "QATM/CAL/TL-38", serial: "61442336" }, { id: "", serial: "" }, 7],
          notes: "",
        },
        { page: 2, number: "", instruments: [] },
        "nonsense",
      ],
    });
    expect(read).toEqual([
      {
        page: 1,
        number: "SAN/26/128/TH/1",
        ulrNo: "CC287926000000394F",
        labName: "Sansel Calibration Laboratories LLP",
        calibratedOn: "2026-01-28",
        validUntil: "",
        instruments: [{ id: "QATM/CAL/TL-38", serial: "61442336" }],
        notes: "",
      },
    ]);
    expect(parseCertificateReading(null)).toEqual([]);
    expect(cleanIsoDate("2026-02-29")).toBe("");
  });
});

describe("findInstrument", () => {
  const register = [
    { id: "a", code: "QATM/CAL/TL-38", serialNo: "61442336" },
    { id: "b", code: "TRHS-031", serialNo: "20482915" },
    { id: "c", code: "QATM/CAL/TL-02A", serialNo: "33902-1" },
    { id: "d", code: "QATM/CAL/TL-02", serialNo: "311401/59" },
  ];
  it("matches the ID either way round, the serial, and leading zeros", () => {
    expect(findInstrument(register, { id: "TL-38", serial: "" })?.id).toBe("a");
    expect(findInstrument(register, { id: "QATM/CAL/TL-38", serial: "" })?.id).toBe("a");
    expect(findInstrument(register, { id: "trhs-31", serial: "" })?.id).toBe("b");
    expect(findInstrument(register, { id: "", serial: "20482915" })?.id).toBe("b");
    expect(findInstrument(register, { id: "TL-02", serial: "" })?.id).toBe("d");
    expect(findInstrument(register, { id: "TL-99", serial: "" })).toBeNull();
  });
  it("normalises codes", () => {
    expect(normaliseCode("qatech/bhiwandi/05/26/ PDL-019")).toBe("QATECH/BHIWANDI/05/26/PDL-19");
  });
});
