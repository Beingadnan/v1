import "server-only";

import PDFDocument from "pdfkit";

import { mappedNoun } from "@/domain/clients/equipment-types";
import { WORK_TYPE_LABELS, type WorkType } from "@/domain/jobs/types";

import { BOX_EDGES, mm, projector, spreadLabels, type Point } from "./layout";
import { drawPlan } from "./plan-pdf";
import type { FieldStudy } from "./queries";
import { EVENT_LABELS, type EventKind } from "./types";
import { brandMark } from "@/lib/pdf/brand-logo";

/**
 * Sensor location sheet (form QATM/PVAL/FT-12): the box drawn with its sizes
 * and each position labelled, as on page 4 of QA Tech's reports; the table of
 * positions with the logger placed at each; the cycle times; and signature
 * lines for whoever placed and checked them.
 */

export type Ft12Context = {
  organisation: {
    legalName: string;
    shortName: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
  letterhead?: Buffer | null;
  team: string[];
};

const PAGE = { width: 595.28, height: 841.89, margin: 28 };
const CONTENT = PAGE.width - PAGE.margin * 2;
const BORDER = "#444444";
const SHADE = "#e8e8e8";
const FOOTER = 30;

const ascii = (s: string) =>
  s
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, "?");

const dmy = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join(".") : "");
const when = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(d)
        .replace(/\//g, ".")
        .replace(",", "")
    : "";

export async function renderFt12(s: FieldStudy, ctx: Ft12Context): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `Sensor location sheet ${s.study.reportNumber}`,
      Author: ctx.organisation.legalName,
    },
  });
  let y = PAGE.margin;

  const cell = (
    x: number,
    cy: number,
    w: number,
    h: number,
    text: string,
    o: { bold?: boolean; size?: number; align?: "left" | "center" | "right"; fill?: string } = {},
  ) => {
    if (o.fill) doc.rect(x, cy, w, h).fill(o.fill);
    doc.lineWidth(0.5).strokeColor(BORDER).rect(x, cy, w, h).stroke();
    doc
      .font(o.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(o.size ?? 7.5)
      .fillColor("#000000");
    const t = ascii(text);
    const height = doc.heightOfString(t, { width: w - 5 });
    doc.text(t, x + 2.5, cy + Math.max(1.5, (h - height) / 2), {
      width: w - 5,
      height: h - 1,
      align: o.align ?? "left",
      ellipsis: true,
    });
  };
  const row = (h: number, cells: [string, number, Parameters<typeof cell>[5]?][]) => {
    let x = PAGE.margin;
    for (const [text, w, o] of cells) {
      cell(x, y, w, h, text, o);
      x += w;
    }
    y += h;
  };
  const ensure = (h: number) => {
    if (y + h <= PAGE.height - PAGE.margin - FOOTER) return;
    doc.addPage();
    y = PAGE.margin;
  };

  // Letterhead.
  const org = ctx.organisation;
  let printedImage = false;
  if (ctx.letterhead) {
    try {
      doc.image(ctx.letterhead, PAGE.margin, y, { fit: [CONTENT, 64], align: "center" });
      y += 68;
      printedImage = true;
    } catch {
      // Unreadable image: fall back to text.
    }
  }
  if (!printedImage) {
    brandMark(doc, org, PAGE.margin, y, 38);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#333333")
      .text(
        ascii(
          [org.address, org.phone && `Tel: ${org.phone}`, org.email && `E-mail: ${org.email}`]
            .filter(Boolean)
            .join("\n"),
        ),
        PAGE.margin + CONTENT / 2,
        y,
        {
          width: CONTENT / 2,
          align: "right",
        },
      );
    y = Math.max(doc.y, y + 40) + 4;
    doc
      .lineWidth(1)
      .strokeColor("#1f3a68")
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.margin + CONTENT, y)
      .stroke();
    y += 6;
  }

  const titleW = 200;
  cell(PAGE.margin + (CONTENT - titleW) / 2, y, titleW, 18, "Sensor Location Sheet", {
    bold: true,
    size: 11,
    align: "center",
    fill: SHADE,
  });
  y += 24;

  const half = CONTENT / 2;
  const k = 90;
  const pair = (a: [string, string], b: [string, string]) =>
    row(16, [
      [a[0], k, { bold: true, fill: SHADE }],
      [a[1], half - k],
      [b[0], k, { bold: true, fill: SHADE }],
      [b[1], half - k],
    ]);
  const d = s.equipment.dims;
  pair(["Customer", s.companyName], ["Site", s.siteName]);
  row(16, [
    ["Report No.", k, { bold: true, fill: SHADE }],
    [s.study.reportNumber, CONTENT - k - k - 90],
    ["Job No.", k, { bold: true, fill: SHADE }],
    [s.job.number, 90],
  ]);
  const noun = mappedNoun(s.equipment.type);
  pair([noun, s.equipment.name], [`${noun} ID`, s.equipment.code]);
  pair(["Department", s.equipment.department ?? ""], ["Location", s.equipment.location]);
  pair(
    ["Study", WORK_TYPE_LABELS[s.study.workType as WorkType] ?? s.study.workType],
    ["Planned", `${dmy(s.job.plannedStart)} to ${dmy(s.job.plannedEnd)}`],
  );
  pair(
    [
      noun === "Equipment" ? "Inside size" : `${noun} size`,
      `L ${mm(d.lengthM)} x W ${mm(d.widthM)} x H ${mm(d.heightM)}`,
    ],
    [
      "Loggers",
      `${s.positions.filter((p) => p.instrumentId).length} of ${s.positions.length} placed`,
    ],
  );
  y += 8;

  // Diagram.
  ensure(260);
  row(16, [
    ["Diagram Indicating Sensors Positions", CONTENT, { bold: true, align: "center", fill: SHADE }],
  ]);
  const box = { x: PAGE.margin, y, w: CONTENT, h: 240 };
  doc.lineWidth(0.5).strokeColor(BORDER).rect(box.x, box.y, box.w, box.h).stroke();
  const inside = s.positions.filter((p) => !p.ambient);
  const ambient = s.positions.filter((p) => p.ambient);
  const legendW = ambient.length ? 110 : 0;
  if (s.equipment.type === "room") {
    drawPlan(
      doc,
      { x: box.x, y: box.y, w: box.w - legendW, h: box.h },
      d,
      inside.map((p) => ({ label: p.label, x: p.x, y: p.y })),
      s.study.planFeatures,
    );
  } else {
    const project = projector(d, { width: box.w - legendW, height: box.h, margin: 34 });
    const at = (p: Point) => {
      const q = project(p);
      return { x: box.x + q.x, y: box.y + q.y };
    };
    doc.lineWidth(0.9).strokeColor("#222222");
    for (const [a, b] of BOX_EDGES) {
      // Hidden edges (at the back, bottom left) dashed, as drawn by hand.
      const hidden = (a.x === 0 && a.y === 1 && a.z === 0) || (b.x === 0 && b.y === 1 && b.z === 0);
      const pa = at(a);
      const pb = at(b);
      if (hidden) doc.dash(3, { space: 2 });
      doc.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke();
      doc.undash();
    }
    // Sizes, written as on the report: L along the front, W along the depth, H up the side.
    doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
    const lMid = at({ x: 0.5, y: 0, z: 0 });
    doc.text(`L-${mm(d.lengthM)}`, lMid.x - 40, lMid.y + 6, { width: 80, align: "center" });
    const wMid = at({ x: 1, y: 0.5, z: 0 });
    doc.text(`W-${mm(d.widthM)}`, wMid.x + 6, wMid.y, { width: 80 });
    const hMid = at({ x: 1, y: 1, z: 0.5 });
    doc.text(`H-${mm(d.heightM)}`, hMid.x + 6, hMid.y - 4, { width: 80 });
    const labels = spreadLabels(
      inside.map((p) => ({ ...at(p), label: p.label })),
      { w: 30, h: 13 },
    );
    for (const q of labels) {
      doc
        .lineWidth(0.6)
        .strokeColor("#222222")
        .fillColor("#ffffff")
        .ellipse(q.x, q.y, 14, 6)
        .fillAndStroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(6)
        .fillColor("#000000")
        .text(ascii(q.label), q.x - 14, q.y - 2.4, {
          width: 28,
          align: "center",
          lineBreak: false,
        });
    }
  }
  if (ambient.length) {
    const lx = box.x + box.w - legendW + 8;
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text("Outside (ambient)", lx, box.y + 12, { width: legendW - 12 });
    ambient.forEach((p, i) => {
      const cy = box.y + 30 + i * 16;
      doc
        .lineWidth(0.6)
        .strokeColor("#222222")
        .fillColor("#ffffff")
        .ellipse(lx + 14, cy + 3, 14, 6)
        .fillAndStroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(6)
        .fillColor("#000000")
        .text(ascii(p.label), lx, cy + 0.6, { width: 28, align: "center", lineBreak: false });
    });
  }
  y = box.y + box.h + 10;

  // Positions and loggers.
  const cols: [string, number][] = [
    ["Position", 52],
    ["Where", 170],
    ["Logger ID", 85],
    ["Serial No.", 80],
    ["Calibration due", 70],
    ["Placed by", CONTENT - 457],
  ];
  const head = () =>
    row(
      16,
      cols.map(
        ([t, w]) =>
          [t, w, { bold: true, fill: SHADE, align: "center" }] as [
            string,
            number,
            Parameters<typeof cell>[5],
          ],
      ),
    );
  ensure(40);
  head();
  for (const p of s.positions) {
    if (y + 14 > PAGE.height - PAGE.margin - FOOTER) {
      ensure(40);
      head();
    }
    row(14, [
      [p.label + (p.ambient ? " (amb.)" : ""), cols[0]![1], { align: "center", bold: true }],
      [p.note, cols[1]![1]],
      [p.code ?? "", cols[2]![1], { align: "center" }],
      [p.serialNo ?? "", cols[3]![1], { align: "center" }],
      [
        p.certificate
          ? p.certificate.validUntil
            ? dmy(p.certificate.validUntil)
            : "No due date"
          : "",
        cols[4]![1],
        { align: "center" },
      ],
      [p.by ?? "", cols[5]![1]],
    ]);
  }
  y += 10;

  // Cycles.
  ensure(60);
  row(16, [
    ["Cycle", 110, { bold: true, fill: SHADE }],
    ["Started", 95, { bold: true, fill: SHADE, align: "center" }],
    ["Ended", 95, { bold: true, fill: SHADE, align: "center" }],
    ["Markers", CONTENT - 300, { bold: true, fill: SHADE }],
  ]);
  for (const c of s.cycles) {
    const markers = c.events
      .filter((e) => e.kind !== "start" && e.kind !== "end")
      .map((e) => `${EVENT_LABELS[e.kind as EventKind]} ${when(e.at).slice(-5)}`)
      .join(", ");
    ensure(16);
    row(16, [
      [c.label, 110],
      [when(c.startedAt), 95, { align: "center" }],
      [when(c.endedAt), 95, { align: "center" }],
      [markers, CONTENT - 300],
    ]);
  }
  y += 8;

  // Signatures.
  ensure(62);
  const sig = (x: number, w: number, title: string, name: string) => {
    doc
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .moveTo(x, y + 34)
      .lineTo(x + w, y + 34)
      .stroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#000000")
      .text(title, x, y + 38, { width: w });
    doc
      .font("Helvetica")
      .fontSize(7)
      .text(ascii(name), x, y + 48, { width: w });
  };
  const third = (CONTENT - 40) / 3;
  sig(PAGE.margin, third, "Sensors placed by (QA Tech)", ctx.team.join(", "));
  sig(PAGE.margin + third + 20, third, "Checked by (QA Tech)", "");
  sig(PAGE.margin + 2 * (third + 20), third, "Witnessed by (client)", "");

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const fy = PAGE.height - PAGE.margin - FOOTER + 10;
    doc
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .moveTo(PAGE.margin, fy)
      .lineTo(PAGE.margin + CONTENT, fy)
      .stroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor("#000000")
      .text("QATM/PVAL/FT-12", PAGE.margin, fy + 4, { width: 150, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE.margin + CONTENT - 150, fy + 4, {
      width: 150,
      align: "right",
      lineBreak: false,
    });
    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor("#333333")
      .text(ascii(org.legalName), PAGE.margin + 150, fy + 4, {
        width: CONTENT - 300,
        align: "center",
        lineBreak: false,
      });
  }

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.end();
  return done;
}
