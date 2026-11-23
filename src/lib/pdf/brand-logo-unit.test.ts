import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";

import { brandMark, isQaTech, QATECH_LOGO } from "./brand-logo";

async function pdfOf(draw: (doc: PDFKit.PDFDocument) => void): Promise<string> {
  const doc = new PDFDocument({ size: "A4", compress: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on("end", () => r()));
  draw(doc);
  doc.end();
  await done;
  return Buffer.concat(chunks).toString("latin1");
}

describe("the logo on QA Tech's PDFs", () => {
  it("is the PNG from public/brand", () => {
    expect(QATECH_LOGO.subarray(1, 4).toString()).toBe("PNG");
    expect(QATECH_LOGO.readUInt32BE(16)).toBe(245);
    expect(QATECH_LOGO.readUInt32BE(20)).toBe(119);
  });

  it("knows QA Tech by its short or legal name", () => {
    expect(isQaTech("QA Tech")).toBe(true);
    expect(isQaTech("", "QA Tech (A Division of GMP Technical Solutions Pvt. Ltd.)")).toBe(true);
    expect(isQaTech("QATech")).toBe(true);
    expect(isQaTech("Acme Validation")).toBe(false);
  });

  it("draws the logo for QA Tech, and the name as text for anyone else", async () => {
    let width = 0;
    const qa = await pdfOf((doc) => {
      width = brandMark(doc, { shortName: "QA Tech", legalName: "" }, 40, 20, 40);
    });
    expect(qa).toMatch(/\/Subtype \/Image/);
    expect(width).toBeCloseTo((40 * 245) / 119, 5);

    let textWidth = 0;
    const other = await pdfOf((doc) => {
      textWidth = brandMark(doc, { shortName: "Acme", legalName: "Acme Validation" }, 40, 20, 40);
    });
    expect(other).not.toMatch(/\/Subtype \/Image/);
    expect(textWidth).toBeGreaterThan(0);
  });
});
