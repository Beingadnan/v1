import { describe, expect, it } from "vitest";

import { printedMasterLine, printedMasters } from "./printed-masters";

describe("masters printed on an imported FT-05", () => {
  it("reads back what the import writes, as on QA Tech's real certificates", () => {
    const remarks = [
      "Imported from 17.07.2025  Serum Hadpsar Testo Datalogger PDL-09.xlsx (NEW (2), NEW (3)).",
      printedMasterLine({
        label:
          "Semi standard Platinum Resistance with Digital Reference Thermometer (Isotech TTI-10 (Digital Thermometer), 935-14-13 (SSPRT), S/N 33902-1(Digital Reference Thermometer))",
        certificateNo: "ARAI/CAL/2408/1836",
        validUntil: "2025-08-30",
      }),
      printedMasterLine({
        label:
          "Digital Temperature & Humidity Indicator with sensor (Rotronic HP22-A, S/N 60477499/60257729)",
        certificateNo: "CC287924000005486F",
        validUntil: "2025-09-19",
      }),
      printedMasterLine({
        label: "Dry block (Fluke, DB-01)",
        certificateNo: "TL/026.444.1.1",
        validUntil: null,
      }),
    ].join("\n");
    expect(printedMasters(remarks)).toEqual([
      {
        name: "Semi standard Platinum Resistance with Digital Reference Thermometer",
        make: "Isotech TTI-10 (Digital Thermometer), 935-14-13 (SSPRT)",
        serial: "33902-1(Digital Reference Thermometer)",
        certificate: "ARAI/CAL/2408/1836",
        validUntil: "2025-08-30",
      },
      {
        name: "Digital Temperature & Humidity Indicator with sensor",
        make: "Rotronic HP22-A",
        serial: "60477499/60257729",
        certificate: "CC287924000005486F",
        validUntil: "2025-09-19",
      },
      {
        name: "Dry block",
        make: "Fluke, DB-01",
        serial: "",
        certificate: "TL/026.444.1.1",
        validUntil: null,
      },
    ]);
  });

  it("finds nothing in other remarks", () => {
    expect(printedMasters("Imported from x.xlsx.\nChecked by hand.")).toEqual([]);
    expect(printedMasters(null)).toEqual([]);
  });
});
