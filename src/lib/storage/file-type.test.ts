import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkFileType, detectFileType, fileExtension } from "./file-type";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new TextEncoder().encode(s);

describe("detectFileType", () => {
  it("recognises each accepted type by its leading bytes", () => {
    expect(detectFileType(text("%PDF-1.7\n..."))).toBe("pdf");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectFileType(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe("xls");
    expect(detectFileType(text("Date,Time,62281257\n22.05.2026,22:30:00,-22.2\n"))).toBe("csv");
  });

  it("accepts a ZIP only when it contains an Excel workbook", () => {
    const zipHeader = [0x50, 0x4b, 0x03, 0x04];
    expect(detectFileType(new Uint8Array([...zipHeader, ...text("....xl/workbook.xml")]))).toBe(
      "xlsx",
    );
    expect(detectFileType(new Uint8Array([...zipHeader, ...text("....malware.exe")]))).toBeNull();
  });

  it("refuses binary content it does not know", () => {
    expect(detectFileType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // Windows executable
    expect(detectFileType(new Uint8Array())).toBeNull();
  });
});

describe("checkFileType", () => {
  it("accepts content that matches its extension", () => {
    expect(checkFileType("Report.PDF", text("%PDF-1.4"))).toEqual({ ok: true, type: "pdf" });
  });

  it("refuses a file whose content does not match its name", () => {
    const result = checkFileType("raw-data.xlsx", text("%PDF-1.4"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/looks like a PDF file but is named \.xlsx/);
  });

  it("refuses text files that are not CSV", () => {
    expect(checkFileType("FW_ WH013.eml", text("From: someone")).ok).toBe(false);
    expect(checkFileType("notes.txt", text("hello")).ok).toBe(false);
  });

  it("gives a plain message for unknown files", () => {
    const result = checkFileType("setup.exe", bytes(0x4d, 0x5a, 0x90, 0x00));
    expect(result).toEqual({
      ok: false,
      message: "setup.exe is not a PDF, Excel, CSV or image file.",
    });
  });
});

describe("fileExtension", () => {
  it("returns the lower-case extension", () => {
    expect(fileExtension("TL-38 27.01.2027.PDF")).toBe(".pdf");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});

// Real QA Tech files, kept out of git in fixtures/. Skipped when not present (e.g. in CI).
const fixtureDir = path.resolve(__dirname, "../../../fixtures/client");
const realFiles: Array<[string, string | null]> = [
  ["Dispensing-2 WH013.xlsx", "xlsx"],
  ["Refrigerator_Temperature_Mapping_Raw_Data.xlsx", "xlsx"],
  ["TL-38 27.01.2027.pdf", "pdf"],
  ["BE-WF-02 report.pdf", "pdf"],
  ["FW_ WH013.eml", null],
];

describe.skipIf(!existsSync(fixtureDir))("real QA Tech files", () => {
  it.each(realFiles)("%s", (name, expected) => {
    const result = checkFileType(name, readFileSync(path.join(fixtureDir, name)));
    expect(result.ok ? result.type : null).toBe(expected);
  });
});
