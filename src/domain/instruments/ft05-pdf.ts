import "server-only";

import PDFDocument from "pdfkit";

import { decimalPlaces, DECISION_RULE_TEXT } from "./calibration-math";
import type { CertificateDetail } from "./queries";
import { INSTRUMENT_TYPE_INFO, type InstrumentType } from "./types";

/**
 * QA Tech's calibration certificate (form QATM/PVAL/FT-05) as a PDF, laid out
 * like the paper one: letterhead, header grid, equipment specification,
 * reference standards, then observation blocks of ten instruments, remarks
 * and the three sign-off boxes.
 */

export type Ft05Context = {
  organisation: {
    legalName: string;
    shortName: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
  /** PNG or JPEG letterhead strip, printed across the top when present. */
  letterhead?: Buffer | null;
  formNumber?: string;
  signatures: { meaning: string; signerName: string; signedAt: Date }[];
  /** Watermark for anything not issued ("DRAFT", "CANCELLED"). */
  watermark?: string | null;
};

const PAGE = { width: 595.28, height: 841.89, margin: 24 };
const CONTENT = PAGE.width - PAGE.margin * 2;
const FOOTER_HEIGHT = 34;
const BORDER = "#444444";
const SHADE = "#e8e8e8";
const PER_BLOCK = 10;

type CellOptions = {
  bold?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  fill?: string;
  border?: boolean;
};

/** dd.mm.yyyy, as on QA Tech's paper certificates. */
export const dmy = (iso: string | null | undefined) =>
  iso ? iso.split("-").reverse().join(".") : "NA";

/** Pads a decimal string to `places` decimals ("1.1", 2 → "1.10"); never removes digits. */
export function toPlaces(value: string, places: number): string {
  const have = decimalPlaces(value);
  if (have >= places) return value;
  return `${value}${have === 0 ? "." : ""}${"0".repeat(places - have)}`;
}

const ascii = (s: string) =>
  // The built-in PDF fonts cover Windows-1252 only: map the few characters people type.
  s
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, "?");

class Sheet {
  doc: PDFKit.PDFDocument;
  y = PAGE.margin;
  pages = 1;

  constructor(
    private ctx: Ft05Context,
    private number: string,
  ) {
    this.doc = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      bufferPages: true,
      info: { Title: `Calibration Certificate ${number}`, Author: ctx.organisation.legalName },
    });
  }

  cell(x: number, y: number, w: number, h: number, text: string, o: CellOptions = {}) {
    const { doc } = this;
    if (o.fill) doc.rect(x, y, w, h).fill(o.fill);
    if (o.border !== false) doc.lineWidth(0.5).strokeColor(BORDER).rect(x, y, w, h).stroke();
    const size = o.size ?? 7;
    doc
      .font(o.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .fillColor("#000000");
    const t = ascii(text);
    const pad = 2.5;
    const height = doc.heightOfString(t, { width: w - pad * 2 });
    const ty = y + Math.max(1.5, (h - height) / 2);
    doc.text(t, x + pad, ty, {
      width: w - pad * 2,
      height: h - 1,
      align: o.align ?? "left",
      lineBreak: true,
      ellipsis: true,
    });
  }

  /** A row of cells spanning the content width; widths are fractions or points. */
  row(h: number, cells: [string, number, CellOptions?][]) {
    let x = PAGE.margin;
    for (const [text, w, o] of cells) {
      this.cell(x, this.y, w, h, text, o);
      x += w;
    }
    this.y += h;
  }

  ensure(height: number) {
    if (this.y + height <= PAGE.height - PAGE.margin - FOOTER_HEIGHT) return;
    this.doc.addPage();
    this.pages += 1;
    this.y = PAGE.margin;
    this.title(true);
  }

  letterhead() {
    const { doc, ctx } = this;
    if (ctx.letterhead) {
      try {
        doc.image(ctx.letterhead, PAGE.margin, this.y, { fit: [CONTENT, 72], align: "center" });
        this.y += 76;
        return;
      } catch {
        // Not a PNG/JPEG pdfkit can read: fall back to the text letterhead.
      }
    }
    const org = ctx.organisation;
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#1f3a68");
    doc.text(ascii(org.shortName || org.legalName), PAGE.margin, this.y, { width: CONTENT / 2 });
    doc.font("Helvetica").fontSize(7.5).fillColor("#333333");
    if (org.shortName && org.legalName !== org.shortName) {
      doc.text(ascii(org.legalName), PAGE.margin, doc.y + 1, { width: CONTENT / 2 });
    }
    const right = [
      org.address,
      [org.phone && `Tel: ${org.phone}`].filter(Boolean).join(""),
      [org.email && `E-mail: ${org.email}`, org.website && `Website: ${org.website}`]
        .filter(Boolean)
        .join("  |  "),
    ]
      .filter(Boolean)
      .join("\n");
    doc.text(ascii(right), PAGE.margin + CONTENT / 2, this.y, {
      width: CONTENT / 2,
      align: "right",
    });
    this.y = Math.max(doc.y, this.y + 44) + 6;
    doc
      .lineWidth(1)
      .strokeColor("#1f3a68")
      .moveTo(PAGE.margin, this.y)
      .lineTo(PAGE.margin + CONTENT, this.y)
      .stroke();
    this.y += 6;
  }

  title(continued = false) {
    const w = 170;
    this.cell(
      PAGE.margin + (CONTENT - w) / 2,
      this.y,
      w,
      18,
      continued ? "Calibration Certificate (continued)" : "Calibration Certificate",
      {
        bold: true,
        size: 11,
        align: "center",
        fill: SHADE,
      },
    );
    this.y += 24;
  }

  footer() {
    const { doc, ctx } = this;
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const y = PAGE.height - PAGE.margin - FOOTER_HEIGHT + 8;
      doc
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .moveTo(PAGE.margin, y)
        .lineTo(PAGE.margin + CONTENT, y)
        .stroke();
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#000000");
      doc.text(ctx.formNumber ?? "QATM/PVAL/FT-05", PAGE.margin, y + 4, {
        width: 160,
        lineBreak: false,
      });
      doc.text(
        `Page ${String(i + 1).padStart(2, "0")} of ${String(range.count).padStart(2, "0")}`,
        PAGE.margin + CONTENT - 160,
        y + 4,
        { width: 160, align: "right", lineBreak: false },
      );
      doc.font("Helvetica").fontSize(6.5).fillColor("#333333");
      doc.text(
        ascii(
          `${ctx.organisation.legalName}${ctx.organisation.address ? `, ${ctx.organisation.address.replace(/\s*\n\s*/g, ", ")}` : ""}`,
        ),
        PAGE.margin + 160,
        y + 4,
        {
          width: CONTENT - 320,
          align: "center",
          height: 18,
          ellipsis: true,
        },
      );
      doc.font("Helvetica").fontSize(6).fillColor("#555555");
      doc.text(ascii(this.number), PAGE.margin, y + 14, { width: 200, lineBreak: false });
      if (ctx.watermark) {
        doc.save();
        doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
        doc.font("Helvetica-Bold").fontSize(90).fillColor("#cc0000").opacity(0.12);
        doc.text(ctx.watermark, 0, PAGE.height / 2 - 50, {
          width: PAGE.width,
          align: "center",
          lineBreak: false,
        });
        doc.restore();
        doc.opacity(1);
      }
    }
  }

  async finish(): Promise<Buffer> {
    this.footer();
    const chunks: Buffer[] = [];
    this.doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
    });
    this.doc.end();
    return done;
  }
}

const unit = (q: string) => (q === "humidity" ? "% RH" : q === "pressure" ? "bar" : "°C");

/** The remark the paper certificate prints as line 2, written from the actual results. */
export function resultRemark(cert: CertificateDetail): string {
  const label = (
    cert.equipmentName ||
    INSTRUMENT_TYPE_INFO[(cert.items[0]?.instrument.type ?? "other") as InstrumentType]?.label ||
    "instrument"
  ).toUpperCase();
  const failed = cert.items.filter((i) => i.result === "fail");
  if (failed.length === 0) {
    return `The ${label} is calibrated within the specified accuracy limits.`;
  }
  const list = failed.map((i) => i.instrument.serialNo || i.instrument.code).join(", ");
  return `The ${label} is within the specified accuracy limits except ${list}, which ${failed.length === 1 ? "is" : "are"} outside the limits (marked *).`;
}

export async function renderFt05(cert: CertificateDetail, ctx: Ft05Context): Promise<Buffer> {
  const s = new Sheet(ctx, cert.number);
  const M = PAGE.margin;
  s.letterhead();
  s.title();

  // Header grid.
  const H = 13;
  s.row(H, [
    ["Date of Calibration", 90, { bold: true, fill: SHADE }],
    [dmy(cert.calibratedOn), 70, { align: "center" }],
    ["Due Date", 50, { bold: true, fill: SHADE }],
    [dmy(cert.validUntil), 70, { align: "center" }],
    ["Certificate No.", 80, { bold: true, fill: SHADE }],
    [cert.number, CONTENT - 360, { align: "center", bold: true }],
  ]);
  const customer = `${cert.customerName}\n${cert.customerAddress.replace(/\s*\n\s*/g, ", ")}`;
  s.row(24, [
    ["Customer Name &\nAddress", 90, { bold: true, fill: SHADE }],
    [customer, CONTENT - 90],
  ]);

  // Test equipment specification.
  s.y += 3;
  s.doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#000000")
    .text("Test Equipment Specifications", M, s.y);
  s.y += 11;
  const L = 95;
  const V = CONTENT / 2 - L;
  const env = [
    cert.environmentTemperature && `Temperature: ${cert.environmentTemperature}`,
    cert.environmentHumidity && `Humidity: ${cert.environmentHumidity}`,
  ]
    .filter(Boolean)
    .join("\n");
  const pairs: [string, string, string, string, number][] = [
    ["Location", cert.location, "Department", cert.department, H],
    ["Equipment Name", cert.equipmentName, "Range", cert.rangeText, H],
    ["Make", cert.make, "Resolution", cert.resolutionText, H],
    ["Model", cert.model, "Calibration SOP No.", cert.sopNo, H],
    [
      "Instrument Serial & ID No.",
      "As mentioned below",
      "Condition on receipt",
      cert.conditionOnReceipt,
      18,
    ],
    ["Accuracy", cert.accuracyText, "Environmental Conditions", env, 24],
  ];
  for (const [a, av, b, bv, h] of pairs) {
    s.row(h, [
      [a, L, { bold: true, fill: SHADE }],
      [av, V],
      [b, L, { bold: true, fill: SHADE }],
      [bv, V],
    ]);
  }

  // Reference standards.
  s.y += 4;
  s.row(H, [
    [
      "REFERENCE STANDARD USED (TRACEABLE TO NATIONAL / INTERNATIONAL STANDARDS)",
      CONTENT,
      { bold: true, align: "center", fill: SHADE },
    ],
  ]);
  const RW = [150, 55, 105, 105, 52, CONTENT - 467];
  s.row(H, [
    ["Name of Equipment", RW[0]!, { bold: true, align: "center" }],
    ["Make", RW[1]!, { bold: true, align: "center" }],
    ["Model", RW[2]!, { bold: true, align: "center" }],
    ["Serial No.", RW[3]!, { bold: true, align: "center" }],
    ["Due Date", RW[4]!, { bold: true, align: "center" }],
    ["Certificate No.", RW[5]!, { bold: true, align: "center" }],
  ]);
  for (const m of cert.masters) {
    const i = m.instrument;
    s.row(20, [
      [
        i.equipmentName || INSTRUMENT_TYPE_INFO[i.type as InstrumentType]?.label || i.code,
        RW[0]!,
        { align: "center" },
      ],
      [i.make, RW[1]!, { align: "center" }],
      [i.model, RW[2]!, { align: "center" }],
      [i.serialNo || i.code, RW[3]!, { align: "center" }],
      [dmy(m.certificate?.validUntil), RW[4]!, { align: "center" }],
      [m.certificate?.number ?? "", RW[5]!, { align: "center" }],
    ]);
  }

  // Observation table: blocks of ten instruments.
  s.y += 4;
  s.doc.font("Helvetica-Bold").fontSize(8).text("OBSERVATION TABLE", M, s.y);
  s.y += 11;
  const readingAt = new Map(cert.readings.map((r) => [`${r.seq}|${r.instrumentId}`, r]));
  const SR = 20;
  const MC = 34;
  const LABEL = 72;
  const UW = (CONTENT - SR - MC * 2 - LABEL) / PER_BLOCK;
  const RH = 10;
  for (let start = 0; start < cert.items.length; start += PER_BLOCK) {
    const block = cert.items.slice(start, start + PER_BLOCK);
    s.ensure(26 + cert.points.length * RH * 2 + 4);
    const top = s.y;
    // Header: Sr / Master Reading (°C, %RH) / Serial No. ID No. / UUC Reading
    s.cell(M, top, SR, 26, "Sr.\nNo.", { bold: true, align: "center" });
    s.cell(M + SR, top, MC * 2, 11, "Master Reading", { bold: true, align: "center", fill: SHADE });
    s.cell(M + SR, top + 11, MC, 15, "°C", { bold: true, align: "center" });
    s.cell(M + SR + MC, top + 11, MC, 15, "% RH", { bold: true, align: "center" });
    s.cell(M + SR + MC * 2, top, LABEL, 26, "Serial No.\nID No.", { bold: true, align: "center" });
    const ux = M + SR + MC * 2 + LABEL;
    s.cell(ux, top, UW * PER_BLOCK, 11, "UUC Reading", {
      bold: true,
      align: "center",
      fill: SHADE,
    });
    for (let c = 0; c < PER_BLOCK; c++) {
      const it = block[c];
      s.cell(
        ux + c * UW,
        top + 11,
        UW,
        15,
        it ? `${it.instrument.serialNo || "-"}\n${it.instrument.code}` : "",
        {
          align: "center",
          size: 5.5,
        },
      );
    }
    s.y = top + 26;
    for (const [pi, p] of cert.points.entries()) {
      const y = s.y;
      const isHumidity = p.quantity === "humidity";
      const cond = p.condition.replace(/\s*(°C|%RH|% RH)\s*$/i, "");
      s.cell(M, y, SR, RH * 2, String(pi + 1), { align: "center" });
      s.cell(M + SR, y, MC, RH * 2, isHumidity ? (cond ? `@ ${cond}` : "") : p.reference, {
        align: "center",
      });
      s.cell(M + SR + MC, y, MC, RH * 2, isHumidity ? p.reference : cond ? `@ ${cond}` : "-", {
        align: "center",
      });
      s.cell(M + SR + MC * 2, y, LABEL, RH, `Actual Output in ${unit(p.quantity)}`, { size: 5.5 });
      s.cell(M + SR + MC * 2, y + RH, LABEL, RH, `Deviation ${unit(p.quantity)}`, { size: 5.5 });
      const places = decimalPlaces(p.reference);
      for (let c = 0; c < PER_BLOCK; c++) {
        const it = block[c];
        const r = it ? readingAt.get(`${p.seq}|${it.instrument.id}`) : undefined;
        s.cell(ux + c * UW, y, UW, RH, r ? r.reading : "", { align: "center", size: 6.5 });
        const dev = r ? toPlaces(r.deviation, places) : "";
        s.cell(ux + c * UW, y + RH, UW, RH, r ? `${dev}${r.judgement === "fail" ? "*" : ""}` : "", {
          align: "center",
          size: 6.5,
          bold: r?.judgement === "fail",
        });
      }
      s.y = y + RH * 2;
    }
    s.y += 6;
  }

  // Remarks.
  const remarks = [
    "The above UUC was calibrated at laboratory.",
    resultRemark(cert),
    `This certificate shall not be reproduced, except in full, without the prior permission of ${ctx.organisation.shortName || ctx.organisation.legalName}.`,
    "The calibration results reported in this certificate are valid at the time of and under the stated conditions of measurement.",
    DECISION_RULE_TEXT,
    ...(cert.remarks.trim() ? cert.remarks.trim().split(/\n+/) : []),
  ];
  s.doc.font("Helvetica").fontSize(7);
  const remarksHeight = remarks.reduce(
    (h, r) => h + s.doc.heightOfString(ascii(r), { width: CONTENT - 12 }) + 1.5,
    12,
  );
  s.ensure(remarksHeight + 70);
  s.doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text("Remarks:", M, s.y);
  s.y += 11;
  s.doc.font("Helvetica").fontSize(7);
  remarks.forEach((r, i) => {
    s.doc.text(`${i + 1}.`, M, s.y, { width: 12 });
    s.doc.text(ascii(r), M + 12, s.y, { width: CONTENT - 12 });
    s.y = s.doc.y + 1.5;
  });

  // Sign-off boxes: the latest signature of each meaning.
  s.y += 8;
  const latest = (meaning: string) => ctx.signatures.filter((x) => x.meaning === meaning).at(-1);
  const boxes: [string, ReturnType<typeof latest>, string][] = [
    ["Calibration Done by", latest("done_by"), cert.performedByName],
    ["Certificate Checked by", latest("checked_by"), ""],
    ["Approved by", latest("approved_by"), ""],
  ];
  const BW = CONTENT / 3;
  const ist = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(d)
      .replace(/\//g, ".");
  boxes.forEach(([label, sig, fallback], i) => {
    const x = M + i * BW;
    const text = sig
      ? `${sig.signerName}\nSigned electronically\n${ist(sig.signedAt)} IST`
      : fallback || "";
    s.cell(x, s.y, BW, 38, text, { align: "center", size: 7 });
    s.cell(x, s.y + 38, BW, 12, label, { align: "center", bold: true, fill: SHADE });
  });
  s.y += 50;
  return s.finish();
}
