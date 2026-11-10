import "server-only";

import { mm, planProjector, spreadLabels, type Dimensions } from "./layout";
import { PLAN_FEATURE_MARKS, type PlanFeature } from "./types";

const ascii = (s: string) =>
  s
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");

export type PlanSpot = {
  label: string;
  x: number;
  y: number;
  /** Fill of the circle (hot and cold spots on the report). */
  fill?: string;
  text?: string;
};

/**
 * A room's floor plan on a PDF page, as on QA Tech's area reports (WH013):
 * the walls numbered clockwise from the entrance side (wall-1 at the bottom),
 * the length and width, the marks (door, pass box, LAF, ducts) and each
 * logger as a labelled circle. Shared by FT-12 and the report.
 */
export function drawPlan(
  doc: PDFKit.PDFDocument,
  box: { x: number; y: number; w: number; h: number },
  dims: Dimensions,
  spots: PlanSpot[],
  features: PlanFeature[],
) {
  const { rect, at: rel } = planProjector(dims, { width: box.w, height: box.h, margin: 44 });
  const at = (p: { x: number; y: number }) => {
    const q = rel(p);
    return { x: box.x + q.x, y: box.y + q.y };
  };
  const r = { x: box.x + rect.x, y: box.y + rect.y, w: rect.w, h: rect.h };
  doc.lineWidth(1.6).strokeColor("#111111").rect(r.x, r.y, r.w, r.h).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
  doc.text(`Wall-1   L-${mm(dims.lengthM)}`, r.x, r.y + r.h + 20, { width: r.w, align: "center" });
  doc.text("Wall-3", r.x, r.y - 20, { width: r.w, align: "center" });
  doc.text("Wall-2", r.x + r.w + 4, r.y + r.h / 2 - 4, { width: 40 });
  doc.text(`Wall-4`, r.x - 44, r.y + r.h / 2 - 8, { width: 40, align: "right" });
  doc.text(`W-${mm(dims.widthM)}`, r.x - 64, r.y + r.h / 2 + 2, { width: 60, align: "right" });

  for (const f of features) {
    const q = at(f);
    const mark = PLAN_FEATURE_MARKS[f.kind];
    const w = Math.max(16, mark.length * 6 + 6);
    doc.lineWidth(0.7).strokeColor("#1f3a68").fillColor("#e7f1fb");
    doc.rect(q.x - w / 2, q.y - 6, w, 12).fillAndStroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .fillColor("#1f3a68")
      .text(mark, q.x - w / 2, q.y - 3, { width: w, align: "center", lineBreak: false });
    if (f.label) {
      doc
        .font("Helvetica")
        .fontSize(6)
        .fillColor("#333333")
        .text(ascii(f.label), q.x - 40, q.y + 8, { width: 80, align: "center", lineBreak: false });
    }
  }

  const labels = spreadLabels(
    spots.map((s) => ({ ...at(s), s })),
    { w: 26, h: 18 },
  );
  for (const { x, y, s } of labels) {
    doc
      .lineWidth(0.6)
      .strokeColor("#222222")
      .fillColor(s.fill ?? "#ffffff")
      .circle(x, y, 9)
      .fillAndStroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(5.5)
      .fillColor(s.text ?? "#000000")
      .text(ascii(s.label), x - 12, y - 2.2, { width: 24, align: "center", lineBreak: false });
  }
}
